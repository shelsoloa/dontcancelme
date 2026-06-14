import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getValidToken, resolveConnectionId } from "@/lib/x/oauth";
import {
  getMe,
  listTimeline,
  MAX_FETCHABLE,
  XApiError,
  type XMe,
} from "@/lib/x/api";
import { parseSources } from "@/lib/x/scannable";
import type { AuditSource } from "@/lib/audit/types";
import type { RawTweet } from "@/lib/audit/sampleTweets";

export const runtime = "nodejs";

/**
 * Fetch the selected sources and combine them, deduped and capped by `limit`.
 *
 * own_text   → timeline entries with no photo attachments (excludes video-only too)
 * own_images → timeline entries with at least one photo attachment
 * reposts    → retweeted content
 *
 * Likes are intentionally excluded here. They are metered and drained
 * incrementally by the Phase B engine loop via /api/x/likes.
 *
 * Billing is now pre-charged at runner start via charge_deterministic; this
 * route does NOT enforce a billing gate. The gate responsibility moved to the
 * quote → checkout → charge-deterministic flow.
 */
async function fetchSources(
  token: string,
  me: XMe,
  sources: AuditSource[],
  limit?: number | null,
): Promise<RawTweet[]> {
  const cap = Math.min(limit ?? MAX_FETCHABLE, MAX_FETCHABLE);
  const includeOwnText    = sources.includes("own_text");
  const includeOwnImages  = sources.includes("own_images");
  const includeReposts    = sources.includes("reposts");

  const all: RawTweet[] = [];

  // Own posts (text + images) and reposts all come from the timeline endpoint.
  // We fetch whenever any own-account source is enabled, then filter below.
  if (includeOwnText || includeOwnImages || includeReposts) {
    // Pass `includePosts = true` whenever own_text or own_images is enabled;
    // `includeReposts` controls whether retweeted content is included.
    const raw = await listTimeline(token, me.id, me.username, cap, {
      includePosts: includeOwnText || includeOwnImages,
      includeReposts,
    });

    // Filter the fetched timeline based on enabled sources.
    // The X API doesn't separate text/image tweets server-side, so we do it here.
    // tweet.hasImages is true only for photo attachments, not video previews.
    // Repost detection: authorHandle differs from the authenticated user's.
    for (const tweet of raw) {
      const isRepost = tweet.authorHandle.toLowerCase() !== me.username.toLowerCase();

      if (isRepost) {
        if (includeReposts) all.push(tweet);
      } else if (tweet.hasImages) {
        if (includeOwnImages) all.push(tweet);
      } else {
        // Not a photo tweet. Video-only tweets have a preview in mediaUrls but
        // no hasImages flag — detect and exclude (videos are unsupported).
        const isVideoOnly = !tweet.hasImages && (tweet.mediaUrls?.length ?? 0) > 0;
        if (includeOwnText && !isVideoOnly) all.push(tweet);
      }
    }
  }

  const seen = new Set<string>();
  const deduped = all.filter((t) =>
    seen.has(t.id) ? false : (seen.add(t.id), true),
  );
  return limit != null ? deduped.slice(0, limit) : deduped;
}

/**
 * Live tweet ingestion for an audit job.
 * Resolves the user's X connection and returns tweets for client-side detection.
 * Billing is NOT enforced here — it is handled by the quote → checkout →
 * charge_deterministic flow. Likes incremental drain uses /api/x/likes instead.
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

  const sources  = parseSources(job.enabled_sources);
  const scanLimit = typeof job.scan_limit === "number" ? job.scan_limit : null;

  // Defense in depth: tweets are only served once charge_deterministic has
  // succeeded for this job (it records a job_charges row on every success,
  // including fully free-tier runs). Prevents an unpaid job from being run by
  // hitting this route directly.
  const admin = createAdminClient();
  const { data: charge } = await admin
    .from("job_charges")
    .select("job_id")
    .eq("job_id", jobId)
    .maybeSingle();
  if (!charge) {
    return NextResponse.json({ error: "payment_required" }, { status: 402 });
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
    const tweets = await fetchSources(token, me, sources, scanLimit);
    return NextResponse.json({ tweets });
  } catch {
    return NextResponse.json({ error: "x_api_error" }, { status: 502 });
  }
}
