/**
 * Client-side audit orchestration.
 *
 * Pulls the tweets to scan, runs the {@link detect} detectors over each one, and
 * reports progress as it goes so the UI can show "scanning X of N" and surface
 * flags as they're found. Returns the finished, redacted result set; the caller
 * persists it (localStorage + job-status update). No deletion happens here.
 */

import { detect } from "./detectors";
import { fetchTweets } from "./source";
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

/** Run the full audit for a job. Resolves with the finished snapshot. */
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
        if (seen.has(f.category)) continue; // count each category once per post
        seen.add(f.category);
        stats[f.category] = (stats[f.category] ?? 0) + 1;
      }
    }

    const now = new Date().toISOString();
    posts.push({
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
    });

    onProgress?.(snapshot());
    if (stepDelayMs > 0) {
      await new Promise((r) => setTimeout(r, stepDelayMs));
    }
  }

  return snapshot();
}
