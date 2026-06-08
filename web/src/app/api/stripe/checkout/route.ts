import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { getValidToken, resolveConnectionId } from "@/lib/x/oauth";
import { getMe } from "@/lib/x/api";
import { billableBlocks } from "@/lib/billing";
import { estimateScannable, parseSources } from "@/lib/x/scannable";

export const runtime = "nodejs";

/**
 * Create a one-time Stripe Checkout session for a scan that exceeds the free
 * tweet limit. The tweet count (and therefore the price) is recomputed
 * server-side — the client's claim is never trusted.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { jobId } = await request.json().catch(() => ({ jobId: null }));
  if (!jobId) {
    return NextResponse.json({ error: "missing jobId" }, { status: 400 });
  }

  const { data: job } = await supabase
    .from("audit_jobs")
    .select("job_id, connection_id, enabled_sources")
    .eq("job_id", jobId)
    .maybeSingle();
  if (!job) {
    return NextResponse.json({ error: "job not found" }, { status: 404 });
  }

  const sources = parseSources(job.enabled_sources);

  const connectionId = await resolveConnectionId(user.id, job.connection_id);
  if (!connectionId) {
    return NextResponse.json({ error: "no_connection" }, { status: 409 });
  }

  const token = await getValidToken(connectionId);
  const me = await getMe(token);
  // Must mirror the ingestion gate's count exactly, or the gate can demand
  // payment for a price this route would refuse to charge.
  const cap = estimateScannable(me, sources);
  const blocks = billableBlocks(cap);
  if (blocks <= 0) {
    return NextResponse.json({ error: "no_payment_needed" }, { status: 400 });
  }

  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    return NextResponse.json({ error: "stripe_not_configured" }, { status: 500 });
  }

  const origin = new URL(request.url).origin;
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: priceId, quantity: blocks }],
    success_url: `${origin}/portal/jobs/${jobId}?paid=1`,
    cancel_url: `${origin}/portal/jobs/${jobId}`,
    metadata: { job_id: jobId, user_id: user.id },
  });

  // Record the pending payment (service-role: the table is owner-read-only).
  const admin = createAdminClient();
  await admin.from("audit_payments").upsert(
    {
      job_id: jobId,
      user_id: user.id,
      scanned_count: cap,
      billable_blocks: blocks,
      status: "pending",
      stripe_session_id: session.id,
    },
    { onConflict: "job_id" },
  );

  return NextResponse.json({ url: session.url });
}
