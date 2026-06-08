import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getValidToken, resolveConnectionId } from "@/lib/x/oauth";
import { getMe, listTweets, MAX_FETCHABLE, XApiError } from "@/lib/x/api";
import { billableBlocks, FREE_TWEET_LIMIT } from "@/lib/billing";

export const runtime = "nodejs";

/**
 * Live tweet ingestion for an audit job. Resolves the user's X connection,
 * checks the billing gate (free up to 500 tweets; beyond that requires a paid
 * `audit_payments` row for this job), then returns the tweets for client-side
 * detection. The gate is enforced HERE so a tampered client can't bypass it.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId");
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

  // RLS scopes this to the owner.
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

  const cap = Math.min(me.tweetCount, MAX_FETCHABLE);
  const blocks = billableBlocks(cap);

  if (blocks > 0) {
    const { data: paid } = await supabase
      .from("audit_payments")
      .select("status")
      .eq("job_id", jobId)
      .eq("status", "paid")
      .maybeSingle();
    if (!paid) {
      return NextResponse.json(
        {
          reason: "payment_required",
          tweetCount: cap,
          billableBlocks: blocks,
          freeLimit: FREE_TWEET_LIMIT,
        },
        { status: 402 },
      );
    }
  }

  try {
    const tweets = await listTweets(token, me.id, me.username, cap);
    return NextResponse.json({ tweets });
  } catch {
    return NextResponse.json({ error: "x_api_error" }, { status: 502 });
  }
}
