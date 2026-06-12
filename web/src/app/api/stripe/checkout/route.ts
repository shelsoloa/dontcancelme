import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { STRIPE_MIN_UNITS } from "@/lib/billing";

export const runtime = "nodejs";

/**
 * Create a Stripe Checkout session to purchase the credits quoted for a job.
 * Reads the persisted quote from audit_jobs.quote — never trusts client amounts.
 * On payment, the existing webhook (type:"topup") credits user_credits.balance.
 *
 * POST /api/stripe/checkout  { jobId }
 *
 * The account-page top-up flow (TopUpButton) still uses /api/stripe/topup.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const jobId: string | undefined = body.jobId;
  if (!jobId) {
    return NextResponse.json({ error: "missing jobId" }, { status: 400 });
  }

  // Load the persisted quote — RLS scopes this to the owner.
  const { data: job } = await supabase
    .from("audit_jobs")
    .select("job_id, quote")
    .eq("job_id", jobId)
    .maybeSingle();
  if (!job) {
    return NextResponse.json({ error: "job not found" }, { status: 404 });
  }
  const quote = job.quote as {
    totalUpfrontUnits: number;
    deterministic: { units: number };
    likes: { suggestedBundleUnits: number };
  } | null;
  if (!quote) {
    return NextResponse.json(
      { error: "no_quote — visit /quote first" },
      { status: 422 },
    );
  }

  // Use the server-persisted total — never the client-sent amount.
  const credits = Math.max(quote.totalUpfrontUnits, STRIPE_MIN_UNITS);

  const origin = new URL(request.url).origin;
  const successUrl = `${origin}/portal/scans/${jobId}?paid=1`;
  const cancelUrl = `${origin}/portal/scans/${jobId}/quote`;

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          // 1 US cent per credit — matches /api/stripe/topup
          unit_amount: 1,
          product_data: { name: "Scan Credits" },
        },
        quantity: credits,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      user_id: user.id,
      // "topup" so the existing webhook + apply_credit_purchase need no changes.
      type: "topup",
      credits: String(credits),
      job_id: jobId,
    },
  });

  const admin = createAdminClient();
  await admin.from("credit_purchases").insert({
    user_id: user.id,
    credits,
    blocks: 0, // legacy column; no longer meaningful
    status: "pending",
    stripe_session_id: session.id,
  });

  return NextResponse.json({ url: session.url });
}
