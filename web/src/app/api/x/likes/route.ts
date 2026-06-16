import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getValidToken, resolveConnectionWithIdentity } from "@/lib/x/oauth";
import { getMe, listLikedTweetsPage, XApiError } from "@/lib/x/api";

export const runtime = "nodejs";

/**
 * Fetch ONE page of the authenticated user's liked tweets, returning a cursor
 * for the next page. The runner calls this repeatedly during Phase B (likes
 * drain), persisting the cursor on the job record for resumable billing.
 *
 * GET /api/x/likes?jobId=...&cursor=...
 *
 * Response: { tweets, nextCursor }
 * - tweets: RawTweet[] with hasImages flag for billing classification
 * - nextCursor: pass back as cursor for the next page; absent = last page
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const jobId  = searchParams.get("jobId");
  const cursor = searchParams.get("cursor") ?? undefined;

  if (!jobId) {
    return NextResponse.json({ error: "missing jobId" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // RLS scopes to the owner.
  const { data: job } = await supabase
    .from("audit_jobs")
    .select("job_id, connection_id")
    .eq("job_id", jobId)
    .maybeSingle();
  if (!job) {
    return NextResponse.json({ error: "job not found" }, { status: 404 });
  }

  const conn = await resolveConnectionWithIdentity(user.id, job.connection_id);
  if (!conn) {
    return NextResponse.json({ error: "no_connection" }, { status: 409 });
  }

  let token: string;
  try {
    token = await getValidToken(conn.id);
  } catch {
    return NextResponse.json({ error: "token_unavailable" }, { status: 409 });
  }

  // Use stored X user ID from the connection row; fall back to a live getMe only
  // if the row pre-dates identity storage (shouldn't happen for new connections).
  const userId = conn.platformUserId || await getMe(token).then((m) => m.id);

  try {
    const page = await listLikedTweetsPage(token, userId, cursor);
    return NextResponse.json(page);
  } catch (e) {
    if (e instanceof XApiError && e.status === 429) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }
    return NextResponse.json({ error: "x_api_error" }, { status: 502 });
  }
}
