/**
 * Tests for GET /api/x/tweets
 *
 * Verifies that the right X API functions are called depending on
 * enabled_sources: only-tweets, only-likes, and both.
 *
 * NOTE: likes are NO LONGER fetched by this route. Phase A only fetches own
 * posts/reposts (timeline). Likes are metered and drained exclusively via
 * /api/x/likes (Phase B engine loop). For a likes-only job this route returns
 * an empty tweets array.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/x/tweets/route";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin",  () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/x/oauth",         () => ({
  resolveConnectionWithIdentity: vi.fn(),
  getValidToken:                 vi.fn(),
}));
vi.mock("@/lib/x/api", () => ({
  getMe:           vi.fn(),
  listTimeline:    vi.fn(),
  listLikedTweets: vi.fn(),
  XApiError:       class XApiError extends Error {
    status: number;
    constructor(status: number, msg: string) { super(msg); this.status = status; }
  },
  MAX_FETCHABLE: 3200,
}));

const { createClient }      = await import("@/lib/supabase/server");
const { createAdminClient } = await import("@/lib/supabase/admin");
const { resolveConnectionWithIdentity, getValidToken } = await import("@/lib/x/oauth");
const { getMe, listTimeline, listLikedTweets } = await import("@/lib/x/api");

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER  = { id: "user-abc" };
const ME    = { id: "x-uid", username: "testuser", tweetCount: 100, likeCount: 50 };
const TWEET = { id: "1", text: "hi", createdAt: "2024-01-01T00:00:00Z", authorHandle: "testuser", url: "https://x.com/testuser/status/1", hasImages: false };

const CONN_FULL    = { id: "conn1", platformUserId: "x-uid", handle: "testuser" };
const CONN_PARTIAL = { id: "conn1", platformUserId: "", handle: "" };

function makeSupabaseClient(sources: string[]) {
  const mockQuery = {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { job_id: "job1", connection_id: "conn1", enabled_sources: sources, scan_limit: null },
    }),
  };
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: USER } }) },
    from: vi.fn().mockReturnValue(mockQuery),
  };
}

/** Admin client whose job_charges lookup resolves to `charge` (null = unpaid). */
function makeAdminClient(charge: { job_id: string } | null) {
  const mockQuery = {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: charge }),
  };
  return { from: vi.fn().mockReturnValue(mockQuery) };
}

function makeRequest(jobId = "job1") {
  return new Request(`http://127.0.0.1:3000/api/x/tweets?jobId=${jobId}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Job is charged by default; the 402 test overrides this.
  vi.mocked(createAdminClient).mockReturnValue(makeAdminClient({ job_id: "job1" }) as never);
  vi.mocked(resolveConnectionWithIdentity).mockResolvedValue(CONN_FULL);
  vi.mocked(getValidToken).mockResolvedValue("access_token");
  vi.mocked(getMe).mockResolvedValue(ME);
  vi.mocked(listTimeline).mockResolvedValue([TWEET]);
  vi.mocked(listLikedTweets).mockResolvedValue([{ ...TWEET, id: "like1" }]);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/x/tweets — getMe fallback behaviour", () => {
  it("does NOT call getMe when both platformUserId and handle are set", async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseClient(["own_text"]) as never);
    vi.mocked(resolveConnectionWithIdentity).mockResolvedValue(CONN_FULL);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    expect(getMe).not.toHaveBeenCalled();
  });

  it("DOES call getMe when platformUserId is empty (legacy row)", async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseClient(["own_text"]) as never);
    vi.mocked(resolveConnectionWithIdentity).mockResolvedValue(CONN_PARTIAL);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    expect(getMe).toHaveBeenCalledOnce();
  });

  it("DOES call getMe when handle is empty but platformUserId is set", async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseClient(["own_text"]) as never);
    vi.mocked(resolveConnectionWithIdentity).mockResolvedValue({
      id: "conn1",
      platformUserId: "x-uid",
      handle: "",
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    expect(getMe).toHaveBeenCalledOnce();
  });
});

describe("GET /api/x/tweets — source selection", () => {
  it("only tweets: calls listTimeline and NOT listLikedTweets", async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseClient(["own_text"]) as never);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    expect(listTimeline).toHaveBeenCalled();
    expect(listLikedTweets).not.toHaveBeenCalled();
  });

  it("only likes: returns 200 with empty tweets (likes drained by Phase B, not here)", async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseClient(["likes"]) as never);

    const res  = await GET(makeRequest());
    const body = await res.json() as { tweets: unknown[] };

    expect(res.status).toBe(200);
    // Likes are never fetched by this route — Phase B drains them metered.
    expect(listLikedTweets).not.toHaveBeenCalled();
    expect(listTimeline).not.toHaveBeenCalled();
    expect(body.tweets).toHaveLength(0);
  });

  it("tweets + likes: calls listTimeline for own_text but NOT listLikedTweets", async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabaseClient(["own_text", "likes"]) as never,
    );

    const res  = await GET(makeRequest());
    const body = await res.json() as { tweets: unknown[] };

    expect(res.status).toBe(200);
    expect(listTimeline).toHaveBeenCalled();
    // Likes are excluded from Phase A.
    expect(listLikedTweets).not.toHaveBeenCalled();
    // Result contains only own_text tweets (1 from the mock).
    expect(body.tweets).toHaveLength(1);
  });

  it("own_images: calls listTimeline (image filtering is done client-side)", async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabaseClient(["own_images"]) as never,
    );

    await GET(makeRequest());

    // own_images + own_text both come from listTimeline; the route filters by hasImages
    expect(listTimeline).toHaveBeenCalled();
    expect(listLikedTweets).not.toHaveBeenCalled();
  });

  it("returns 401 when the user is not authenticated", async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
      from: vi.fn(),
    } as never);

    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns 400 when jobId is missing", async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseClient(["own_text"]) as never);

    const res = await GET(new Request("http://127.0.0.1:3000/api/x/tweets"));
    expect(res.status).toBe(400);
  });

  it("returns 404 when the job is not found", async () => {
    const mockQuery = {
      select:      vi.fn().mockReturnThis(),
      eq:          vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    };
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: USER } }) },
      from: vi.fn().mockReturnValue(mockQuery),
    } as never);

    const res = await GET(makeRequest());
    expect(res.status).toBe(404);
  });

  it("returns 402 when the job has no job_charges row (unpaid)", async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseClient(["own_text"]) as never);
    vi.mocked(createAdminClient).mockReturnValue(makeAdminClient(null) as never);

    const res = await GET(makeRequest());
    expect(res.status).toBe(402);
    expect(listTimeline).not.toHaveBeenCalled();
  });

  it("returns 409 when no X connection is found for the user", async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseClient(["own_text"]) as never);
    vi.mocked(resolveConnectionWithIdentity).mockResolvedValue(null);

    const res = await GET(makeRequest());
    expect(res.status).toBe(409);
  });
});
