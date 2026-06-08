/**
 * Tweet source. For X-authenticated users this fetches their real timeline from
 * the server route `/api/x/tweets` (which holds the OAuth token and enforces the
 * billing gate). For everyone else (dev login) it returns {@link SAMPLE_TWEETS}
 * so the flow stays runnable without an X account.
 */

import { SAMPLE_TWEETS, type RawTweet } from "./sampleTweets";

export type { RawTweet };

export type PaymentRequiredDetails = {
  shortfall: number;
  creditsToBuy: number;
};

/** Thrown when a live scan exceeds the free tweet limit and needs payment. */
export class PaymentRequiredError extends Error {
  details: PaymentRequiredDetails;
  constructor(details: PaymentRequiredDetails) {
    super("payment_required");
    this.name = "PaymentRequiredError";
    this.details = details;
  }
}

export type FetchTweetsOptions = { jobId?: string; live?: boolean };

/** Fetch the tweets to audit. Live for X users; sample data otherwise. */
export async function fetchTweets(
  opts: FetchTweetsOptions = {},
): Promise<RawTweet[]> {
  if (opts.live && opts.jobId) {
    const res = await fetch(
      `/api/x/tweets?jobId=${encodeURIComponent(opts.jobId)}`,
      { cache: "no-store" },
    );
    if (res.status === 402) {
      const d = await res.json();
      throw new PaymentRequiredError({
        shortfall: d.shortfall,
        creditsToBuy: d.creditsToBuy,
      });
    }
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
