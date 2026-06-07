/**
 * Tweet source. v1 returns the user's X-API-surfaced tweets.
 *
 * Until the X OAuth app credentials exist, this serves {@link SAMPLE_TWEETS} so
 * the audit flow is runnable end-to-end. When the live integration lands, swap
 * the body for a fetch to a server route that uses the stored connection token
 * (never expose the token to the client) — the `RawTweet[]` contract stays.
 */

import { SAMPLE_TWEETS, type RawTweet } from "./sampleTweets";

export type { RawTweet };

/** Whether we're serving sample data rather than a live X timeline. */
export const USING_SAMPLE_DATA = true;

/** Fetch the tweets to audit for the current user. */
export async function fetchTweets(): Promise<RawTweet[]> {
  // Simulate a brief network round-trip so the "loading" state is real.
  await new Promise((r) => setTimeout(r, 250));
  return SAMPLE_TWEETS;
}
