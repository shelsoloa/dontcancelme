/**
 * Tests for the two-phase audit engine.
 *
 * Source functions (fetchTweets, fetchLikesPage, chargeLike) are mocked so
 * tests run without network or DB access.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAudit, runLikesDrain } from "@/lib/audit/engine";
import type { AuditedPost, RiskCategory } from "@/lib/audit/types";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/audit/source", () => ({
  fetchTweets:    vi.fn(),
  fetchLikesPage: vi.fn(),
  chargeLike:     vi.fn(),
}));

const sourceMocks = await import("@/lib/audit/source");
const fetchTweets    = vi.mocked(sourceMocks.fetchTweets);
const fetchLikesPage = vi.mocked(sourceMocks.fetchLikesPage);
const chargeLike     = vi.mocked(sourceMocks.chargeLike);

// ── Shared fixtures ───────────────────────────────────────────────────────────

function makeTweet(id = "1") {
  return {
    id,
    text:          "hello world",
    createdAt:     "2024-01-01T00:00:00Z",
    authorHandle:  "you",
    url:           `https://x.com/you/status/${id}`,
    hasImages:     false as boolean,
    mediaUrls:     undefined as string[] | undefined,
  };
}

function makeLikeTweet(id = "1", hasImages = false) {
  return { ...makeTweet(id), hasImages };
}

const BASE_DRAIN_ARGS = {
  jobId:            "job1",
  userId:           "user1",
  enabledCategories: [] as [],
  likesCap:         200,
  initialCursor:    undefined as string | undefined,
  initialProcessed: 0,
  priorPosts:       [] as AuditedPost[],
  priorStats:       {} as Record<never, number>,
  stepDelayMs:      0,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ── runAudit (Phase A) ────────────────────────────────────────────────────────

describe("runAudit", () => {
  it("fetches tweets and returns a snapshot with one post per tweet", async () => {
    fetchTweets.mockResolvedValue([makeTweet("1"), makeTweet("2")]);

    const result = await runAudit({
      jobId: "job1", userId: "user1", enabledCategories: [], live: true, stepDelayMs: 0,
    });

    expect(fetchTweets).toHaveBeenCalledWith({ jobId: "job1", live: true });
    expect(result.posts).toHaveLength(2);
    expect(result.progress.total).toBe(2);
    expect(result.progress.processed).toBe(2);
    // likes fetch is not called from runAudit
    expect(fetchLikesPage).not.toHaveBeenCalled();
  });

  it("detects flags and accumulates stats", async () => {
    // A tweet with text known to trigger the credentials detector
    fetchTweets.mockResolvedValue([{ ...makeTweet("1"), text: "AKIA1234567890ABCDEF" }]);

    const result = await runAudit({
      jobId: "j", userId: "u",
      enabledCategories: ["credentials" as RiskCategory],
      stepDelayMs: 0,
    });

    expect(result.progress.flagged).toBe(1);
    expect(result.stats.credentials).toBe(1);
    expect(result.posts[0]!.flags).not.toHaveLength(0);
  });

  it("throws AbortError when signal is aborted mid-scan", async () => {
    const controller = new AbortController();
    let callCount = 0;
    fetchTweets.mockResolvedValue([makeTweet("1"), makeTweet("2"), makeTweet("3")]);

    // Abort after first onProgress call
    await expect(
      runAudit({
        jobId: "j", userId: "u", enabledCategories: [], stepDelayMs: 0,
        signal: controller.signal,
        onProgress: () => {
          callCount++;
          if (callCount === 1) controller.abort();
        },
      }),
    ).rejects.toThrow("Audit aborted");
  });

  it("preserves auditSource for own_text and reposts posts", async () => {
    fetchTweets.mockResolvedValue([
      { ...makeTweet("10"), auditSource: "own_text" as const },
      { ...makeTweet("11"), auditSource: "reposts" as const },
    ]);

    const result = await runAudit({
      jobId: "job1", userId: "user1", enabledCategories: [], live: true, stepDelayMs: 0,
    });

    expect(result.posts[0]!.auditSource).toBe("own_text");
    expect(result.posts[1]!.auditSource).toBe("reposts");
  });
});

// ── runLikesDrain (Phase B) ───────────────────────────────────────────────────

describe("runLikesDrain", () => {
  it("only likes: calls fetchLikesPage and charges per tweet", async () => {
    fetchLikesPage.mockResolvedValue({
      tweets:     [makeLikeTweet("1"), makeLikeTweet("2")],
      nextCursor: undefined,
    });
    chargeLike.mockResolvedValue({ shortfall: 0 });

    const result = await runLikesDrain(BASE_DRAIN_ARGS);

    expect(result.kind).toBe("completed");
    expect(result.processedCount).toBe(2);
    expect(chargeLike).toHaveBeenCalledTimes(2);
    // Phase A fetcher is NOT called from runLikesDrain
    expect(fetchTweets).not.toHaveBeenCalled();
  });

  it("merges phase-A priorPosts into the returned snapshot", async () => {
    fetchLikesPage.mockResolvedValue({
      tweets:     [makeLikeTweet("10")],
      nextCursor: undefined,
    });
    chargeLike.mockResolvedValue({ shortfall: 0 });

    // Simulate one Phase-A post already in priorPosts (flags must be an array)
    const fakePost = { id: "prior-post", jobId: "job1", userId: "user1", flags: [] } as unknown as AuditedPost;

    const result = await runLikesDrain({ ...BASE_DRAIN_ARGS, priorPosts: [fakePost] });

    expect(result.kind).toBe("completed");
    // 1 prior + 1 new = 2 total posts in the snapshot
    expect(result.snapshot.posts).toHaveLength(2);
    expect(result.snapshot.posts[0]).toBe(fakePost);
  });

  it("stops when balance runs out and advances cursor to the next page", async () => {
    // Three tweets on a page with a next-page cursor
    fetchLikesPage.mockResolvedValue({
      tweets: [makeLikeTweet("1"), makeLikeTweet("2"), makeLikeTweet("3")],
      nextCursor: "page2cursor",
    });
    chargeLike
      .mockResolvedValueOnce({ shortfall: 0 })   // tweet 1 — OK
      .mockResolvedValueOnce({ shortfall: 0 })   // tweet 2 — OK
      .mockResolvedValueOnce({ shortfall: 5 });  // tweet 3 — out of credits

    const onExhausted = vi.fn();
    const result = await runLikesDrain({ ...BASE_DRAIN_ARGS, onExhausted });

    expect(result.kind).toBe("exhausted");
    if (result.kind !== "exhausted") throw new Error("unreachable");
    // Two tweets were charged and processed before the shortfall
    expect(result.processedCount).toBe(2);
    expect(result.snapshot.posts).toHaveLength(2);
    // The cursor skips to the NEXT page — avoids double-charging current-page remainder
    expect(result.nextCursor).toBe("page2cursor");
    expect(onExhausted).toHaveBeenCalledWith(2, "page2cursor");
  });

  it("shows partial posts processed before credits ran out", async () => {
    fetchLikesPage.mockResolvedValue({
      tweets: Array.from({ length: 5 }, (_, i) => makeLikeTweet(String(i))),
      nextCursor: "next",
    });
    // Runs out after 3
    chargeLike
      .mockResolvedValueOnce({ shortfall: 0 })
      .mockResolvedValueOnce({ shortfall: 0 })
      .mockResolvedValueOnce({ shortfall: 0 })
      .mockResolvedValueOnce({ shortfall: 1 });

    const result = await runLikesDrain(BASE_DRAIN_ARGS);

    expect(result.kind).toBe("exhausted");
    expect(result.processedCount).toBe(3);
    // The snapshot carries those 3 posts so the UI can display them
    expect(result.snapshot.posts).toHaveLength(3);
  });

  it("completes normally when all pages are drained within cap", async () => {
    fetchLikesPage
      .mockResolvedValueOnce({
        tweets:     Array.from({ length: 3 }, (_, i) => makeLikeTweet(String(i))),
        nextCursor: "p2",
      })
      .mockResolvedValueOnce({
        tweets:     [makeLikeTweet("10")],
        nextCursor: undefined, // last page
      });
    chargeLike.mockResolvedValue({ shortfall: 0 });

    const result = await runLikesDrain(BASE_DRAIN_ARGS);

    expect(result.kind).toBe("completed");
    expect(result.processedCount).toBe(4);
  });

  // ── Stop control ────────────────────────────────────────────────────────────

  it("returns { kind: stopped } immediately when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort(); // already aborted before the loop starts

    const onExhausted = vi.fn();
    const result = await runLikesDrain({
      ...BASE_DRAIN_ARGS,
      signal:      controller.signal,
      onExhausted,
    });

    expect(result.kind).toBe("stopped");
    expect(result.processedCount).toBe(0);
    expect(fetchLikesPage).not.toHaveBeenCalled();
    // onExhausted is called so the runner can persist the cursor
    expect(onExhausted).toHaveBeenCalledWith(0, undefined);
  });

  it("returns { kind: stopped } mid-page and retains processed posts", async () => {
    const controller = new AbortController();

    fetchLikesPage.mockResolvedValue({
      tweets:     [makeLikeTweet("1"), makeLikeTweet("2"), makeLikeTweet("3")],
      nextCursor: "next-page",
    });
    // Abort after the second tweet is processed
    let chargeCount = 0;
    chargeLike.mockImplementation(async () => {
      chargeCount++;
      if (chargeCount === 2) controller.abort();
      return { shortfall: 0 };
    });

    const result = await runLikesDrain({
      ...BASE_DRAIN_ARGS,
      signal: controller.signal,
    });

    expect(result.kind).toBe("stopped");
    if (result.kind !== "stopped") throw new Error("unreachable");
    // 2 tweets were charged and processed before abort was detected
    expect(result.processedCount).toBe(2);
    expect(result.snapshot.posts).toHaveLength(2);
    // Cursor advances to NEXT page to prevent double-charges on resume
    expect(result.nextCursor).toBe("next-page");
  });

  // ── Empty-page cursor-following (M1.2 fix) ──────────────────────────────────

  it("follows nextCursor through an empty first page to reach tweets on subsequent pages", async () => {
    // X returns an empty page on the first call but with a cursor — the drain
    // must follow it rather than treating it as end-of-list.
    fetchLikesPage
      .mockResolvedValueOnce({ tweets: [], nextCursor: "cursor2" })           // empty first page
      .mockResolvedValueOnce({ tweets: [makeLikeTweet("1"), makeLikeTweet("2")], nextCursor: undefined });
    chargeLike.mockResolvedValue({ shortfall: 0 });

    const result = await runLikesDrain(BASE_DRAIN_ARGS);

    expect(result.kind).toBe("completed");
    expect(result.processedCount).toBe(2);
    expect(fetchLikesPage).toHaveBeenCalledTimes(2);
  });

  it("stops after MAX_EMPTY_STREAK consecutive empty pages to prevent infinite loops", async () => {
    // Simulates a persistently-empty feed with a cursor that never resolves to
    // real tweets. The drain must stop within a bounded number of fetches.
    fetchLikesPage.mockResolvedValue({ tweets: [], nextCursor: "always-has-cursor" });
    chargeLike.mockResolvedValue({ shortfall: 0 });

    const result = await runLikesDrain(BASE_DRAIN_ARGS);

    expect(result.kind).toBe("completed");
    expect(result.processedCount).toBe(0);
    // Should stop well within MAX_EMPTY_STREAK + 1 calls (currently 9 max)
    expect(fetchLikesPage.mock.calls.length).toBeLessThanOrEqual(10);
    expect(fetchLikesPage.mock.calls.length).toBeGreaterThan(1);
  });

  it("completes immediately when an empty page has no nextCursor (genuine end of list)", async () => {
    fetchLikesPage.mockResolvedValueOnce({ tweets: [], nextCursor: undefined });
    chargeLike.mockResolvedValue({ shortfall: 0 });

    const result = await runLikesDrain(BASE_DRAIN_ARGS);

    expect(result.kind).toBe("completed");
    expect(result.processedCount).toBe(0);
    expect(fetchLikesPage).toHaveBeenCalledTimes(1);
  });

  it("returns exhausted with reason rate_limited when fetchLikesPage throws RateLimitedError", async () => {
    const rateLimitErr = Object.assign(new Error("X API rate limit exceeded"), {
      name: "RateLimitedError",
    });
    fetchLikesPage.mockRejectedValueOnce(rateLimitErr);

    const onExhausted = vi.fn();
    const result = await runLikesDrain({ ...BASE_DRAIN_ARGS, onExhausted });

    expect(result.kind).toBe("exhausted");
    if (result.kind !== "exhausted") throw new Error("unreachable");
    expect(result.reason).toBe("rate_limited");
    expect(result.processedCount).toBe(0);
    expect(onExhausted).toHaveBeenCalledWith(0, undefined);
  });

  it("returns { kind: stopped } between pages when aborted after a full page", async () => {
    const controller = new AbortController();

    fetchLikesPage
      .mockResolvedValueOnce({
        tweets:     [makeLikeTweet("1")],
        nextCursor: "page2",
      })
      .mockResolvedValueOnce({
        tweets:     [makeLikeTweet("2")],
        nextCursor: undefined,
      });
    chargeLike.mockResolvedValue({ shortfall: 0 });

    // Abort after first page is fully processed (before second page is fetched)
    const originalFetch = fetchLikesPage.getMockImplementation();
    let pageCount = 0;
    fetchLikesPage.mockImplementation(async (...args) => {
      pageCount++;
      if (pageCount === 2) controller.abort();
      return originalFetch!(...args);
    });
    // Need to reset since above mock overrides. Let's do it differently:
    fetchLikesPage.mockReset();
    fetchLikesPage
      .mockResolvedValueOnce({ tweets: [makeLikeTweet("1")], nextCursor: "page2" })
      .mockResolvedValueOnce({ tweets: [makeLikeTweet("2")], nextCursor: undefined });
    // Abort when second page is about to be fetched: signal check happens at
    // top of while loop, after first page's cursor was set to "page2".
    // We simulate that by aborting after first chargeLike resolves.
    chargeLike.mockImplementationOnce(async () => {
      controller.abort(); // triggers the between-pages check on next iteration
      return { shortfall: 0 };
    });

    const result = await runLikesDrain({
      ...BASE_DRAIN_ARGS,
      signal: controller.signal,
    });

    expect(result.kind).toBe("stopped");
    if (result.kind !== "stopped") throw new Error("unreachable");
    // First page tweet was processed
    expect(result.processedCount).toBe(1);
    // Cursor is "page2" (the between-pages check uses the updated cursor)
    expect(result.nextCursor).toBe("page2");
    // Second page was never fetched
    expect(fetchLikesPage).toHaveBeenCalledTimes(1);
  });
});
