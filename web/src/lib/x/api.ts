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

export type XMe = {
  id: string;
  username: string;
  /** Total posts including reposts (X's `tweet_count`). */
  tweetCount: number;
  /** Number of posts this user has liked (X's `like_count`). */
  likeCount: number;
};

/** Current user + total post/like counts (for the billing gate). */
export async function getMe(accessToken: string): Promise<XMe> {
  const json = (await xGet(
    `${X_API}/users/me?user.fields=public_metrics`,
    accessToken,
  )) as {
    data: {
      id: string;
      username: string;
      public_metrics?: { tweet_count?: number; like_count?: number };
    };
  };
  return {
    id: json.data.id,
    username: json.data.username,
    tweetCount: json.data.public_metrics?.tweet_count ?? 0,
    likeCount: json.data.public_metrics?.like_count ?? 0,
  };
}

/** Raw X tweet object, as returned in `data` / `includes.tweets`. */
type XTweet = {
  id: string;
  text: string;
  created_at: string;
  author_id?: string;
  referenced_tweets?: Array<{ type: string; id: string }>;
  attachments?: { media_keys?: string[] };
};
type XUser = { id: string; username: string; profile_image_url?: string };
type XMedia = {
  media_key: string;
  type: string;
  /** Present for `photo` type. */
  url?: string;
  /** Present for `video` / `animated_gif` — a static preview frame. */
  preview_image_url?: string;
};

/**
 * Resolve a tweet's media_keys to displayable image URLs.
 * Photos use their native `url`; videos/GIFs use the static `preview_image_url`.
 */
function resolveMedia(
  keys: string[] | undefined,
  mediaByKey: Map<string, XMedia>,
): string[] | undefined {
  if (!keys?.length) return undefined;
  const urls = keys
    .map((k) => {
      const m = mediaByKey.get(k);
      if (!m) return undefined;
      return m.type === "photo" ? m.url : m.preview_image_url;
    })
    .filter((u): u is string => !!u);
  return urls.length ? urls : undefined;
}

/** Build a {@link RawTweet} from an X tweet given its author's handle. */
function toRawTweet(
  t: XTweet,
  handle: string,
  mediaByKey: Map<string, XMedia>,
  usersById: Map<string, XUser>,
): RawTweet {
  const user = t.author_id ? usersById.get(t.author_id) : undefined;
  return {
    id: t.id,
    text: t.text,
    createdAt: t.created_at,
    authorHandle: handle,
    url: `https://x.com/${handle}/status/${t.id}`,
    mediaUrls: resolveMedia(t.attachments?.media_keys, mediaByKey),
    authorAvatarUrl: user?.profile_image_url,
  };
}

// Bound pagination independently of `next_token`: X can return pages with a
// next_token but no usable tweets, which would otherwise loop until rate-limited.
const pageBudget = (cap: number) => Math.ceil(cap / 100) + 2;

type TimelinePage = {
  data?: XTweet[];
  includes?: { tweets?: XTweet[]; users?: XUser[]; media?: XMedia[] };
  meta?: { next_token?: string };
};

/** Which kinds of timeline items {@link listTimeline} should keep. */
export type TimelineFilter = { includePosts: boolean; includeReposts: boolean };

/**
 * Fetch up to `cap` items from the user's timeline, keeping original posts
 * and/or reposts per `filter`. Reposts resolve to the ORIGINAL tweet (full text,
 * original author handle + permalink) via expansions; if the original isn't in
 * `includes` we fall back to the (truncated "RT @…") timeline entry.
 */
