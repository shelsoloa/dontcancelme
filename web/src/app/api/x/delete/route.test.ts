/**
 * Tests for POST /api/x/delete — routing, error handling, and 404 source-awareness.
 *
 * Covers:
 * - auditSource routing (own_text, own_images, likes, reposts → correct X API call)
 * - X API error mapping (403 reconnect, 429 rate-limit)
 * - Auth guard (401) and missing-field validation (400)
 * - 404 source-aware handling: own tweet/image 404 → success; like/repost 404 → failure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/x/delete/route";
import { XApiError } from "@/lib/x/api";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/x/oauth", () => ({
  getValidToken: vi.fn(),
  resolveConnectionId: vi.fn(),
}));
vi.mock("@/lib/x/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/x/api")>();
  return {
    ...actual,           // keep XApiError as the real class for instanceof checks
    getMe: vi.fn(),
    deleteTweet: vi.fn(),
    unlikeTweet: vi.fn(),
    unretweet: vi.fn(),
  };
});

const { createClient } = await import("@/lib/supabase/server");
const { createAdminClient } = await import("@/lib/supabase/admin");
const { getValidToken, resolveConnectionId } = await import("@/lib/x/oauth");
const { getMe, deleteTweet, unlikeTweet, unretweet } = await import("@/lib/x/api");

// ── helpers ───────────────────────────────────────────────────────────────────

function req(body: object) {
  return new Request("http://127.0.0.1:3000/api/x/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── happy-path defaults ───────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
    },
  } as never);

  vi.mocked(createAdminClient).mockReturnValue({
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockResolvedValue({}),
    }),
  } as never);

  vi.mocked(resolveConnectionId).mockResolvedValue("conn1");
  vi.mocked(getValidToken).mockResolvedValue("tok1");
  vi.mocked(getMe).mockResolvedValue({ id: "uid1", username: "testuser", tweetCount: 0, likeCount: 0 });
  vi.mocked(deleteTweet).mockResolvedValue(undefined);
  vi.mocked(unlikeTweet).mockResolvedValue(undefined);
  vi.mocked(unretweet).mockResolvedValue(undefined);
});

// ── auditSource routing ───────────────────────────────────────────────────────

describe("auditSource routing", () => {
  it("own_text → only deleteTweet called", async () => {
    await POST(req({ platformPostId: "p1", auditSource: "own_text" }));

    expect(vi.mocked(deleteTweet)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(unlikeTweet)).not.toHaveBeenCalled();
    expect(vi.mocked(unretweet)).not.toHaveBeenCalled();
  });

  it("own_images → only deleteTweet called", async () => {
    await POST(req({ platformPostId: "p2", auditSource: "own_images" }));

    expect(vi.mocked(deleteTweet)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(unlikeTweet)).not.toHaveBeenCalled();
    expect(vi.mocked(unretweet)).not.toHaveBeenCalled();
  });

  it("likes → only unlikeTweet called", async () => {
    await POST(req({ platformPostId: "p3", auditSource: "likes" }));

    expect(vi.mocked(unlikeTweet)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deleteTweet)).not.toHaveBeenCalled();
    expect(vi.mocked(unretweet)).not.toHaveBeenCalled();
  });

  it("reposts → only unretweet called", async () => {
    await POST(req({ platformPostId: "p4", auditSource: "reposts" }));

    expect(vi.mocked(unretweet)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deleteTweet)).not.toHaveBeenCalled();
    expect(vi.mocked(unlikeTweet)).not.toHaveBeenCalled();
  });
});

// ── X API error mapping ───────────────────────────────────────────────────────

describe("X API error mapping", () => {
  it("403 from X → 403 response with reconnect message", async () => {
    vi.mocked(deleteTweet).mockRejectedValue(new XApiError(403, "forbidden"));

    const res = await POST(req({ platformPostId: "p1", auditSource: "own_text" }));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("reconnected");
  });

  it("429 from X → 429 response with rate-limit message", async () => {
    vi.mocked(deleteTweet).mockRejectedValue(new XApiError(429, "rate limit"));

    const res = await POST(req({ platformPostId: "p1", auditSource: "own_text" }));

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toContain("rate limit");
  });
});

// ── authentication / validation guards ───────────────────────────────────────

describe("guards", () => {
  it("unauthenticated request → 401", async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    } as never);

    const res = await POST(req({ platformPostId: "p1", auditSource: "own_text" }));

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthorized" });
  });

  it("missing auditSource → 400", async () => {
    const res = await POST(req({ platformPostId: "p1" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "missing platformPostId or auditSource" });
  });

  it("missing platformPostId → 400", async () => {
    const res = await POST(req({ auditSource: "own_text" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "missing platformPostId or auditSource" });
  });

  it("unknown auditSource → 400 unknown_audit_source", async () => {
    const res = await POST(req({ platformPostId: "p1", auditSource: "unknown_value" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "unknown_audit_source" });
  });
});

// ── success response shape ────────────────────────────────────────────────────

describe("success response", () => {
  it("returns { success: true } on successful deletion", async () => {
    const res = await POST(req({ platformPostId: "p1", auditSource: "own_text" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true });
  });
});

// ── 404 source-aware handling ─────────────────────────────────────────────────

describe("404 source-aware handling", () => {
  it("own_text 404 → success (tweet already deleted)", async () => {
    vi.mocked(deleteTweet).mockRejectedValue(new XApiError(404, "not found"));

    const res  = await POST(req({ platformPostId: "p1", auditSource: "own_text" }));
    const body = await res.json() as { success: boolean };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("own_images 404 → success (tweet already deleted)", async () => {
    vi.mocked(deleteTweet).mockRejectedValue(new XApiError(404, "not found"));

    const res  = await POST(req({ platformPostId: "p1", auditSource: "own_images" }));
    const body = await res.json() as { success: boolean };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("likes 404 → failure 404 (wasn't liked)", async () => {
    vi.mocked(unlikeTweet).mockRejectedValue(new XApiError(404, "not found"));

    const res  = await POST(req({ platformPostId: "p1", auditSource: "likes" }));
    const body = await res.json() as { success: boolean; error: string };

    expect(res.status).toBe(404);
    expect(body.success).toBe(false);
  });

  it("reposts 404 → failure 404 (wasn't reposted)", async () => {
    vi.mocked(unretweet).mockRejectedValue(new XApiError(404, "not found"));

    const res  = await POST(req({ platformPostId: "p1", auditSource: "reposts" }));
    const body = await res.json() as { success: boolean; error: string };

    expect(res.status).toBe(404);
    expect(body.success).toBe(false);
  });
});
