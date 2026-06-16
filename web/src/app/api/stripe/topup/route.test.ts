/**
 * Tests for POST /api/stripe/topup
 *
 * Verifies that:
 * - Unauthenticated requests are rejected with 401.
 * - Amount below STRIPE_MIN_UNITS (50) → 400.
 * - Happy path: a pending credit_purchases row is inserted with the Stripe
 *   session id, and the session URL is returned.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/stripe/topup/route";
import { STRIPE_MIN_UNITS } from "@/lib/billing";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin",  () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/stripe",          () => ({ getStripe: vi.fn() }));

const { createClient }      = await import("@/lib/supabase/server");
const { createAdminClient } = await import("@/lib/supabase/admin");
const { getStripe }         = await import("@/lib/stripe");

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_ID    = "user-topup-1";
const SESSION_ID = "cs_test_topup_abc";
const SESSION_URL = "https://checkout.stripe.com/pay/cs_test_topup_abc";
const VALID_CREDITS = STRIPE_MIN_UNITS; // exactly at the minimum

function makeAuthedServerClient() {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
    from: vi.fn(),
  };
}

function makeAnonServerClient() {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    from: vi.fn(),
  };
}

function makeAdminClient() {
  const insertMock = vi.fn().mockResolvedValue({ error: null });
  const fromMock = vi.fn().mockReturnValue({ insert: insertMock });
  return { from: fromMock, _fromMock: fromMock, _insertMock: insertMock };
}

function makeStripeClient(sessionUrl = SESSION_URL, sessionId = SESSION_ID) {
  const createMock = vi.fn().mockResolvedValue({ id: sessionId, url: sessionUrl });
  return {
    checkout: { sessions: { create: createMock } },
    _createMock: createMock,
  };
}

function makeRequest(body: Record<string, unknown> = {}) {
  return new Request("http://127.0.0.1:3000/api/stripe/topup", {
    method:  "POST",
    headers: { "content-type": "application/json" },
    body:    JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/stripe/topup", () => {
  it("returns 401 when the user is not authenticated", async () => {
    vi.mocked(createClient).mockResolvedValue(makeAnonServerClient() as never);

    const res = await POST(makeRequest({ credits: VALID_CREDITS }));

    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("returns 400 when credits is below STRIPE_MIN_UNITS (50)", async () => {
    vi.mocked(createClient).mockResolvedValue(makeAuthedServerClient() as never);
    vi.mocked(createAdminClient).mockReturnValue(makeAdminClient() as never);
    vi.mocked(getStripe).mockReturnValue(makeStripeClient() as never);

    const res = await POST(makeRequest({ credits: STRIPE_MIN_UNITS - 1 }));

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain(String(STRIPE_MIN_UNITS));
  });

  it("returns 400 when credits is not an integer", async () => {
    vi.mocked(createClient).mockResolvedValue(makeAuthedServerClient() as never);
    vi.mocked(createAdminClient).mockReturnValue(makeAdminClient() as never);
    vi.mocked(getStripe).mockReturnValue(makeStripeClient() as never);

    const res = await POST(makeRequest({ credits: 100.5 }));

    expect(res.status).toBe(400);
  });

  it("happy path: inserts a pending credit_purchases row with the Stripe session id", async () => {
    vi.mocked(createClient).mockResolvedValue(makeAuthedServerClient() as never);
    const admin = makeAdminClient();
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    const stripeClient = makeStripeClient();
    vi.mocked(getStripe).mockReturnValue(stripeClient as never);

    const res = await POST(makeRequest({ credits: VALID_CREDITS }));

    expect(res.status).toBe(200);
    const body = await res.json() as { url: string };
    expect(body.url).toBe(SESSION_URL);

    // Stripe session was created
    expect(stripeClient._createMock).toHaveBeenCalledOnce();

    // A pending row was written to credit_purchases with the correct session id
    expect(admin._fromMock).toHaveBeenCalledWith("credit_purchases");
    expect(admin._insertMock).toHaveBeenCalledWith({
      user_id:           USER_ID,
      credits:           VALID_CREDITS,
      blocks:            0,
      status:            "pending",
      stripe_session_id: SESSION_ID,
    });
  });

  it("happy path with jobId: Stripe metadata includes job_id", async () => {
    vi.mocked(createClient).mockResolvedValue(makeAuthedServerClient() as never);
    vi.mocked(createAdminClient).mockReturnValue(makeAdminClient() as never);
    const stripeClient = makeStripeClient();
    vi.mocked(getStripe).mockReturnValue(stripeClient as never);

    const res = await POST(makeRequest({ credits: 200, jobId: "job-abc" }));

    expect(res.status).toBe(200);

    const callArg = stripeClient._createMock.mock.calls[0][0] as {
      metadata: Record<string, string>;
    };
    expect(callArg.metadata.job_id).toBe("job-abc");
    expect(callArg.metadata.type).toBe("topup");
    expect(callArg.metadata.credits).toBe("200");
  });

  it("happy path without jobId: success URL points to /portal/account", async () => {
    vi.mocked(createClient).mockResolvedValue(makeAuthedServerClient() as never);
    vi.mocked(createAdminClient).mockReturnValue(makeAdminClient() as never);
    const stripeClient = makeStripeClient();
    vi.mocked(getStripe).mockReturnValue(stripeClient as never);

    await POST(makeRequest({ credits: VALID_CREDITS }));

    const callArg = stripeClient._createMock.mock.calls[0][0] as {
      success_url: string;
      cancel_url: string;
    };
    expect(callArg.success_url).toContain("/portal/account");
    expect(callArg.cancel_url).toContain("/portal/account");
  });
});
