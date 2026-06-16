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
import { fetchTweets, fetchLikesPage, chargeLike, ChargeError } from "./source";

/**
 * Maximum number of consecutive empty liked-tweets pages we'll follow before
 * giving up.  X can return empty pages that still carry a next_token due to
 * backend buffering; we advance through them rather than stopping.  This cap
 * prevents an infinite loop if the feed is genuinely empty or the cursor loops.
 */
const MAX_EMPTY_STREAK = 8;
import type {
  AuditedPost,
  AuditJobProgress,
  AuditSource,
  Flag,
  ModerationResult,
  RiskCategory,
  Severity,
} from "./types";

// ─── Moderation categories (handled server-side by the Phase-1 gate) ─────────

const MODERATION_CATEGORIES = new Set<RiskCategory>([
  "nsfw" as RiskCategory,
  "violence" as RiskCategory,
  "hate_speech" as RiskCategory,
  "profanity" as RiskCategory,
]);

/** Projects a ModerationResult label+severity into a Flag for the UI. */
function projectModLabel(
  result: ModerationResult,
  label: ModerationResult["labels"][number],
): Flag | null {
  let category: RiskCategory;
  if (label === "curse" || label === "strong_curse") {
    category = "profanity" as RiskCategory;
  } else if (label === "nsfw_sexual") {
    category = "nsfw" as RiskCategory;
  } else if (label === "violent") {
    category = "violence" as RiskCategory;
  } else if (label === "hate") {
    category = "hate_speech" as RiskCategory;
  } else {
    return null;
  }

  const severityMap: Record<string, Severity> = {
    mild: "low",
    strong: "medium",
    severe: "high",
  };
  const severity: Severity = result.severity
    ? (severityMap[result.severity] ?? "low")
    : "low";

  const reasonMap: Record<string, string> = {
    curse: "Profanity",
    strong_curse: "Strong profanity",
    nsfw_sexual: "Sexual content",
    violent: "Violent content",
    hate: "Hate speech / slur",
  };

  const firstHit = result.phase1.hits[0];
  // "violent" can only come from Phase 2 (Surge has no violence category).
  const detector: "gate" | "llm" = label === "violent" ? "llm" : "gate";

  return {
    category,
    severity,
    confidence: 0.9,
    reason: reasonMap[label] ?? label,
    detector,
    evidence: firstHit
      ? { textStart: firstHit.start, textEnd: firstHit.end }
      : undefined,
  };
}

/**
 * Batch a single chunk (≤25 items) to the server-side gate route and return
 * a map of tweet id → projected Flag[]. Fail-open on any error.
 * Call this lazily — once per 25-item frontier — so onProgress fires per item
 * instead of being blocked behind a single up-front batch.
 */
const MOD_CHUNK_SIZE = 25;

/**
 * Lazily moderate the next chunk of items starting at `nextIdx`, merging
 * results into `target`.  Returns the new next-index (nextIdx + chunk size).
 * Fail-open: a network error or a non-200 response leaves the target unchanged.
 */
async function moderateNextChunk(
  jobId: string,
  items: Array<{ id: string; text: string }>,
  nextIdx: number,
  chunkSize: number,
  enabledSet: Set<RiskCategory>,
  target: Map<string, Flag[]>,
): Promise<number> {
  const chunk = items.slice(nextIdx, nextIdx + chunkSize);
  const chunkMap = await moderateChunk(jobId, chunk, enabledSet);
  for (const [id, fl] of chunkMap) target.set(id, fl);
  return nextIdx + chunk.length;
}

