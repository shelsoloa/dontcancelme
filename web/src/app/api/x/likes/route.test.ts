/**
 * Tests for GET /api/x/likes
 *
 * Key assertions: when conn.platformUserId is populated, getMe is NOT called;
 * when it is empty (legacy row), getMe IS called as a fallback.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/x/likes/route";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/x/oauth", () => ({
  resolveConnectionWithIdentity: vi.fn(),
  getValidToken:                 vi.fn(),
}));
vi.mock("@/lib/x/api", () => ({
  getMe:               vi.fn(),
  listLikedTweetsPage: vi.fn(),
  XApiError:           class XApiError extends Error {
    status: number;
    constructor(status: number, msg: string) { super(msg); this.status = status; }
  },
}));

const { createClient } = await import("@/lib/supabase/server");
const { resolveConnectionWithIdentity, getValidToken } = await import("@/lib/x/oauth");
const { getMe, listLikedTweetsPage } = await import("@/lib/x/api");

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER = { id: "user-abc" };
const CONN_WITH_ID = { id: "conn1", platformUserId: "x-uid-123", handle: "testuser" };
const CONN_WITHOUT_ID = { id: "conn1", platformUserId: "", handle: "" };
const ME   = { id: "x-uid-123", username: "testuser", tweetCount: 0, likeCount: 0 };
const PAGE = { tweets: [], nextCursor: undefined };

function makeSupabaseClient() {
  const mockQuery = {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { job_id: "job1", connection_id: "conn1" },
    }),
  };
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: USER } }) },
    from: vi.fn().mockReturnValue(mockQuery),
  };
}

function makeRequest(jobId = "job1", cursor?: string) {
  const url = cursor
    ? `http://127.0.0.1:3000/api/x/likes?jobId=${jobId}&cursor=${cursor}`
    : `http://127.0.0.1:3000/api/x/likes?jobId=${jobId}`;
  return new Request(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createClient).mockResolvedValue(makeSupabaseClient() as never);
  vi.mocked(resolveConnectionWithIdentity).mockResolvedValue(CONN_WITH_ID);
  vi.mocked(getValidToken).mockResolvedValue("access_token");
  vi.mocked(getMe).mockResolvedValue(ME);
  vi.mocked(listLikedTweetsPage).mockResolvedValue(PAGE);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/x/likes — getMe fallback behaviour", () => {
  it("does NOT call getMe when conn.platformUserId is set", async () => {
    vi.mocked(resolveConnectionWithIdentity).mockResolvedValue(CONN_WITH_ID);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    expect(getMe).not.toHaveBeenCalled();
    expect(listLikedTweetsPage).toHaveBeenCalledWith(
      "access_token",
      CONN_WITH_ID.platformUserId,
      undefined,
    );
  });

  it("DOES call getMe when conn.platformUserId is empty (legacy row)", async () => {
    vi.mocked(resolveConnectionWithIdentity).mockResolvedValue(CONN_WITHOUT_ID);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    expect(getMe).toHaveBeenCalledOnce();
    expect(listLikedTweetsPage).toHaveBeenCalledWith(
      "access_token",
      ME.id,
      undefined,
    );
  });

  it("passes cursor to listLikedTweetsPage", async () => {
    const res = await GET(makeRequest("job1", "myCursor"));
    expect(res.status).toBe(200);
    expect(listLikedTweetsPage).toHaveBeenCalledWith(
      "access_token",
      CONN_WITH_ID.platformUserId,
      "myCursor",
    );
  });
});

describe("GET /api/x/likes — error cases", () => {
  it("returns 400 when jobId is missing", async () => {
    const res = await GET(new Request("http://127.0.0.1:3000/api/x/likes"));
    expect(res.status).toBe(400);
  });

  it("returns 401 when user is not authenticated", async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
      from: vi.fn(),
    } as never);

    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns 404 when job is not found", async () => {
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

  it("returns 409 when no X connection is found", async () => {
    vi.mocked(resolveConnectionWithIdentity).mockResolvedValue(null);

    const res = await GET(makeRequest());
    expect(res.status).toBe(409);
  });

  it("returns 409 when getValidToken throws", async () => {
    vi.mocked(getValidToken).mockRejectedValue(new Error("no creds"));

    const res = await GET(makeRequest());
    expect(res.status).toBe(409);
  });

  it("returns 429 on rate limit from X API", async () => {
    const { XApiError } = await import("@/lib/x/api");
    vi.mocked(listLikedTweetsPage).mockRejectedValue(new XApiError(429, "rate limited"));

    const res = await GET(makeRequest());
    expect(res.status).toBe(429);
  });
});
