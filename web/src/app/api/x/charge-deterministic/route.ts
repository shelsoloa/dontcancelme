import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Charge the authenticated user's credit balance for the deterministic portion
 * of a job (own text posts, own image posts, reposts), using the counts stored
 * in the job's persisted quote.
 *
 * POST /api/x/charge-deterministic  { jobId }
 *
 * Response: { shortfall }
 * - shortfall === 0: charge succeeded; proceed to fetch and scan tweets.
 * - shortfall > 0:  insufficient balance (shouldn't happen if checkout was
 *                   completed, but handled defensively).
 *
 * Idempotent via charge_deterministic (keyed on job_id); safe to retry.
 * The SQL function re-derives the free tier at charge time (under FOR UPDATE
 * lock) rather than trusting the quote-time snapshot, preventing races.
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

  // Load the job + persisted quote (RLS-scoped to the owner).
  const { data: job } = await supabase
    .from("audit_jobs")
    .select("job_id, quote")
    .eq("job_id", jobId)
    .maybeSingle();
  if (!job) {
    return NextResponse.json({ error: "job not found" }, { status: 404 });
  }

  const quote = job.quote as {
    deterministic: { textCount: number; imageCount: number; repostCount: number };
  } | null;

  // If there's no quote (old job or direct navigation), default to zero items
  // so the charge_deterministic call is a no-op (returns 0 immediately).
  const textItems  = quote?.deterministic.textCount  ?? 0;
  const imageItems = quote?.deterministic.imageCount ?? 0;
  // reposts: text rate, so pass as text items for billing purposes.
  const repostItems = quote?.deterministic.repostCount ?? 0;

  const admin = createAdminClient();
  const { data: shortfall, error: chargeErr } = await admin.rpc(
    "charge_deterministic",
    {
      p_job_id:      jobId,
      p_user_id:     user.id,
      p_text_items:  textItems + repostItems,  // both priced at 1 unit each
      p_image_items: imageItems,
    },
  );
  if (chargeErr) {
    return NextResponse.json({ error: "billing_error" }, { status: 500 });
  }

  return NextResponse.json({ shortfall: shortfall as number });
}
