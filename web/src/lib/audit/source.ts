/**
 * Tweet fetch / charge helpers for the client-side audit runner.
 *
 * Deterministic sources (own posts + reposts):
 *   fetchTweets  → GET /api/x/tweets  (no billing gate; charge happens at
 *                  runner start via POST /api/x/charge-deterministic)
 *
 * Likes (indeterministic, metered):
 *   fetchLikesPage → GET /api/x/likes?cursor=  (one page, exposes cursor)
 *   chargeLike     → POST /api/x/likes/charge  (per-item balance debit)
 *
 * Non-X / dev-login users get {@link SAMPLE_TWEETS} and bypass all payment.
 */

import { SAMPLE_TWEETS, type RawTweet } from "./sampleTweets";

export type { RawTweet };

// ────────────────────────────────────────────────────────────────────────────
// Deterministic fetch (own posts, reposts)
// ────────────────────────────────────────────────────────────────────────────

export type FetchTweetsOptions = { jobId?: string; live?: boolean };

/** Fetch deterministic tweets for an audit job. Live for X users; sample data otherwise. */
export async function fetchTweets(
  opts: FetchTweetsOptions = {},
): Promise<RawTweet[]> {
  if (opts.live && opts.jobId) {
    const res = await fetch(
      `/api/x/tweets?jobId=${encodeURIComponent(opts.jobId)}`,
      { cache: "no-store" },
    );
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error ?? `Failed to fetch tweets (${res.status})`);
    }
    const { tweets } = await res.json();
    return tweets as RawTweet[];
  }

  // Sample-data path: brief delay so the loading state is real.
  await new Promise((r) => setTimeout(r, 250));
  return SAMPLE_TWEETS;
}

// ────────────────────────────────────────────────────────────────────────────
// Deterministic charge (called once at runner Phase A start)
// ────────────────────────────────────────────────────────────────────────────

export type ChargeResult = { shortfall: number };

/**
 * Charge the user's credit balance for the deterministic portion of a job.
 * Idempotent (keyed on job_id). Returns shortfall (0 = success).
 */
export async function chargeDeterministic(jobId: string): Promise<ChargeResult> {
  const res = await fetch("/api/x/charge-deterministic", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ jobId }),
    cache:   "no-store",
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? `Charge failed (${res.status})`);
  }
  return res.json() as Promise<ChargeResult>;
}

// ────────────────────────────────────────────────────────────────────────────
// Likes drain helpers (Phase B)
// ────────────────────────────────────────────────────────────────────────────

export type LikeTweet = RawTweet & { hasImages: boolean };

export type LikesPage = {
  tweets:     LikeTweet[];
  nextCursor: string | undefined;
};

/**
 * Thrown when the X API returns 429 (rate limited) for the liked_tweets
 * endpoint.  The drain engine surfaces this as a distinct exhausted reason so
 * the UI can prompt "try again in ~15 minutes" instead of the credit top-up
 * flow.
 */
export class RateLimitedError extends Error {
  constructor() {
    super("X API rate limit exceeded");
    this.name = "RateLimitedError";
  }
}

/** Fetch one page of liked tweets. Pass cursor from the previous page's nextCursor. */
export async function fetchLikesPage(
  jobId: string,
  cursor?: string,
): Promise<LikesPage> {
  const params = new URLSearchParams({ jobId });
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`/api/x/likes?${params.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    if (res.status === 429) throw new RateLimitedError();
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? `Likes fetch failed (${res.status})`);
  }
  return res.json() as Promise<LikesPage>;
}

/**
 * Charge the user for one liked tweet. NOT idempotent — call only once per
 * tweet, after verifying the tweet hasn't already been processed (via cursor).
 * Returns shortfall (0 = success; >0 = balance insufficient, stop draining).
 */
export async function chargeLike(
  jobId:     string,
  hasImages: boolean,
): Promise<ChargeResult> {
  const res = await fetch("/api/x/likes/charge", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ jobId, hasImages }),
    cache:   "no-store",
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? `Like charge failed (${res.status})`);
  }
  return res.json() as Promise<ChargeResult>;
}
