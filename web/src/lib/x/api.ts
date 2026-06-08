import type { RawTweet } from "@/lib/audit/sampleTweets";

/**
 * Thin X API v2 client. Text-only (v1 has no media handling). Callers pass a
 * valid bearer access token (see {@link getValidToken}). The user's own tweets
 * are not secret — only the OAuth token is — so these are safe to return to the
 * browser for client-side detection.
 *
 * Every request has a hard timeout: Node's fetch never times out on its own, so
 * a stalled X connection would otherwise hang the ingestion route forever.
 */

const X_API = "https://api.x.com/2";
const REQUEST_TIMEOUT_MS = 15_000;

/** The X user-timeline endpoint returns at most ~3,200 recent tweets. */
export const MAX_FETCHABLE = 3200;

export class XApiError extends Error {
  status: number;
  constructor(status: number, body: string) {
    super(`X API ${status}: ${body.slice(0, 300)}`);
    this.name = "XApiError";
    this.status = status;
  }
}

async function xGet(url: string | URL, accessToken: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    // Network failure or timeout — surface as a gateway timeout, never hang.
    throw new XApiError(504, e instanceof Error ? e.message : "request failed");
  }
  if (!res.ok) throw new XApiError(res.status, await res.text());
  return res.json();
}

export type XMe = { id: string; username: string; tweetCount: number };

/** Current user + total tweet count (for the billing gate). */
export async function getMe(accessToken: string): Promise<XMe> {
  const json = (await xGet(
    `${X_API}/users/me?user.fields=public_metrics`,
    accessToken,
  )) as {
    data: { id: string; username: string; public_metrics?: { tweet_count?: number } };
  };
  return {
    id: json.data.id,
    username: json.data.username,
    tweetCount: json.data.public_metrics?.tweet_count ?? 0,
  };
}

type TweetsPage = {
  data?: Array<{ id: string; text: string; created_at: string }>;
  meta?: { next_token?: string };
};

/** Fetch up to `cap` of the user's most recent tweets. */
export async function listTweets(
  accessToken: string,
  userId: string,
  handle: string,
  cap: number,
): Promise<RawTweet[]> {
  const out: RawTweet[] = [];
  let paginationToken: string | undefined;
  // Bound the loop independently of `next_token`: X can return pages with a
  // next_token but no usable tweets, which would otherwise loop until rate-limited.
  const maxPages = Math.ceil(cap / 100) + 2;

  for (let page = 0; page < maxPages && out.length < cap; page++) {
    const url = new URL(`${X_API}/users/${userId}/tweets`);
    url.searchParams.set("max_results", "100");
    url.searchParams.set("tweet.fields", "created_at");
    if (paginationToken) url.searchParams.set("pagination_token", paginationToken);

    const json = (await xGet(url, accessToken)) as TweetsPage;
    const batch = json.data ?? [];
    if (batch.length === 0) break; // no more tweets — stop (avoids spinning)

    for (const t of batch) {
      out.push({
        id: t.id,
        text: t.text,
        createdAt: t.created_at,
        authorHandle: handle,
        url: `https://x.com/${handle}/status/${t.id}`,
      });
      if (out.length >= cap) break;
    }

    paginationToken = json.meta?.next_token;
    if (!paginationToken) break;
  }

  return out;
}
