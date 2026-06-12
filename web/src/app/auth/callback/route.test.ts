/**
 * Tests for the OAuth callback route.
 *
 * Verifies that a successful X code-exchange redirects to /portal/scans,
 * that failures redirect to /start?error=auth, and that captureXConnection
 * is called when a provider_token is present.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/auth/callback/route";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/x/oauth", () => ({
  captureXConnection: vi.fn().mockResolvedValue(undefined),
}));

const { createClient } = await import("@/lib/supabase/server");
const { captureXConnection } = await import("@/lib/x/oauth");

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(
  path = "/auth/callback",
  params: Record<string, string> = {},
  headers: Record<string, string> = {},
) {
  const url = new URL(`http://127.0.0.1:3000${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url.toString(), {
    headers: { host: "127.0.0.1:3000", ...headers },
  });
}

function mockSupabase(exchangeResult: {
  data: object;
  error: null | { message: string };
}) {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      exchangeCodeForSession: vi.fn().mockResolvedValue(exchangeResult),
      verifyOtp: vi.fn(),
    },
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /auth/callback", () => {
  describe("X / PKCE code-exchange path", () => {
    it("redirects to /portal/scans on successful code exchange", async () => {
      mockSupabase({
        data: { session: { provider_token: null } },
        error: null,
      });

      const res = await GET(makeRequest("/auth/callback", { code: "abc123" }));

      expect(res.status).toBeGreaterThanOrEqual(300);
      expect(res.status).toBeLessThan(400);
      expect(res.headers.get("location")).toBe(
        "http://127.0.0.1:3000/portal/scans",
      );
    });

    it("respects the `next` query param when redirecting", async () => {
      mockSupabase({
        data: { session: { provider_token: null } },
        error: null,
      });

      const res = await GET(
        makeRequest("/auth/callback", {
          code: "abc",
          next: "/portal/settings",
        }),
      );

      expect(res.headers.get("location")).toBe(
        "http://127.0.0.1:3000/portal/settings",
      );
    });

    it("calls captureXConnection when provider_token is present", async () => {
      const session = {
        provider_token: "xprovider_tok",
        provider_refresh_token: "xrefresh_tok",
        user: { id: "u1" },
      };
      mockSupabase({ data: { session }, error: null });

      await GET(makeRequest("/auth/callback", { code: "abc123" }));

      expect(captureXConnection).toHaveBeenCalledWith(session);
    });

    it("does NOT call captureXConnection when provider_token is null", async () => {
      mockSupabase({
        data: { session: { provider_token: null } },
        error: null,
      });

      await GET(makeRequest("/auth/callback", { code: "abc123" }));

      expect(captureXConnection).not.toHaveBeenCalled();
    });

    it("redirects to /start?error=auth on exchange failure", async () => {
      mockSupabase({ data: { session: null }, error: { message: "bad code" } });

      const res = await GET(makeRequest("/auth/callback", { code: "bad" }));

      expect(res.headers.get("location")).toBe(
        "http://127.0.0.1:3000/start?error=auth",
      );
    });

    it("redirects to /start?error=auth when no code or token_hash", async () => {
      // Neither `code` nor `token_hash` present
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          exchangeCodeForSession: vi.fn(),
          verifyOtp: vi.fn(),
        },
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      const res = await GET(makeRequest("/auth/callback", {}));

      expect(res.headers.get("location")).toBe(
        "http://127.0.0.1:3000/start?error=auth",
      );
    });
  });

  describe("origin derivation", () => {
    it("uses x-forwarded-host when present", async () => {
      mockSupabase({
        data: { session: { provider_token: null } },
        error: null,
      });

      const res = await GET(
        makeRequest(
          "/auth/callback",
          { code: "abc" },
          {
            host: "internal-host",
            "x-forwarded-host": "prod.example.com",
            "x-forwarded-proto": "https",
          },
        ),
      );

      expect(res.headers.get("location")).toBe(
        "https://prod.example.com/portal/scans",
      );
    });
  });
});
