/**
 * Client-side audit orchestration.
 *
 * Two phases:
 *   Phase A — runAudit (deterministic): fetches own posts / reposts, runs
 *             text-only detection, accumulates results.
 *   Phase B — runLikesDrain (metered): pages through liked tweets, charges
 *             per-item from the prepaid balance, runs detection, stops when
 *             balance runs out or the likes cap is reached.
 *
 * Results are returned per-phase so the runner can save partial results to
 * localStorage and update the job record incrementally.
 * No deletion happens here.
 */

import { detect } from "./detectors";
import { fetchTweets, fetchLikesPage, chargeLike } from "./source";
import type {
  AuditedPost,
  AuditJobProgress,
  RiskCategory,
} from "./types";

export type AuditSnapshot = {
  progress: AuditJobProgress;
  stats: Partial<Record<RiskCategory, number>>;
  /** Posts scanned so far, newest scan last. */
  posts: AuditedPost[];
};

export type RunAuditArgs = {
  jobId: string;
  userId: string;
  enabledCategories: RiskCategory[];
  /** Pull the user's real X timeline (vs sample data). */
  live?: boolean;
  /** Called after each tweet is scanned, plus once with the initial total. */
  onProgress?: (snapshot: AuditSnapshot) => void;
  /** Optional cancellation. */
  signal?: AbortSignal;
  /** Per-tweet artificial delay (ms) so progress is visible. Default 90. */
  stepDelayMs?: number;
};

class AbortError extends Error {
  constructor() {
    super("Audit aborted");
    this.name = "AbortError";
  }
}

