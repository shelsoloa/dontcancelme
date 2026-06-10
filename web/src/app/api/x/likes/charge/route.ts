import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { IMAGE_TWEET_WEIGHT } from "@/lib/audit/types";

export const runtime = "nodejs";

/**
 * Charge the authenticated user's credit balance for one liked tweet.
 *
 * POST /api/x/likes/charge  { jobId, hasImages }
 *
 * Response: { shortfall }
 * - shortfall === 0: charge succeeded; process the tweet and advance cursor.
 * - shortfall > 0:  insufficient balance; stop the likes drain.
 *
 * Billing: image likes = IMAGE_TWEET_WEIGHT (4) units; text likes = 1 unit.
 * The charge_like RPC is NOT idempotent per-like — the runner's cursor
 * (advanced only after a successful charge) is the double-charge guard.
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
  const hasImages: boolean = !!body.hasImages;

  if (!jobId) {
    return NextResponse.json({ error: "missing jobId" }, { status: 400 });
  }

  // Verify the job belongs to this user (via RLS).
  const { data: job } = await supabase
    .from("audit_jobs")
    .select("job_id")
    .eq("job_id", jobId)
    .maybeSingle();
  if (!job) {
    return NextResponse.json({ error: "job not found" }, { status: 404 });
  }

  const units = hasImages ? IMAGE_TWEET_WEIGHT : 1;

  const admin = createAdminClient();
  const { data: shortfall, error: chargeErr } = await admin.rpc("charge_like", {
    p_job_id:  jobId,
    p_user_id: user.id,
    p_units:   units,
  });
  if (chargeErr) {
    return NextResponse.json({ error: "billing_error" }, { status: 500 });
  }

  return NextResponse.json({ shortfall: shortfall as number });
}
