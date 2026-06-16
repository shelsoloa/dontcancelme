/**
 * Tests for POST /api/quote
 *
 * Verifies that:
 * - Unauthenticated requests are rejected with 401.
 * - jobId not owned by user (RLS / not found) → 404.
 * - Rate-limit exceeded → 429.
 * - Happy-path response includes the expected top-level fields.
 * - No X connection → 409.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/quote/route";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin",  () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/x/oauth", () => ({
  resolveConnectionId: vi.fn(),
  getValidToken:       vi.fn(),
}));
vi.mock("@/lib/x/api", () => ({
  getMe:          vi.fn(),
  countOwnTweets: vi.fn(),
  XApiError:      class XApiError extends Error {
    status: number;
    constructor(status: number, msg: string) { super(msg); this.status = status; }
  },
}));

const { createClient }      = await import("@/lib/supabase/server");
const { createAdminClient } = await import("@/lib/supabase/admin");
const { resolveConnectionId, getValidToken } = await import("@/lib/x/oauth");
const { getMe, countOwnTweets } = await import("@/lib/x/api");

// ── Fixtures ──────────────────────────────────────────────────────────────────

const JOB_ID  = "job-quote-999";
const USER_ID = "user-quote-1";

const ME_FIXTURE = {
  id:         "x-user-1",
  username:   "testuser",
  tweetCount: 80,
  likeCount:  30,
};

const COUNTS_FIXTURE = {
  textCount:   50,
  imageCount:  20,
  repostCount: 10,
};

function makeAnonServerClient() {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    from: vi.fn(),
  };
}

function makeAuthedServerClient(jobData: object | null = null) {
  const mockQuery = {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: jobData }),
  };
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
    from: vi.fn().mockReturnValue(mockQuery),
  };
}

function makeDefaultJob(overrides: Record<string, unknown> = {}) {
  return {
    job_id:           JOB_ID,
    connection_id:    "conn-1",
    enabled_sources:  ["own_text", "own_images", "reposts"],
    scan_limit:       null,
    likes_cap:        null,
    ...overrides,
  };
}

/** Admin client that allows rate-limiting token (granted = true by default) */
function makeAdminClient(opts: {
  tokenGranted?: boolean;
  freeUsed?: number;
  balance?: number;
} = {}) {
  const { tokenGranted = true, freeUsed = 0, balance = 500 } = opts;

  const rpcMock = vi.fn().mockResolvedValue({ data: tokenGranted, error: null });

  // user_credits query
  const creditsMockQuery = {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { free_used: freeUsed, balance },
    }),
  };

  // audit_jobs update (for quote persistence)
  const updateMockQuery = {
    update: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockResolvedValue({ error: null }),
  };

  return {
    rpc:          rpcMock,
    _rpcMock:     rpcMock,
    from: vi.fn((table: string) => {
      if (table === "user_credits") return creditsMockQuery;
      if (table === "audit_jobs")   return updateMockQuery;
      return creditsMockQuery;
    }),
  };
}

function makeRequest(body: Record<string, unknown> = {}) {
  return new Request("http://127.0.0.1:3000/api/quote", {
    method:  "POST",
    headers: { "content-type": "application/json" },
    body:    JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveConnectionId).mockResolvedValue("conn-1");
  vi.mocked(getValidToken).mockResolvedValue("access_token");
  vi.mocked(getMe).mockResolvedValue(ME_FIXTURE);
  vi.mocked(countOwnTweets).mockResolvedValue(COUNTS_FIXTURE);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/quote", () => {
  it("returns 401 when the user is not authenticated", async () => {
    vi.mocked(createClient).mockResolvedValue(makeAnonServerClient() as never);

    // Note: quote route checks jobId before auth — provide it
    const res = await POST(makeRequest({ jobId: JOB_ID }));

    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("returns 400 when jobId is missing", async () => {
    // Quote route validates jobId first (before auth check)
    vi.mocked(createClient).mockResolvedValue(makeAnonServerClient() as never);
    vi.mocked(createAdminClient).mockReturnValue(makeAdminClient() as never);

    const res = await POST(makeRequest({}));

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("missing jobId");
  });

  it("returns 404 when the job is not found (RLS blocks access / not owned by user)", async () => {
    vi.mocked(createClient).mockResolvedValue(makeAuthedServerClient(null) as never);
    vi.mocked(createAdminClient).mockReturnValue(makeAdminClient() as never);

    const res = await POST(makeRequest({ jobId: JOB_ID }));

    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("job not found");
  });

  it("returns 429 when the rate limit is exceeded", async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeAuthedServerClient(makeDefaultJob()) as never,
    );
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminClient({ tokenGranted: false }) as never,
    );

    const res = await POST(makeRequest({ jobId: JOB_ID }));

    expect(res.status).toBe(429);
    const body = await res.json() as { error: string; retryAfterSeconds: number };
    expect(body.error).toBe("rate_limit_exceeded");
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("returns 409 when no X connection is available for the user", async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeAuthedServerClient(makeDefaultJob()) as never,
    );
    vi.mocked(createAdminClient).mockReturnValue(makeAdminClient() as never);
    vi.mocked(resolveConnectionId).mockResolvedValue(null);

    const res = await POST(makeRequest({ jobId: JOB_ID }));

    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("no_connection");
  });

  it("happy path: response includes all expected top-level fields", async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeAuthedServerClient(makeDefaultJob()) as never,
    );
    vi.mocked(createAdminClient).mockReturnValue(makeAdminClient() as never);

    const res = await POST(makeRequest({ jobId: JOB_ID }));

    expect(res.status).toBe(200);

    const body = await res.json() as {
      deterministic: {
        textCount: number;
        imageCount: number;
        repostCount: number;
        freeApplied: number;
        units: number;
        usd: string;
      };
      likes: {
        enabled: boolean;
        capN: number | null;
        suggestedBundleUnits: number;
        suggestedBundleUsd: string;
        metered: boolean;
      };
      totalUpfrontUnits: number;
      totalUpfrontUsd: string;
      currentBalance: number;
    };

    // Top-level shape
    expect(body).toHaveProperty("deterministic");
    expect(body).toHaveProperty("likes");
    expect(body).toHaveProperty("totalUpfrontUnits");
    expect(body).toHaveProperty("totalUpfrontUsd");
    expect(body).toHaveProperty("currentBalance");

    // Deterministic block mirrors the counts from countOwnTweets
    expect(body.deterministic.textCount).toBe(50);
    expect(body.deterministic.imageCount).toBe(20);
    expect(body.deterministic.repostCount).toBe(10);
    expect(body.deterministic.freeApplied).toBeGreaterThanOrEqual(0);
    expect(body.deterministic.usd).toMatch(/^\d+\.\d{2}$/);

    // Likes block structure
    expect(body.likes.metered).toBe(true);
    expect(typeof body.likes.enabled).toBe("boolean");
  });
});
