/**
 * Tests for getValidToken in lib/x/oauth.ts.
 *
 * Covers:
 * - Token not expired → returns access token without calling fetch
 * - Token near/past expiry → refreshes via fetch, saves new tokens, returns new access token
 * - Refresh endpoint returns non-ok → getValidToken rejects
 * - No stored secret for connection → getValidToken rejects
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { getValidToken } from "@/lib/x/oauth";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/crypto", () => ({
  // decryptSecret: receive the raw value stored (we store the JSON-stringified object directly
  // as the "enc" buffer), parse and return it.
  decryptSecret: vi.fn((_enc: unknown, _nonce: unknown) =>
    JSON.parse(Buffer.from(_enc as Buffer).toString())
  ),
  encryptSecret: vi.fn((val: unknown) => ({
    enc: Buffer.from(JSON.stringify(val)),
    nonce: Buffer.from("nonce"),
  })),
  fromBytea: vi.fn((x: unknown) => x),
  toBytea: vi.fn((x: unknown) => x),
}));

// Stub global fetch
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const { createAdminClient } = await import("@/lib/supabase/admin");

// ── admin client builder ──────────────────────────────────────────────────────

/**
 * Build a mock admin client that handles the specific query chains in oauth.ts:
 *
 *   getValidToken:
 *     admin.from("connection_secrets").select(...).eq(...).maybeSingle()  → secretData
 *     admin.from("connections").select(...).eq(...).maybeSingle()         → connData
 *
 *   saveConnectionTokens (called when refresh needed):
 *     admin.from("connection_secrets").upsert(...)                        → { error: upsertError }
 *     admin.from("connections").update(...).eq(...)                       → (ignored)
 *
 * Each call to admin.from(table) is tracked via a call counter per table so that
 * the first call returns a read mock and subsequent calls return write mocks.
 */
function makeAdmin({
  secretData = null as object | null,
  connData = null as object | null,
  upsertError = null as { message: string } | null,
} = {}) {
  // Track how many times each table has been accessed
  const callCount: Record<string, number> = {};

  const fromMock = vi.fn().mockImplementation((table: string) => {
    callCount[table] = (callCount[table] ?? 0) + 1;
    const n = callCount[table];

    if (table === "connection_secrets") {
      if (n === 1) {
        // First access: read (select → eq → maybeSingle)
        const maybeSingle = vi.fn().mockResolvedValue({ data: secretData, error: null });
        const eq = vi.fn().mockReturnValue({ maybeSingle });
        const select = vi.fn().mockReturnValue({ eq });
        return { select };
      } else {
        // Second access: write (upsert)
        const upsert = vi.fn().mockResolvedValue({ error: upsertError });
        return { upsert };
      }
    }

    if (table === "connections") {
      if (n === 1) {
        // First access: read (select → eq → maybeSingle)
        const maybeSingle = vi.fn().mockResolvedValue({ data: connData, error: null });
        const eq = vi.fn().mockReturnValue({ maybeSingle });
        const select = vi.fn().mockReturnValue({ eq });
        return { select };
      } else {
        // Second access: write (update → eq)
        const eq = vi.fn().mockResolvedValue({ error: null });
        const update = vi.fn().mockReturnValue({ eq });
        return { update };
      }
    }

    // Fallback (should not be reached in these tests)
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
      update: vi.fn().mockReturnThis(),
    };
  });

  return { from: fromMock };
}

/** Encode tokens the same way decryptSecret will decode them. */
function encodeTokens(tokens: object): Buffer {
  return Buffer.from(JSON.stringify(tokens));
}

// ── tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  // Set env vars required by clientCreds()
  process.env.X_CLIENT_ID = "test_client_id";
  process.env.X_CLIENT_SECRET = "test_client_secret";
});

describe("getValidToken", () => {
  it("returns access token without calling fetch when token is not expired", async () => {
    const secretData = {
      secret_enc: encodeTokens({ access_token: "tok_valid", refresh_token: "ref1" }),
      secret_nonce: Buffer.from("nonce"),
    };
    const connData = {
      token_expires_at: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
    };

    vi.mocked(createAdminClient).mockReturnValue(
      makeAdmin({ secretData, connData }) as never
    );

    const token = await getValidToken("conn1");

    expect(token).toBe("tok_valid");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes token when near expiry and returns new access token", async () => {
    const secretData = {
      secret_enc: encodeTokens({ access_token: "tok_old", refresh_token: "ref_old" }),
      secret_nonce: Buffer.from("nonce"),
    };
    // Expired: expires_at is in the past
    const connData = {
      token_expires_at: new Date(Date.now() - 1000).toISOString(),
    };

    vi.mocked(createAdminClient).mockReturnValue(
      makeAdmin({ secretData, connData }) as never
    );

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "tok_new",
          refresh_token: "ref_new",
          expires_in: 7200,
        }),
    });

    const token = await getValidToken("conn1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(token).toBe("tok_new");
  });

  it("saves new refresh token after successful refresh", async () => {
    const secretData = {
      secret_enc: encodeTokens({ access_token: "tok_old", refresh_token: "ref_old" }),
      secret_nonce: Buffer.from("nonce"),
    };
    const connData = {
      token_expires_at: new Date(Date.now() - 1000).toISOString(),
    };

    const admin = makeAdmin({ secretData, connData });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "tok_new",
          refresh_token: "ref_new",
          expires_in: 7200,
        }),
    });

    await getValidToken("conn1");

    // from() was called at least twice for connection_secrets (read + write)
    const connSecretCalls = admin.from.mock.calls.filter(
      (args: unknown[]) => args[0] === "connection_secrets"
    );
    expect(connSecretCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("throws when refresh endpoint returns non-ok response", async () => {
    const secretData = {
      secret_enc: encodeTokens({ access_token: "tok_old", refresh_token: "ref_old" }),
      secret_nonce: Buffer.from("nonce"),
    };
    const connData = {
      token_expires_at: new Date(Date.now() - 1000).toISOString(),
    };

    vi.mocked(createAdminClient).mockReturnValue(
      makeAdmin({ secretData, connData }) as never
    );

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve("unauthorized"),
    });

    await expect(getValidToken("conn1")).rejects.toThrow();
  });

  it("throws when no stored credentials for connection", async () => {
    // secretData = null means no row in connection_secrets
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdmin({ secretData: null }) as never
    );

    await expect(getValidToken("conn1")).rejects.toThrow("No stored credentials");
  });
});
