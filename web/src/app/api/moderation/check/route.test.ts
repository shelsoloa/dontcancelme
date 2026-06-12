import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock is hoisted — use vi.hoisted() so the mock factories can reference
// these spies without TDZ errors.
const { mockGetUser, mockFrom, mockAdminInsert, mockAdminFrom } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
  mockAdminInsert: vi.fn(),
  mockAdminFrom: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn().mockReturnValue({
    from: mockAdminFrom,
  }),
}));

import { POST } from "./route";

// ---------------------------------------------------------------------------

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/moderation/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validUser = { id: "user-123" };

function setupAuth(user: typeof validUser | null) {
  mockGetUser.mockResolvedValue({ data: { user } });
}

function setupJobQuery(row: { job_id: string } | null) {
  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row }),
  });
}

function setupAdminInsert(error: { message: string } | null = null) {
  mockAdminInsert.mockResolvedValue({ error });
  mockAdminFrom.mockReturnValue({ insert: mockAdminInsert });
}

beforeEach(() => {
  vi.clearAllMocks();
  setupAdminInsert(null);
});

describe("POST /api/moderation/check", () => {
  it("returns 401 when no authenticated user", async () => {
    setupAuth(null);
    const res = await POST(makeRequest({ jobId: "j", items: [] }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when items exceed 50", async () => {
    setupAuth(validUser);
    setupJobQuery({ job_id: "job-abc" });
    const items = Array.from({ length: 51 }, (_, i) => ({
      id: String(i),
      text: "hello",
    }));
    const res = await POST(makeRequest({ jobId: "job-abc", items }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/cap/i);
  });

  it("returns 400 when items is not an array", async () => {
    setupAuth(validUser);
    setupJobQuery({ job_id: "j" });
    const res = await POST(makeRequest({ jobId: "j", items: "bad" }));
    expect(res.status).toBe(400);
  });

  it("returns 404 when job not found", async () => {
    setupAuth(validUser);
    setupJobQuery(null);
    const res = await POST(makeRequest({ jobId: "no-such", items: [] }));
    expect(res.status).toBe(404);
  });

  it("returns 200 with results for a clean batch", async () => {
    setupAuth(validUser);
    setupJobQuery({ job_id: "job-abc" });
    const items = [{ id: "tweet-1", text: "Hello, how are you?" }];
    const res = await POST(makeRequest({ jobId: "job-abc", items }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0].id).toBe("tweet-1");
    expect(body.results[0].decision).toBe("clean");
    expect(body.results[0].phase2).toBeNull();
  });

  it("returns 200 with flagged decision for profane text", async () => {
    setupAuth(validUser);
    setupJobQuery({ job_id: "job-abc" });
    const items = [{ id: "tweet-2", text: "this is bullshit" }];
    const res = await POST(makeRequest({ jobId: "job-abc", items }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0].decision).toBe("flagged");
  });

  it("inserts a row with input_hash (not raw text)", async () => {
    setupAuth(validUser);
    setupJobQuery({ job_id: "job-abc" });

    const text = "this is bullshit";
    await POST(makeRequest({ jobId: "job-abc", items: [{ id: "t1", text }] }));

    expect(mockAdminInsert).toHaveBeenCalledOnce();
    const [rows] = mockAdminInsert.mock.calls[0];
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.input_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row).not.toHaveProperty("text");
    expect(row).not.toHaveProperty("raw_text");
    expect(row.input_length).toBe(text.length);
  });

  it("returns 200 even when admin insert fails (fail-open)", async () => {
    setupAuth(validUser);
    setupJobQuery({ job_id: "job-abc" });
    setupAdminInsert({ message: "db error" });

    const res = await POST(
      makeRequest({ jobId: "job-abc", items: [{ id: "t1", text: "hello" }] }),
    );
    expect(res.status).toBe(200);
  });
});