/** Build an AuditedPost from a raw tweet and detection results. */
function toPost(
  tweet: { id: string; text: string; url: string; authorHandle: string;
           createdAt: string; mediaUrls?: string[]; authorAvatarUrl?: string },
  jobId: string,
  userId: string,
  flags: ReturnType<typeof detect>["flags"],
  redactedText: string,
): AuditedPost {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    jobId,
    userId,
    platform: "x",
    platformPostId: tweet.id,
    url: tweet.url,
    authorHandle: tweet.authorHandle,
    text: redactedText,
    postedAt: tweet.createdAt,
    source: "api",
    mediaUrls: tweet.mediaUrls,
    authorAvatarUrl: tweet.authorAvatarUrl,
    flags,
    decision: "pending",
    createdAt: now,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase A — Deterministic (own posts, reposts)
// ─────────────────────────────────────────────────────────────────────────────

/** Run the deterministic audit for a job. Resolves with the finished snapshot. */
export async function runAudit(args: RunAuditArgs): Promise<AuditSnapshot> {
  const { jobId, userId, enabledCategories, onProgress, signal } = args;
  const stepDelayMs = args.stepDelayMs ?? 90;

  const tweets = await fetchTweets({ jobId, live: args.live });
  if (signal?.aborted) throw new AbortError();

  const posts: AuditedPost[] = [];
  const stats: Partial<Record<RiskCategory, number>> = {};
  let flagged = 0;

  const snapshot = (): AuditSnapshot => ({
    progress: { total: tweets.length, processed: posts.length, flagged },
    stats: { ...stats },
    posts: [...posts],
  });

  onProgress?.(snapshot());

  for (const tweet of tweets) {
    if (signal?.aborted) throw new AbortError();

    const { flags, redactedText } = detect(tweet.text, enabledCategories);
    if (flags.length > 0) {
      flagged++;
      const seen = new Set<RiskCategory>();
      for (const f of flags) {
        if (seen.has(f.category)) continue;
        seen.add(f.category);
        stats[f.category] = (stats[f.category] ?? 0) + 1;
      }
    }

    posts.push(toPost(tweet, jobId, userId, flags, redactedText));

    onProgress?.(snapshot());
    if (stepDelayMs > 0) {
      await new Promise((r) => setTimeout(r, stepDelayMs));
    }
  }

  return snapshot();
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase B — Likes drain (metered, resumable)
// ─────────────────────────────────────────────────────────────────────────────

export type LikesDrainArgs = {
  jobId: string;
  userId: string;
  enabledCategories: RiskCategory[];
  likesCap: number;
  /** Cursor from audit_jobs.likes_cursor — resume from here. */
  initialCursor: string | undefined;
  /** Items already processed (from audit_jobs.likes_processed). */
  initialProcessed: number;
  /** Called after each tweet is charged and scanned. */
  onProgress?: (snapshot: AuditSnapshot, processedCount: number) => void;
  /** Called when balance is exhausted; the runner should persist cursor + show UI. */
  onExhausted?: (processedCount: number, nextCursor: string | undefined) => void;
  /** Accumulated posts from Phase A (merged into each snapshot). */
  priorPosts: AuditedPost[];
  priorStats: Partial<Record<RiskCategory, number>>;
  /** Per-tweet delay for dev/sample paths (0 for live). */
  stepDelayMs?: number;
};

export type LikesDrainResult =
  | { kind: "completed"; snapshot: AuditSnapshot; processedCount: number }
  | { kind: "exhausted"; snapshot: AuditSnapshot; processedCount: number; nextCursor: string | undefined };

/** Run the metered likes drain loop for a job (Phase B). */
export async function runLikesDrain(args: LikesDrainArgs): Promise<LikesDrainResult> {
  const {
    jobId, userId, enabledCategories, likesCap,
    initialCursor, initialProcessed, onProgress, onExhausted,
    priorPosts, priorStats,
  } = args;
  const stepDelayMs = args.stepDelayMs ?? 0;

  const posts: AuditedPost[]  = [...priorPosts];
  const stats: Partial<Record<RiskCategory, number>> = { ...priorStats };
  let flagged = priorPosts.filter((p) => p.flags.length > 0).length;
  let processedCount = initialProcessed;
  let cursor = initialCursor;

  function snapshot(): AuditSnapshot {
    return {
      progress: {
        total:     likesCap,
        processed: processedCount,
        flagged,
      },
      stats:  { ...stats },
      posts:  [...posts],
    };
  }

  while (processedCount < likesCap) {
    // Fetch one page of liked tweets.
    let page;
    try {
      page = await fetchLikesPage(jobId, cursor);
    } catch {
      // Network/API error — surface as exhaustion so the runner can save state.
      onExhausted?.(processedCount, cursor);
      return { kind: "exhausted", snapshot: snapshot(), processedCount, nextCursor: cursor };
    }

    if (page.tweets.length === 0) {
      // No more liked tweets — drain complete.
      break;
    }

    for (const tweet of page.tweets) {
      if (processedCount >= likesCap) break;

      // Charge for this tweet; stop if balance is insufficient.
      let chargeResult;
      try {
        chargeResult = await chargeLike(jobId, tweet.hasImages);
      } catch {
        // Charge endpoint error — treat as exhaustion.
        onExhausted?.(processedCount, cursor);
        return { kind: "exhausted", snapshot: snapshot(), processedCount, nextCursor: cursor };
      }

      if (chargeResult.shortfall > 0) {
        // Balance ran out — advance cursor to the NEXT page so resume skips
        // the remainder of this page (which we can't partially process without
        // re-fetching and risking double-charges).
        const nextCursor = page.nextCursor;
        onExhausted?.(processedCount, nextCursor);
        return { kind: "exhausted", snapshot: snapshot(), processedCount, nextCursor };
      }

      // Charged successfully — detect and accumulate.
      const { flags, redactedText } = detect(tweet.text, enabledCategories);
      if (flags.length > 0) {
        flagged++;
        const seen = new Set<RiskCategory>();
        for (const f of flags) {
          if (seen.has(f.category)) continue;
          seen.add(f.category);
          stats[f.category] = (stats[f.category] ?? 0) + 1;
        }
      }
      posts.push(toPost(tweet, jobId, userId, flags, redactedText));
      processedCount++;

      onProgress?.(snapshot(), processedCount);
      if (stepDelayMs > 0) {
        await new Promise((r) => setTimeout(r, stepDelayMs));
      }
    }

    // Page complete — advance cursor.
    cursor = page.nextCursor;

    if (!cursor) break; // end of liked tweets
  }

  return { kind: "completed", snapshot: snapshot(), processedCount };
}