async function moderateChunk(
  jobId: string,
  chunk: Array<{ id: string; text: string }>,
  enabledSet: Set<RiskCategory>,
): Promise<Map<string, Flag[]>> {
  const map = new Map<string, Flag[]>();
  if (chunk.length === 0) return map;

  let results: ModerationResult[];
  try {
    const res = await fetch("/api/moderation/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId,
        items: chunk.map((t) => ({ id: t.id, text: t.text })),
      }),
    });
    if (!res.ok) return map; // fail-open
    const data = (await res.json()) as { results: ModerationResult[] };
    results = data.results;
  } catch {
    return map; // network error — fail-open
  }

  for (const result of results) {
    const flags: Flag[] = [];
    for (const label of result.labels) {
      const flag = projectModLabel(result, label);
      if (!flag) continue;
      if (!enabledSet.has(flag.category)) continue;
      flags.push(flag);
    }
    if (flags.length > 0) map.set(result.id, flags);
  }

  return map;
}

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
  auditSource?: AuditSource,
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
    auditSource,
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

  // Moderation is done lazily in MOD_CHUNK_SIZE-item batches so that
  // onProgress fires per-tweet rather than after one large up-front call.
  const enabledSet = new Set(enabledCategories);
  const anyModEnabled = [...MODERATION_CATEGORIES].some((c) => enabledSet.has(c));
  const modFlags = new Map<string, Flag[]>();
  let modNext = 0;

  const posts: AuditedPost[] = [];
  const stats: Partial<Record<RiskCategory, number>> = {};
  let flagged = 0;

  const snapshot = (): AuditSnapshot => ({
    progress: { total: tweets.length, processed: posts.length, flagged },
    stats: { ...stats },
    posts: [...posts],
  });

  onProgress?.(snapshot());

  for (let i = 0; i < tweets.length; i++) {
    const tweet = tweets[i];
    if (signal?.aborted) throw new AbortError();

    // Fire the next moderation chunk lazily when we reach an unmoderated item.
    if (anyModEnabled && i >= modNext) {
      modNext = await moderateNextChunk(jobId, tweets, modNext, MOD_CHUNK_SIZE, enabledSet, modFlags);
    }

    const { flags: regexFlags, redactedText } = detect(tweet.text, enabledCategories);
    const flags = [...regexFlags, ...(modFlags.get(tweet.id) ?? [])];
    if (flags.length > 0) {
      flagged++;
      const seen = new Set<RiskCategory>();
      for (const f of flags) {
        if (seen.has(f.category)) continue;
        seen.add(f.category);
        stats[f.category] = (stats[f.category] ?? 0) + 1;
      }
    }

      posts.push(toPost(tweet, jobId, userId, flags, redactedText, tweet.auditSource));

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
  /**
   * Platform post IDs already charged + scanned in a previous (interrupted)
   * run — from the localStorage checkpoint. Matching tweets are skipped
   * (no charge, no detect, no push: they're already in `priorPosts`) but still
   * counted, so re-fetching a partially-processed page never double-charges.
   */
  processedIds?: Set<string>;
  /** Called after each tweet is charged and scanned. */
  onProgress?: (snapshot: AuditSnapshot, processedCount: number) => void;
  /**
   * Called (and awaited) after each fully processed page with the cursor for
   * the NEXT page. Persist it so an interrupted drain resumes where it left off.
   */
  onPageComplete?: (processedCount: number, nextCursor: string | undefined) => Promise<void> | void;
  /** Called when balance is exhausted OR the user stops the scan. */
  onExhausted?: (processedCount: number, nextCursor: string | undefined) => void;
  /** Accumulated posts from Phase A (merged into each snapshot). */
  priorPosts: AuditedPost[];
  priorStats: Partial<Record<RiskCategory, number>>;
  /** Per-tweet delay for dev/sample paths (0 for live). */
  stepDelayMs?: number;
  /**
   * Abort signal from the Stop button.  Checked between pages and between
   * tweets.  On abort the runner saves state via `onExhausted` so the user
   * can resume, then returns `{ kind: "stopped" }`.
   *
   * IMPORTANT: this signal must NOT come from a useEffect cleanup (StrictMode
   * double-mount would abort the real run).  Wire it to a ref set only by a
   * click handler — see JobRunner.tsx.
   */
  signal?: AbortSignal;
};

export type LikesDrainResult =
  | { kind: "completed"; snapshot: AuditSnapshot; processedCount: number }
  | { kind: "exhausted"; snapshot: AuditSnapshot; processedCount: number; nextCursor: string | undefined; reason?: "rate_limited" }
  | { kind: "stopped";   snapshot: AuditSnapshot; processedCount: number; nextCursor: string | undefined };

