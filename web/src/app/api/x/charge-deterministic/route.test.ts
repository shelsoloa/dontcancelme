/**
 * Tests for POST /api/x/charge-deterministic
 *
 * Verifies that:
 * - Unauthenticated requests are rejected with 401.
 * - Missing jobId is rejected with 400.
 * - Jobs with no persisted quote are rejected with 402 (quote_missing).
 * - Happy path: charge_deterministic RPC is called with the exact arg shape,
 *   in particular p_text_items = textItems + repostItems (load-bearing billing math).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/x/charge-deterministic/route";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin",  () => ({ createAdminClient: vi.fn() }));

const { createClient }      = await import("@/lib/supabase/server");
const { createAdminClient } = await import("@/lib/supabase/admin");

// ── Fixtures ──────────────────────────────────────────────────────────────────

const JOB_ID = "job-abc-123";
const USER_ID = "user-1";

type Quote = {
  deterministic: {
    textCount: number;
    imageCount: number;
    repostCount: number;
  };
};

function makeAuthedServerClient(jobData: { job_id: string; quote: Quote | null } | null = null) {
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

function makeAnonServerClient() {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    from: vi.fn(),
  };
}

function makeAdminRpcClient(shortfall = 0) {
  const rpcMock = vi.fn().mockResolvedValue({ data: shortfall, error: null });
  return { rpc: rpcMock, _rpcMock: rpcMock };
}

function makeRequest(body: Record<string, unknown> = {}) {
  return new Request("http://127.0.0.1:3000/api/x/charge-deterministic", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeJobWithQuote(
  textCount = 10,
  imageCount = 5,
  repostCount = 3,
): { job_id: string; quote: Quote } {
  return {
    job_id: JOB_ID,
    quote: { deterministic: { textCount, imageCount, repostCount } },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/x/charge-deterministic", () => {
  it("returns 401 when the user is not authenticated", async () => {
    vi.mocked(createClient).mockResolvedValue(makeAnonServerClient() as never);

    const res = await POST(makeRequest({ jobId: JOB_ID }));

    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("returns 400 when jobId is missing from the request body", async () => {
    vi.mocked(createClient).mockResolvedValue(makeAuthedServerClient() as never);
    vi.mocked(createAdminClient).mockReturnValue(makeAdminRpcClient() as never);

    const res = await POST(makeRequest({}));

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("missing jobId");
  });

  it("returns 404 when the job is not found (RLS blocks access)", async () => {
    vi.mocked(createClient).mockResolvedValue(makeAuthedServerClient(null) as never);
    vi.mocked(createAdminClient).mockReturnValue(makeAdminRpcClient() as never);

    const res = await POST(makeRequest({ jobId: JOB_ID }));

    expect(res.status).toBe(404);
  });

  it("returns 402 when the job has no persisted quote (quote_missing)", async () => {
    const jobNoQuote = { job_id: JOB_ID, quote: null };
    vi.mocked(createClient).mockResolvedValue(
      makeAuthedServerClient(jobNoQuote as never) as never,
    );
    vi.mocked(createAdminClient).mockReturnValue(makeAdminRpcClient() as never);

    const res = await POST(makeRequest({ jobId: JOB_ID }));

    expect(res.status).toBe(402);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("quote_missing");
  });

  it("happy path: calls charge_deterministic with correct args and p_text_items = textItems + repostItems", async () => {
    // textCount=10, imageCount=5, repostCount=3 → p_text_items must be 13
    const job = makeJobWithQuote(10, 5, 3);
    vi.mocked(createClient).mockResolvedValue(makeAuthedServerClient(job) as never);
    const admin = makeAdminRpcClient(0);
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const res = await POST(makeRequest({ jobId: JOB_ID }));

    expect(res.status).toBe(200);
    const body = await res.json() as { shortfall: number };
    expect(body.shortfall).toBe(0);

    // Load-bearing: p_text_items must be textCount + repostCount (both charged at 1 unit).
    expect(admin._rpcMock).toHaveBeenCalledTimes(1);
    expect(admin._rpcMock).toHaveBeenCalledWith("charge_deterministic", {
      p_job_id:      JOB_ID,
      p_user_id:     USER_ID,
      p_text_items:  13,  // 10 text + 3 reposts — NOT just 10
      p_image_items: 5,
    });
  });

  it("happy path: returns shortfall > 0 when the user has insufficient balance", async () => {
    const job = makeJobWithQuote(100, 50, 20);
    vi.mocked(createClient).mockResolvedValue(makeAuthedServerClient(job) as never);
    // Simulate the RPC returning a shortfall of 42 credits.
    const admin = makeAdminRpcClient(42);
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const res = await POST(makeRequest({ jobId: JOB_ID }));

    expect(res.status).toBe(200);
    const body = await res.json() as { shortfall: number };
    expect(body.shortfall).toBe(42);
  });

  it("returns 500 when the charge_deterministic RPC errors", async () => {
    const job = makeJobWithQuote(5, 2, 1);
    vi.mocked(createClient).mockResolvedValue(makeAuthedServerClient(job) as never);
    const rpcMock = vi.fn().mockResolvedValue({ data: null, error: { message: "db error" } });
    vi.mocked(createAdminClient).mockReturnValue({ rpc: rpcMock } as never);

    const res = await POST(makeRequest({ jobId: JOB_ID }));

    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("billing_error");
  });
});
