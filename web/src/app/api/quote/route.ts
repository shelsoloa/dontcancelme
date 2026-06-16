import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getValidToken, resolveConnectionId } from "@/lib/x/oauth";
import { getMe, countOwnTweets, XApiError } from "@/lib/x/api";
import { parseSources } from "@/lib/x/scannable";
import { FREE_TWEET_LIMIT, CREDITS_PER_DOLLAR } from "@/lib/billing";
import { IMAGE_TWEET_WEIGHT } from "@/lib/audit/types";

export const runtime = "nodejs";

// Quote rate limit: max 5 calls per 60-second window per user.
// counts/all is app-level and costs money — protect it.
const QUOTE_RATE_LIMIT_MAX    = 5;
const QUOTE_RATE_LIMIT_WINDOW = 60; // seconds

/** Compute the free-tier offset in posts (items, not weighted units). */
function computeFreeOffset(
  textItems: number,
  imageItems: number,
  repostItems: number,
  freeUsed: number,
): { freeText: number; freeImage: number; freeRepost: number } {
  const freeAvail = Math.max(0, FREE_TWEET_LIMIT - freeUsed);
  // Apply free tier cheapest-bucket first: text → reposts → images
  // (matches the SQL ordering in charge_deterministic)
  const freeText   = Math.min(textItems, freeAvail);
  const freeRepost = Math.min(repostItems, Math.max(0, freeAvail - freeText));
  const freeImage  = Math.min(imageItems, Math.max(0, freeAvail - freeText - freeRepost));
  return { freeText, freeRepost, freeImage };
}

/** Convert units to dollars (100 credits = $1.00). */
function unitsToDollars(units: number): string {
  return (units / CREDITS_PER_DOLLAR).toFixed(2);
}

