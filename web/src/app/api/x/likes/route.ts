import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getValidToken, resolveConnectionId } from "@/lib/x/oauth";
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

  const connectionId = await resolveConnectionId(user.id, job.connection_id);
  if (!connectionId) {
    return NextResponse.json({ error: "no_connection" }, { status: 409 });
  }

  let token: string;
  try {
    token = await getValidToken(connectionId);
  } catch {
    return NextResponse.json({ error: "token_unavailable" }, { status: 409 });
  }

  let me;
  try {
    me = await getMe(token);
  } catch (e) {
    const status = e instanceof XApiError ? 502 : 500;
    return NextResponse.json({ error: "x_api_error" }, { status });
  }

  try {
    const page = await listLikedTweetsPage(token, me.id, cursor);
    return NextResponse.json(page);
  } catch {
    return NextResponse.json({ error: "x_api_error" }, { status: 502 });
  }
}