/** Run the metered likes drain loop for a job (Phase B). */
export async function runLikesDrain(args: LikesDrainArgs): Promise<LikesDrainResult> {
  const {
    jobId, userId, enabledCategories, likesCap,
    initialCursor, initialProcessed, processedIds,
    onProgress, onPageComplete, onExhausted,
    priorPosts, priorStats, signal,
  } = args;
  const stepDelayMs = args.stepDelayMs ?? 0;

  // Moderation is done lazily in MOD_CHUNK_SIZE-item batches per page so that
  // onProgress fires per-tweet rather than after one large up-front call.
  const enabledSet = new Set(enabledCategories);
  const anyModEnabled = [...MODERATION_CATEGORIES].some((c) => enabledSet.has(c));

  const posts: AuditedPost[]  = [...priorPosts];
  const stats: Partial<Record<RiskCategory, number>> = { ...priorStats };
  let flagged = priorPosts.filter((p) => p.flags.length > 0).length;
  let processedCount = initialProcessed;
  let cursor = initialCursor;
  /** Consecutive empty pages followed without processing any tweets. */
  let emptyStreak = 0;

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
    // ── abort check between pages ─────────────────────────────────────────
    if (signal?.aborted) {
      // cursor already points at the next page from the previous iteration
      // (or initialCursor on the very first check before any page is fetched).
      onExhausted?.(processedCount, cursor);
      return { kind: "stopped", snapshot: snapshot(), processedCount, nextCursor: cursor };
    }

    // Fetch one page of liked tweets.
    let page;
    try {
      page = await fetchLikesPage(jobId, cursor);
    } catch (e) {
      // Distinguish X rate-limit (ask user to wait) from other errors.
      const isRateLimit = e instanceof Error && e.name === "RateLimitedError";
      onExhausted?.(processedCount, cursor);
      return {
        kind: "exhausted",
        snapshot: snapshot(),
        processedCount,
        nextCursor: cursor,
        ...(isRateLimit ? { reason: "rate_limited" as const } : {}),
      };
    }

    if (page.tweets.length === 0) {
      // X can return empty pages that still carry a next_token (backend
      // buffering).  Follow the cursor rather than stopping immediately.
      if (page.nextCursor) {
        cursor = page.nextCursor;
        emptyStreak++;
        if (emptyStreak > MAX_EMPTY_STREAK) break; // safety — stop spinning
        continue;
      }
      // No cursor → genuine end-of-list.
      break;
    }

    emptyStreak = 0; // reset on any non-empty page

    // Per-page moderation cache — populated lazily in MOD_CHUNK_SIZE batches
    // so onProgress still fires per tweet (not after a single up-front call).
    const pageMod = new Map<string, Flag[]>();
    let pageModNext = 0;

    for (let j = 0; j < page.tweets.length; j++) {
      const tweet = page.tweets[j];
      if (processedCount >= likesCap) break;

      // Already charged + scanned in an interrupted run — count it and move on.
      if (processedIds?.has(tweet.id)) {
        processedCount++;
        onProgress?.(snapshot(), processedCount);
        continue;
      }

      // Charge for this tweet; stop if balance is insufficient.
      let chargeResult;
      try {
        chargeResult = await chargeLike(jobId, tweet.hasImages);
      } catch (err) {
        // Distinguish transient errors (5xx, network) from true exhaustion.
        // Both halt the drain, but the call site now has diagnostic info.
        if (err instanceof ChargeError) {
          console.error("chargeLike failed:", err.status, err.message);
        }
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

      // Fire the next moderation chunk lazily when we reach an unmoderated item.
      // Moderation is unmetered — moderating a tweet we later can't charge is harmless.
      if (anyModEnabled && j >= pageModNext) {
        pageModNext = await moderateNextChunk(jobId, page.tweets, pageModNext, MOD_CHUNK_SIZE, enabledSet, pageMod);
      }

      // Charged and moderated — detect and accumulate.
      const { flags: regexFlagsC, redactedText } = detect(tweet.text, enabledCategories);
      const flags = [...regexFlagsC, ...(pageMod.get(tweet.id) ?? [])];
      if (flags.length > 0) {
        flagged++;
        const seen = new Set<RiskCategory>();
        for (const f of flags) {
          if (seen.has(f.category)) continue;
          seen.add(f.category);
          stats[f.category] = (stats[f.category] ?? 0) + 1;
        }
      }
    posts.push(toPost(tweet, jobId, userId, flags, redactedText, tweet.auditSource));
      processedCount++;

      onProgress?.(snapshot(), processedCount);

      // ── abort check after each charged + processed tweet ─────────────────
      // Advance to the NEXT page cursor so resume never re-charges tweets
      // from the current page that have already been processed.
      if (signal?.aborted) {
        onExhausted?.(processedCount, page.nextCursor);
        return { kind: "stopped", snapshot: snapshot(), processedCount, nextCursor: page.nextCursor };
      }

      if (stepDelayMs > 0) {
        await new Promise((r) => setTimeout(r, stepDelayMs));
      }
    }

    // Page complete — advance cursor and persist the resume point.
    cursor = page.nextCursor;
    await onPageComplete?.(processedCount, cursor);

    if (!cursor) break; // end of liked tweets
  }

  return { kind: "completed", snapshot: snapshot(), processedCount };
}
