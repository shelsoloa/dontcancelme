import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getValidToken, resolveConnectionId } from "@/lib/x/oauth";
import {
  getMe,
  listTimeline,
  listLikedTweets,
  MAX_FETCHABLE,
  XApiError,
  type XMe,
} from "@/lib/x/api";
import { MIN_CREDITS } from "@/lib/billing";
import { estimateScannable, parseSources } from "@/lib/x/scannable";
import type { AuditSource } from "@/lib/audit/types";
import type { RawTweet } from "@/lib/audit/sampleTweets";

export const runtime = "nodejs";

/** Fetch the selected sources and combine them, deduped and capped by `limit`. */
async function fetchSources(
  token: string,
  me: XMe,
  sources: AuditSource[],
  limit?: number | null,
): Promise<RawTweet[]> {
  const cap = Math.min(limit ?? MAX_FETCHABLE, MAX_FETCHABLE);
  const includePosts = sources.includes("posts");
  const includeReposts = sources.includes("reposts");
  const all: RawTweet[] = [];

  if (includePosts || includeReposts) {
    all.push(
      ...(await listTimeline(token, me.id, me.username, cap, {
        includePosts,
        includeReposts,
      })),
    );
  }
  if (sources.includes("likes")) {
    all.push(...(await listLikedTweets(token, me.id, cap)));
  }

  const seen = new Set<string>();
  const deduped = all.filter((t) =>
    seen.has(t.id) ? false : (seen.add(t.id), true),
  );
  return limit != null ? deduped.slice(0, limit) : deduped;
}

/**
 * Live tweet ingestion for an audit job. Resolves the user's X connection,
 * charges the user's scan-credit pool via `charge_job_credits` (idempotent;
 * free-pool first, then purchased balance), then returns the tweets for
 * client-side detection. The gate is enforced HERE, server-side.
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
    .select("job_id, connection_id, enabled_sources, scan_limit")
    .eq("job_id", jobId)
    .maybeSingle();
  if (!job) {
    return NextResponse.json({ error: "job not found" }, { status: 404 });
  }

  const sources = parseSources(job.enabled_sources);
  const scanLimit = typeof job.scan_limit === "number" ? job.scan_limit : null;

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

  const scannable = estimateScannable(me, sources, scanLimit);

  // Charge the user's credit pool. The function is idempotent per job_id:
  // re-running a job after a previous charge returns 0 immediately.
  const admin = createAdminClient();
  const { data: shortfall, error: chargeErr } = await admin.rpc(
    "charge_job_credits",
    { p_job_id: jobId, p_user_id: user.id, p_posts: scannable },
  );
  if (chargeErr) {
    return NextResponse.json({ error: "billing_error" }, { status: 500 });
  }
  if ((shortfall as number) > 0) {
    return NextResponse.json(
      {
        reason: "insufficient_credits",
        shortfall: shortfall as number,
        // Round up to the minimum purchase so the top-up always covers the gap.
        creditsToBuy: Math.max(MIN_CREDITS, shortfall as number),
      },
      { status: 402 },
    );
  }

  try {
    const tweets = await fetchSources(token, me, sources, scanLimit);
    return NextResponse.json({ tweets });
  } catch {
    return NextResponse.json({ error: "x_api_error" }, { status: 502 });
  }
}
