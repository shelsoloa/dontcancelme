/**
 * Tests for the X API client — focuses on tweet parsing (toRawTweet /
 * resolveMedia / tweetHasPhotos / tweetHasVideo) exercised through the
 * exported functions listLikedTweetsPage and listTimeline.
 *
 * Global fetch is stubbed; no real HTTP calls are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  tweetHasPhotos,
  tweetHasVideo,
  listLikedTweetsPage,
  listTimeline,
} from "@/lib/x/api";

// ── fetch stub helpers ────────────────────────────────────────────────────────

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status:  200,
    headers: { "Content-Type": "application/json" },
  });
}

function xLikedPage(
  tweets: unknown[],
  includes: unknown = {},
  nextToken?: string,
) {
  return okJson({
    data: tweets,
    includes,
    meta: nextToken ? { next_token: nextToken } : {},
  });
}

function xTimelinePage(
  tweets: unknown[],
  includes: unknown = {},
  nextToken?: string,
) {
  return okJson({
    data: tweets,
    includes,
    meta: nextToken ? { next_token: nextToken } : {},
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ── tweetHasPhotos / tweetHasVideo — direct unit tests ───────────────────────

describe("tweetHasPhotos", () => {
  it("returns true when media key resolves to a photo", () => {
    const media = new Map([["mk1", { media_key: "mk1", type: "photo", url: "https://img.x.com/photo.jpg" }]]);
    const tweet = { id: "1", text: "hi", created_at: "", attachments: { media_keys: ["mk1"] } };
    expect(tweetHasPhotos(tweet as Parameters<typeof tweetHasPhotos>[0], media as Parameters<typeof tweetHasPhotos>[1])).toBe(true);
  });

  it("returns false when media key resolves to a video", () => {
    const media = new Map([["mv1", { media_key: "mv1", type: "video", preview_image_url: "https://preview.x.com/v.jpg" }]]);
    const tweet = { id: "1", text: "hi", created_at: "", attachments: { media_keys: ["mv1"] } };
    expect(tweetHasPhotos(tweet as Parameters<typeof tweetHasPhotos>[0], media as Parameters<typeof tweetHasPhotos>[1])).toBe(false);
  });

  it("returns false when no attachments", () => {
    const media = new Map<string, { media_key: string; type: string }>();
    const tweet = { id: "1", text: "hi", created_at: "" };
    expect(tweetHasPhotos(tweet as Parameters<typeof tweetHasPhotos>[0], media as Parameters<typeof tweetHasPhotos>[1])).toBe(false);
  });
});

describe("tweetHasVideo", () => {
  it("returns true for video type", () => {
    const media = new Map([["mv1", { media_key: "mv1", type: "video" }]]);
    const tweet = { id: "1", text: "hi", created_at: "", attachments: { media_keys: ["mv1"] } };
    expect(tweetHasVideo(tweet as Parameters<typeof tweetHasVideo>[0], media as Parameters<typeof tweetHasVideo>[1])).toBe(true);
  });

  it("returns true for animated_gif type", () => {
    const media = new Map([["mg1", { media_key: "mg1", type: "animated_gif" }]]);
    const tweet = { id: "1", text: "hi", created_at: "", attachments: { media_keys: ["mg1"] } };
    expect(tweetHasVideo(tweet as Parameters<typeof tweetHasVideo>[0], media as Parameters<typeof tweetHasVideo>[1])).toBe(true);
  });

  it("returns false for photo type", () => {
    const media = new Map([["mk1", { media_key: "mk1", type: "photo", url: "https://img.x.com/photo.jpg" }]]);
    const tweet = { id: "1", text: "hi", created_at: "", attachments: { media_keys: ["mk1"] } };
    expect(tweetHasVideo(tweet as Parameters<typeof tweetHasVideo>[0], media as Parameters<typeof tweetHasVideo>[1])).toBe(false);
  });
});

// ── listLikedTweetsPage ───────────────────────────────────────────────────────

describe("listLikedTweetsPage", () => {
  it("parses a regular text tweet (no media)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      xLikedPage([
        { id: "1", text: "hello world", created_at: "2024-01-01T00:00:00Z", author_id: "u1" },
      ], {
        users: [{ id: "u1", username: "alice" }],
        media: [],
      }),
    );

    const page = await listLikedTweetsPage("tok", "me");

    expect(page.tweets).toHaveLength(1);
    const t = page.tweets[0]!;
    expect(t.id).toBe("1");
    expect(t.text).toBe("hello world");
    expect(t.authorHandle).toBe("alice");
    expect(t.url).toBe("https://x.com/alice/status/1");
    expect(t.hasImages).toBe(false);
    expect(t.mediaUrls).toBeUndefined();
    expect(page.nextCursor).toBeUndefined();
  });

  it("parses a tweet with 1 image (hasImages: true)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      xLikedPage([
        {
          id: "2", text: "photo post", created_at: "2024-01-01T00:00:00Z",
          author_id: "u1",
          attachments: { media_keys: ["mk1"] },
        },
      ], {
        users: [{ id: "u1", username: "bob" }],
        media: [{ media_key: "mk1", type: "photo", url: "https://img.x.com/photo1.jpg" }],
      }),
    );

    const page = await listLikedTweetsPage("tok", "me");
    const t = page.tweets[0]!;

    expect(t.hasImages).toBe(true);
    expect(t.mediaUrls).toEqual(["https://img.x.com/photo1.jpg"]);
  });

  it("parses a tweet with multiple images", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      xLikedPage([
        {
          id: "3", text: "gallery", created_at: "2024-01-01T00:00:00Z",
          author_id: "u1",
          attachments: { media_keys: ["mk1", "mk2"] },
        },
      ], {
        users: [{ id: "u1", username: "carol" }],
        media: [
          { media_key: "mk1", type: "photo", url: "https://img.x.com/a.jpg" },
          { media_key: "mk2", type: "photo", url: "https://img.x.com/b.jpg" },
        ],
      }),
    );

    const page = await listLikedTweetsPage("tok", "me");
    const t = page.tweets[0]!;

    expect(t.hasImages).toBe(true);
    expect(t.mediaUrls).toHaveLength(2);
    expect(t.mediaUrls).toEqual([
      "https://img.x.com/a.jpg",
      "https://img.x.com/b.jpg",
    ]);
  });

  it("excludes video-only liked tweets (hasImages: false, video content)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      xLikedPage([
        {
          id: "4", text: "video post", created_at: "2024-01-01T00:00:00Z",
          author_id: "u1",
          attachments: { media_keys: ["mv1"] },
        },
      ], {
        users: [{ id: "u1", username: "dave" }],
        media: [{ media_key: "mv1", type: "video", preview_image_url: "https://preview.x.com/v.jpg" }],
      }),
    );

    const page = await listLikedTweetsPage("tok", "me");
    // Video-only tweets are excluded — matching the own-content path behaviour.
    expect(page.tweets).toHaveLength(0);
  });

  it("exposes nextCursor from meta.next_token", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      xLikedPage(
        [{ id: "1", text: "t", created_at: "2024-01-01T00:00:00Z", author_id: "u1" }],
        { users: [{ id: "u1", username: "eve" }] },
        "cursor_abc",
      ),
    );

    const page = await listLikedTweetsPage("tok", "me");
    expect(page.nextCursor).toBe("cursor_abc");
  });

  it("sends the request to api.x.com with the correct URL", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(xLikedPage([], {}, undefined));

    await listLikedTweetsPage("tok", "user-123");

    const calledUrl = String(vi.mocked(fetch).mock.calls[0]![0]);
    expect(calledUrl).toContain("https://api.x.com/2/users/user-123/liked_tweets");
  });

  it("passes the cursor via pagination_token when provided", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(xLikedPage([], {}, undefined));

    await listLikedTweetsPage("tok", "uid", "myCursor");

    const calledUrl = String(vi.mocked(fetch).mock.calls[0]![0]);
    expect(calledUrl).toContain("pagination_token=myCursor");
  });
});

// ── listTimeline — retweet parsing ────────────────────────────────────────────

describe("listTimeline — retweet parsing", () => {
  it("resolves the original tweet's author handle and URL for a retweet", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      xTimelinePage(
        [
          {
            // The timeline entry for the retweet (truncated "RT @…" text)
            id: "rt1", text: "RT @origauthor: original tweet text",
            created_at: "2024-01-01T00:00:00Z",
            author_id:  "retweeter_id",
            referenced_tweets: [{ type: "retweeted", id: "orig1" }],
          },
        ],
        {
          // Expanded original tweet
          tweets: [
            {
              id: "orig1", text: "original tweet text",
              created_at: "2024-01-01T00:00:00Z",
              author_id: "orig_author_id",
            },
          ],
          users: [
            { id: "retweeter_id", username: "retweeter" },
            { id: "orig_author_id", username: "origauthor" },
          ],
        },
      ),
    );

    const tweets = await listTimeline("tok", "retweeter_id", "retweeter", 100, {
      includePosts:   false,
      includeReposts: true,
    });

    expect(tweets).toHaveLength(1);
    const t = tweets[0]!;
    // Should use the ORIGINAL tweet's text
    expect(t.text).toBe("original tweet text");
    // Should use the original author's handle
    expect(t.authorHandle).toBe("origauthor");
    // URL points to the original tweet
    expect(t.url).toBe("https://x.com/origauthor/status/orig1");
  });

  it("sends the request to api.x.com for the given userId", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(xTimelinePage([], {}));

    await listTimeline("tok", "uid123", "handle", 100, { includePosts: true, includeReposts: false });

    const calledUrl = String(vi.mocked(fetch).mock.calls[0]![0]);
    expect(calledUrl).toContain("https://api.x.com/2/users/uid123/tweets");
  });
});
