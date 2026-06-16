/**
 * Tests for POST /api/x/likes/charge
 *
 * Verifies that:
 * - Unauthenticated requests are rejected with 401.
 * - Missing jobId is rejected with 400.
 * - hasImages: false → RPC called with units = 1.
 * - hasImages: true  → RPC called with units = IMAGE_TWEET_WEIGHT (4).
 * - Non-idempotency: calling twice with the same tweet charges twice.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/x/likes/charge/route";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin",  () => ({ createAdminClient: vi.fn() }));

const { createClient }      = await import("@/lib/supabase/server");
const { createAdminClient } = await import("@/lib/supabase/admin");

// ── Fixtures ──────────────────────────────────────────────────────────────────

const JOB_ID  = "job-likes-xyz";
const USER_ID = "user-1";

function makeAuthedServerClient(jobFound = true) {
  const mockQuery = {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: jobFound ? { job_id: JOB_ID } : null,
    }),
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
  return new Request("http://127.0.0.1:3000/api/x/likes/charge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/x/likes/charge", () => {
  it("returns 401 when the user is not authenticated", async () => {
    vi.mocked(createClient).mockResolvedValue(makeAnonServerClient() as never);

    const res = await POST(makeRequest({ jobId: JOB_ID, hasImages: false }));

    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("returns 400 when jobId is missing from the request body", async () => {
    vi.mocked(createClient).mockResolvedValue(makeAuthedServerClient() as never);
    vi.mocked(createAdminClient).mockReturnValue(makeAdminRpcClient() as never);

    const res = await POST(makeRequest({ hasImages: false }));

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("missing jobId");
  });

  it("returns 404 when the job is not found (RLS blocks access)", async () => {
    vi.mocked(createClient).mockResolvedValue(makeAuthedServerClient(false) as never);
    vi.mocked(createAdminClient).mockReturnValue(makeAdminRpcClient() as never);

    const res = await POST(makeRequest({ jobId: JOB_ID, hasImages: false }));

    expect(res.status).toBe(404);
  });

  it("calls charge_like with units = 1 when hasImages is false (text tweet)", async () => {
    vi.mocked(createClient).mockResolvedValue(makeAuthedServerClient() as never);
    const admin = makeAdminRpcClient(0);
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const res = await POST(makeRequest({ jobId: JOB_ID, hasImages: false }));

    expect(res.status).toBe(200);
    const body = await res.json() as { shortfall: number };
    expect(body.shortfall).toBe(0);

    expect(admin._rpcMock).toHaveBeenCalledOnce();
    expect(admin._rpcMock).toHaveBeenCalledWith("charge_like", {
      p_job_id:  JOB_ID,
      p_user_id: USER_ID,
      p_units:   1,
    });
  });

  it("calls charge_like with units = 4 (IMAGE_TWEET_WEIGHT) when hasImages is true", async () => {
    vi.mocked(createClient).mockResolvedValue(makeAuthedServerClient() as never);
    const admin = makeAdminRpcClient(0);
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const res = await POST(makeRequest({ jobId: JOB_ID, hasImages: true }));

    expect(res.status).toBe(200);

    expect(admin._rpcMock).toHaveBeenCalledOnce();
    expect(admin._rpcMock).toHaveBeenCalledWith("charge_like", {
      p_job_id:  JOB_ID,
      p_user_id: USER_ID,
      p_units:   4,  // IMAGE_TWEET_WEIGHT
    });
  });

  // Non-idempotency contract: The charge_like RPC is NOT idempotent per-like.
  // The cursor in the engine (advanced only after a successful charge) is the
  // only double-charge guard. This test pins that behavior so any future
  // idempotency fix is a deliberate decision.
  it("charges twice when called twice with the same tweet (non-idempotency contract)", async () => {
    vi.mocked(createClient).mockResolvedValue(makeAuthedServerClient() as never);
    const admin = makeAdminRpcClient(0);
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    await POST(makeRequest({ jobId: JOB_ID, hasImages: false }));
    await POST(makeRequest({ jobId: JOB_ID, hasImages: false }));

    // Both calls reach the RPC — there is no per-like dedup in this route.
    // The engine's cursor is the guard, not this route.
    expect(admin._rpcMock).toHaveBeenCalledTimes(2);
  });

  it("returns 500 when the charge_like RPC errors", async () => {
    vi.mocked(createClient).mockResolvedValue(makeAuthedServerClient() as never);
    const rpcMock = vi.fn().mockResolvedValue({ data: null, error: { message: "db error" } });
    vi.mocked(createAdminClient).mockReturnValue({ rpc: rpcMock } as never);

    const res = await POST(makeRequest({ jobId: JOB_ID, hasImages: false }));

    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("billing_error");
  });
});
