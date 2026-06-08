/**
 * Scan-credit pricing. Pure — safe to import on the server or client.
 *
 * Free allowance: each user gets FREE_TWEET_LIMIT posts at no cost (lifetime,
 * user-level). Beyond that they purchase credits: MIN_CREDITS minimum,
 * CREDITS_PER_DOLLAR credits per USD (i.e. $0.01 per credit).
 */

/** Lifetime free-post allowance per user. Mirrors the SQL constant in charge_job_credits. */
export const FREE_TWEET_LIMIT = 500;

/** Smallest credit purchase allowed. */
export const MIN_CREDITS = 500;

/** Credits per US dollar (rate: $0.01 / credit). */
export const CREDITS_PER_DOLLAR = 100;

// BLOCK_SIZE kept for the SQL function comment reference only.
export const BLOCK_SIZE = 500;

/** Number of paid 500-tweet blocks for a scan of `count` tweets (0 if free). */
export function billableBlocks(count: number): number {
  if (count <= FREE_TWEET_LIMIT) return 0;
  return Math.ceil((count - FREE_TWEET_LIMIT) / BLOCK_SIZE);
}
