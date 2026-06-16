/**
 * Tests for POST /api/stripe/webhook
 *
 * Verifies that:
 * - apply_credit_purchase is called exactly once on a valid paid event
 *   (credits are added ONLY after the Stripe webhook fires, not at checkout).
 * - Non-"paid" or non-"topup" events produce no balance change.
 * - Signature verification failure returns 400 and no RPC call.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/stripe/webhook/route";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/stripe",         () => ({ getStripe: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const { getStripe }         = await import("@/lib/stripe");
const { createAdminClient } = await import("@/lib/supabase/admin");

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SESSION_ID       = "cs_test_session_123";
const PAYMENT_INTENT   = "pi_test_456";
const STRIPE_SIGNATURE = "t=12345,v1=deadbeef";
const WEBHOOK_SECRET   = "whsec_test_secret";

type FakeEvent = {
  type: string;
  data: { object: object };
};

function makeEvent(overrides: Partial<{
  paymentStatus: string;
  metadataType:  string;
}> = {}): FakeEvent {
  return {
    type: "checkout.session.completed",
    data: {
      object: {
        id:              SESSION_ID,
        payment_status:  overrides.paymentStatus  ?? "paid",
        payment_intent:  PAYMENT_INTENT,
        metadata: {
          type: overrides.metadataType ?? "topup",
          user_id: "user-abc",
        },
      },
    },
  };
}

function makeStripe(event: FakeEvent | null, shouldThrow = false) {
  const constructEvent = shouldThrow
    ? vi.fn().mockImplementation(() => { throw new Error("invalid sig"); })
    : vi.fn().mockReturnValue(event);
  return { webhooks: { constructEvent }, _constructEvent: constructEvent };
}

function makeAdminClient() {
  const rpcMock = vi.fn().mockResolvedValue({ error: null });
  return { rpc: rpcMock, _rpcMock: rpcMock };
}

function makeRequest(body = "raw_body") {
  return new Request("http://127.0.0.1:3000/api/stripe/webhook", {
    method:  "POST",
    headers: {
      "stripe-signature": STRIPE_SIGNATURE,
      "content-type":     "text/plain",
    },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/stripe/webhook", () => {
  describe("credits are added only after the webhook fires", () => {
    it("calls apply_credit_purchase exactly once for a valid paid event", async () => {
      const admin = makeAdminClient();
      vi.mocked(getStripe).mockReturnValue(makeStripe(makeEvent()) as never);
      vi.mocked(createAdminClient).mockReturnValue(admin as never);

      const res  = await POST(makeRequest());
      const body = await res.json() as { received: boolean };

      expect(res.status).toBe(200);
      expect(body.received).toBe(true);
      expect(admin._rpcMock).toHaveBeenCalledTimes(1);
      expect(admin._rpcMock).toHaveBeenCalledWith("apply_credit_purchase", {
        p_session_id:      SESSION_ID,
        p_payment_intent:  PAYMENT_INTENT,
      });
    });

    it("does NOT call apply_credit_purchase for payment_status != paid", async () => {
      const admin = makeAdminClient();
      vi.mocked(getStripe).mockReturnValue(
        makeStripe(makeEvent({ paymentStatus: "unpaid" })) as never,
      );
      vi.mocked(createAdminClient).mockReturnValue(admin as never);

      await POST(makeRequest());

      expect(admin._rpcMock).not.toHaveBeenCalled();
    });

    it("does NOT call apply_credit_purchase when metadata.type != topup", async () => {
      const admin = makeAdminClient();
      vi.mocked(getStripe).mockReturnValue(
        makeStripe(makeEvent({ metadataType: "subscription" })) as never,
      );
      vi.mocked(createAdminClient).mockReturnValue(admin as never);

      await POST(makeRequest());

      expect(admin._rpcMock).not.toHaveBeenCalled();
    });

    it("is idempotent — repeated calls with same session go to DB (which dedupes)", async () => {
      // The route always calls the RPC; deduplication is in apply_credit_purchase SQL.
      const admin = makeAdminClient();
      vi.mocked(getStripe).mockReturnValue(makeStripe(makeEvent()) as never);
      vi.mocked(createAdminClient).mockReturnValue(admin as never);

      await POST(makeRequest());
      await POST(makeRequest());

      // Both calls reach the RPC (idempotency is enforced in the DB function).
      expect(admin._rpcMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("signature verification", () => {
    it("returns 400 and no RPC call when signature is invalid", async () => {
      const admin = makeAdminClient();
      vi.mocked(getStripe).mockReturnValue(makeStripe(null, true) as never);
      vi.mocked(createAdminClient).mockReturnValue(admin as never);

      const res = await POST(makeRequest());

      expect(res.status).toBe(400);
      expect(admin._rpcMock).not.toHaveBeenCalled();
    });

    it("returns 400 when stripe-signature header is missing", async () => {
      const req = new Request("http://127.0.0.1:3000/api/stripe/webhook", {
        method:  "POST",
        headers: { "content-type": "text/plain" },
        body:    "raw",
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("returns 400 when STRIPE_WEBHOOK_SECRET env is unset", async () => {
      delete process.env.STRIPE_WEBHOOK_SECRET;
      const res = await POST(makeRequest());
      expect(res.status).toBe(400);
    });
  });

  describe("RPC error handling", () => {
    it("returns 500 when apply_credit_purchase RPC errors", async () => {
      const rpcMock = vi.fn().mockResolvedValue({ error: { message: "db_error", details: "", hint: "", code: "42501" } });
      vi.mocked(getStripe).mockReturnValue(makeStripe(makeEvent()) as never);
      vi.mocked(createAdminClient).mockReturnValue({ rpc: rpcMock } as never);

      const res = await POST(makeRequest());

      expect(res.status).toBe(500);
      expect(rpcMock).toHaveBeenCalledTimes(1);
    });

    it("returns 200 received:true when apply_credit_purchase succeeds", async () => {
      const admin = makeAdminClient(); // already mocks { error: null }
      vi.mocked(getStripe).mockReturnValue(makeStripe(makeEvent()) as never);
      vi.mocked(createAdminClient).mockReturnValue(admin as never);

      const res  = await POST(makeRequest());
      const body = await res.json() as { received: boolean };

      expect(res.status).toBe(200);
      expect(body.received).toBe(true);
    });
  });
});