/**
 * Compute a firm quote for a job.
 *
 * POST /api/quote  { jobId }
 *
 * - Deterministic sources (own_text, own_images, reposts) are counted exactly
 *   via X counts/all (full-archive, app-only Bearer Token).
 * - Likes are indeterministic: a suggested bundle is sized from me.likeCount,
 *   capped by likes_cap, with a worst-case image multiplier.
 * - The computed quote is persisted to audit_jobs.quote for checkout to read.
 * - Rate-limited per user to protect the counts/all app quota.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const jobId: string | undefined = body.jobId;
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

  // Rate-limit this endpoint per user.
  const admin = createAdminClient();
  const { data: tokenGranted, error: rateLimitErr } = await admin.rpc(
    "take_quote_token",
    {
      p_user_id:     user.id,
      p_max:         QUOTE_RATE_LIMIT_MAX,
      p_window_secs: QUOTE_RATE_LIMIT_WINDOW,
    },
  );
  if (rateLimitErr) {
    console.error("take_quote_token RPC failed:", rateLimitErr);
    return NextResponse.json({ error: "rate_limit_error" }, { status: 500 });
  }
  if (!tokenGranted) {
    return NextResponse.json(
      { error: "rate_limit_exceeded", retryAfterSeconds: QUOTE_RATE_LIMIT_WINDOW },
      { status: 429 },
    );
  }

  // Load the job (RLS-scoped to the owner).
  const { data: job } = await supabase
    .from("audit_jobs")
    .select("job_id, connection_id, enabled_sources, scan_limit, likes_cap")
    .eq("job_id", jobId)
    .maybeSingle();
  if (!job) {
    return NextResponse.json({ error: "job not found" }, { status: 404 });
  }

  const sources  = parseSources(job.enabled_sources);
  const scanLimit: number | null =
    typeof job.scan_limit === "number" ? job.scan_limit : null;
  const likesCap: number | null =
    typeof job.likes_cap === "number" ? job.likes_cap : null;

  const likesEnabled = sources.includes("likes");
  const ownTextEnabled   = sources.includes("own_text");
  const ownImagesEnabled = sources.includes("own_images");
  const repostsEnabled   = sources.includes("reposts");
  const hasDeterministic = ownTextEnabled || ownImagesEnabled || repostsEnabled;

  // Resolve the user's X connection to get their username and likeCount.
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

  // -------------------------------------------------------------------
  // Deterministic block: count own tweets by type via counts/all.
  // -------------------------------------------------------------------
  let rawText   = 0;
  let rawImage  = 0;
  let rawRepost = 0;

  if (hasDeterministic) {
    try {
      const counts = await countOwnTweets(me.username);
      if (ownTextEnabled)   rawText   = counts.textCount;
      if (ownImagesEnabled) rawImage  = counts.imageCount;
      if (repostsEnabled)   rawRepost = counts.repostCount;
    } catch (e) {
      if (e instanceof XApiError && e.status === 503) {
        // Bearer token not configured — inform the caller clearly.
        return NextResponse.json(
          { error: "bearer_token_not_configured" },
          { status: 503 },
        );
      }
      return NextResponse.json({ error: "counts_api_error" }, { status: 502 });
    }
  }

  // Apply scan_limit cap (item-based, not unit-based) — matches estimateScannable.
  if (scanLimit != null) {
    const total = rawText + rawImage + rawRepost;
    if (total > scanLimit) {
      // Scale each bucket proportionally.
      const ratio = scanLimit / total;
      rawText   = Math.floor(rawText   * ratio);
      rawImage  = Math.floor(rawImage  * ratio);
      rawRepost = scanLimit - rawText - rawImage; // avoid rounding gaps
    }
  }

  // Apply free tier. Fetch current free_used from user_credits.
  const { data: credits } = await admin
    .from("user_credits")
    .select("free_used, balance")
    .eq("user_id", user.id)
    .maybeSingle();
  const freeUsed    = credits?.free_used ?? 0;
  const balance     = credits?.balance   ?? 0;

  const { freeText, freeRepost, freeImage } = computeFreeOffset(
    rawText, rawImage, rawRepost, freeUsed,
  );

  const chargedText   = rawText   - freeText;
  const chargedRepost = rawRepost - freeRepost;
  const chargedImage  = rawImage  - freeImage;
  const deterministicUnits = chargedText + chargedRepost + chargedImage * IMAGE_TWEET_WEIGHT;
  const freeApplied = freeText + freeRepost + freeImage;

  // -------------------------------------------------------------------
  // Likes block: indeterministic — suggest a bundle, never exact.
  // -------------------------------------------------------------------
  let likesBundleUnits = 0;
  if (likesEnabled && likesCap != null) {
    // Worst-case: all liked tweets are image tweets (4 units each).
    // Recommended bundle: use me.likeCount if available, else use cap.
    const likeEstimate = me.likeCount > 0
      ? Math.min(likesCap, me.likeCount)
      : likesCap;
    // Suggest a conservative mid-range bundle: 2× the cap
    // (assumes ~50% image liked tweets on average).
    // The user can always top up; we err on the side of not over-charging.
    likesBundleUnits = likeEstimate * 2;
  }

  const totalUpfrontUnits = deterministicUnits + likesBundleUnits;

  const quote = {
    deterministic: {
      textCount:   rawText,
      imageCount:  rawImage,
      repostCount: rawRepost,
      freeApplied,
      units:       deterministicUnits,
      usd:         unitsToDollars(deterministicUnits),
    },
    likes: {
      enabled:              likesEnabled,
      capN:                 likesCap,
      suggestedBundleUnits: likesBundleUnits,
      suggestedBundleUsd:   unitsToDollars(likesBundleUnits),
      metered:              true,
    },
    totalUpfrontUnits,
    totalUpfrontUsd: unitsToDollars(totalUpfrontUnits),
    currentBalance:  balance,
  };

  // Persist the quote to the job record so checkout reads the same numbers.
  await admin
    .from("audit_jobs")
    .update({ quote })
    .eq("job_id", jobId);

  return NextResponse.json(quote);
}