export async function listTimeline(
  accessToken: string,
  userId: string,
  handle: string,
  cap: number,
  filter: TimelineFilter,
): Promise<RawTweet[]> {
  const out: RawTweet[] = [];
  let paginationToken: string | undefined;
  const maxPages = pageBudget(cap);

  for (let page = 0; page < maxPages && out.length < cap; page++) {
    const url = new URL(`${X_API}/users/${userId}/tweets`);
    url.searchParams.set("max_results", "100");
    url.searchParams.set(
      "tweet.fields",
      "created_at,referenced_tweets,attachments,author_id",
    );
    url.searchParams.set(
      "expansions",
      "author_id,referenced_tweets.id,referenced_tweets.id.author_id,attachments.media_keys",
    );
    url.searchParams.set("user.fields", "username,profile_image_url");
    url.searchParams.set("media.fields", "url,preview_image_url,type");
    // If reposts aren't wanted, let X drop them server-side.
    if (!filter.includeReposts) url.searchParams.set("exclude", "retweets");
    if (paginationToken) url.searchParams.set("pagination_token", paginationToken);

    const json = (await xGet(url, accessToken)) as TimelinePage;
    const batch = json.data ?? [];
    if (batch.length === 0) break; // no more tweets — stop (avoids spinning)

    const refTweets = new Map(
      (json.includes?.tweets ?? []).map((t) => [t.id, t]),
    );
    const users = new Map((json.includes?.users ?? []).map((u) => [u.id, u]));
    const mediaByKey = new Map(
      (json.includes?.media ?? []).map((m) => [m.media_key, m]),
    );

    for (const t of batch) {
      const retweet = t.referenced_tweets?.find((r) => r.type === "retweeted");
      if (retweet) {
        if (!filter.includeReposts) continue;
        const orig = refTweets.get(retweet.id);
        const author = orig?.author_id ? users.get(orig.author_id) : undefined;
        out.push(
          orig
            ? toRawTweet(orig, author?.username ?? handle, mediaByKey, users)
            : toRawTweet(t, handle, mediaByKey, users),
        );
      } else {
        if (!filter.includePosts) continue;
        out.push(toRawTweet(t, handle, mediaByKey, users));
      }
      if (out.length >= cap) break;
    }

    paginationToken = json.meta?.next_token;
    if (!paginationToken) break;
  }

  return out;
}

type LikedPage = {
  data?: XTweet[];
  includes?: { users?: XUser[]; media?: XMedia[] };
  meta?: { next_token?: string };
};

/**
 * Fetch up to `cap` of the user's most recently liked posts (others' content).
 * Each carries the ORIGINAL author's handle + permalink via the `author_id`
 * expansion. This is an Owned Read endpoint scoped to the authenticated user.
 */
export async function listLikedTweets(
  accessToken: string,
  userId: string,
  cap: number,
): Promise<RawTweet[]> {
  const out: RawTweet[] = [];
  let paginationToken: string | undefined;
  const maxPages = pageBudget(cap);

  for (let page = 0; page < maxPages && out.length < cap; page++) {
    const url = new URL(`${X_API}/users/${userId}/liked_tweets`);
    url.searchParams.set("max_results", "100");
    url.searchParams.set("tweet.fields", "created_at,attachments");
    url.searchParams.set("expansions", "author_id,attachments.media_keys");
    url.searchParams.set("user.fields", "username,profile_image_url");
    url.searchParams.set("media.fields", "url,preview_image_url,type");
    if (paginationToken) url.searchParams.set("pagination_token", paginationToken);

    const json = (await xGet(url, accessToken)) as LikedPage;
    const batch = json.data ?? [];
    if (batch.length === 0) break;

    const users = new Map((json.includes?.users ?? []).map((u) => [u.id, u]));
    const mediaByKey = new Map(
      (json.includes?.media ?? []).map((m) => [m.media_key, m]),
    );
    for (const t of batch) {
      const author = t.author_id ? users.get(t.author_id) : undefined;
      // Liked posts belong to other accounts; without a resolved handle we can't
      // build a correct permalink, so fall back to a generic one.
      out.push(toRawTweet(t, author?.username ?? "i", mediaByKey, users));
      if (out.length >= cap) break;
    }

    paginationToken = json.meta?.next_token;
    if (!paginationToken) break;
  }

  return out;
}
