/**
 * Pay-per-scan pricing math. The first {@link FREE_TWEET_LIMIT} tweets are free;
 * beyond that the user pays for each {@link BLOCK_SIZE}-tweet block. Pure — safe
 * to import on the server or (for display) the client.
 */

export const FREE_TWEET_LIMIT = 500;
export const BLOCK_SIZE = 500;

/** Number of paid 500-tweet blocks for a scan of `count` tweets (0 if free). */
export function billableBlocks(count: number): number {
  if (count <= FREE_TWEET_LIMIT) return 0;
  return Math.ceil((count - FREE_TWEET_LIMIT) / BLOCK_SIZE);
}
