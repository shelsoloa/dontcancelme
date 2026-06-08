import { MAX_FETCHABLE, type XMe } from "@/lib/x/api";
import { ALL_AUDIT_SOURCES, type AuditSource } from "@/lib/audit/types";

/**
 * Shared billing input for a job: which sources are enabled and how many tweets
 * that implies. The ingestion gate (`/api/x/tweets`) and the checkout route
 * (`/api/stripe/checkout`) MUST agree on this count — if they diverge, the gate
 * can demand payment for a price checkout refuses to charge (`no_payment_needed`).
 */

/** Coerce the stored `enabled_sources` column into a valid source list. */
export function parseSources(raw: unknown): AuditSource[] {
  const valid = new Set<string>(ALL_AUDIT_SOURCES);
  const list = Array.isArray(raw)
    ? raw.filter((s): s is AuditSource => valid.has(s as string))
    : [];
  return list.length > 0 ? list : ["posts"];
}

/**
 * Billing estimate (pre-fetch, cheap): posts + reposts are both covered by X's
 * `tweet_count`; likes by `like_count`. Each capped at what we can actually pull.
 */
export function estimateScannable(me: XMe, sources: AuditSource[]): number {
  let n = 0;
  if (sources.includes("posts") || sources.includes("reposts")) {
    n += Math.min(me.tweetCount, MAX_FETCHABLE);
  }
  if (sources.includes("likes")) {
    n += Math.min(me.likeCount, MAX_FETCHABLE);
  }
  return n;
}
