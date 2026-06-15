import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { moderateOpenAI, labelsFromPhase2, type Phase2PerItem } from "./phase2";

const ORIGINAL_ENV = process.env;

function makeItems(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `item-${i}`,
    text: `sample text ${i}`,
  }));
}

function makeOpenAIResult(overrides: Partial<Phase2PerItem> = {}): Phase2PerItem {
  return {
    status: "ok",
    flagged: false,
    categories: [],
    scores: {},
    ...overrides,
  };
}

// ── moderateOpenAI ──────────────────────────────────────────────────────────

describe("moderateOpenAI", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("returns null when OPENAI_API_KEY is not set", async () => {
    delete process.env.OPENAI_API_KEY;
    const result = await moderateOpenAI(makeItems(1));
    expect(result).toBeNull();
  });

  it("returns empty array for empty input (with key set)", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const result = await moderateOpenAI([]);
    expect(result).toEqual([]);
  });

  it("returns null on fetch error", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("network error"));
    const result = await moderateOpenAI(makeItems(1));
    expect(result).toBeNull();
  });

  it("returns null on non-2xx response", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);
    const result = await moderateOpenAI(makeItems(1));
    expect(result).toBeNull();
  });

  it("returns null on malformed response (no results array)", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response);
    const result = await moderateOpenAI(makeItems(1));
    expect(result).toBeNull();
  });

  it("returns null on invalid JSON response", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new Error("bad json")),
    } as Response);
    const result = await moderateOpenAI(makeItems(1));
    expect(result).toBeNull();
  });

  it("returns per-item results for a successful batch", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: "modr-abc",
          model: "omni-moderation-latest",
          results: [
            {
              flagged: true,
              categories: { hate: true, violence: false, sexual: false },
              category_scores: { hate: 0.85, violence: 0.02, sexual: 0.01 },
            },
            {
              flagged: false,
              categories: { hate: false, violence: false, sexual: false },
              category_scores: { hate: 0.01, violence: 0.01, sexual: 0.01 },
            },
          ],
        }),
    } as unknown as Response);

    const result = await moderateOpenAI(makeItems(2));
    expect(result).not.toBeNull();
    expect(result!).toHaveLength(2);

    const r0 = result![0];
    expect(r0.status).toBe("ok");
    expect(r0.flagged).toBe(true);
    expect(r0.categories).toContain("hate");
    expect(r0.categories).not.toContain("violence");
    expect(r0.scores.hate).toBe(0.85);

    const r1 = result![1];
    expect(r1.flagged).toBe(false);
    expect(r1.categories).toEqual([]);
  });

  it("includes only true category keys in the categories array", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: "modr-xyz",
          model: "omni-moderation-latest",
          results: [
            {
              flagged: true,
              categories: { hate: false, violence: true, "self-harm": false },
              category_scores: { hate: 0.1, violence: 0.92, "self-harm": 0.3 },
            },
          ],
        }),
    } as unknown as Response);

    const result = await moderateOpenAI(makeItems(1));
    expect(result![0].categories).toEqual(["violence"]);
  });

  it("sends all item texts in a single batch call", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: "modr-1",
          model: "omni-moderation-latest",
          results: [{ flagged: false, categories: {}, category_scores: {} }],
        }),
    } as unknown as Response);

    const items = [
      { id: "a", text: "hello world" },
      { id: "b", text: "goodbye" },
    ];
    await moderateOpenAI(items);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
    expect(body.model).toBe("omni-moderation-latest");
    expect(body.input).toEqual(["hello world", "goodbye"]);
  });
});

// ── labelsFromPhase2 ────────────────────────────────────────────────────────

describe("labelsFromPhase2", () => {
  it("returns empty array when no categories are present", () => {
    const r = makeOpenAIResult({ categories: [], scores: {} });
    expect(labelsFromPhase2(r)).toEqual([]);
  });

  it("maps 'hate' category to 'hate' label (above threshold)", () => {
    const r = makeOpenAIResult({
      categories: ["hate"],
      scores: { hate: 0.8 },
    });
    expect(labelsFromPhase2(r)).toEqual(["hate"]);
  });

  it("maps 'violence' category to 'violent' label", () => {
    const r = makeOpenAIResult({
      categories: ["violence"],
      scores: { violence: 0.9 },
    });
    expect(labelsFromPhase2(r)).toEqual(["violent"]);
  });

  it("maps 'sexual' category to 'nsfw_sexual' label", () => {
    const r = makeOpenAIResult({
      categories: ["sexual"],
      scores: { sexual: 0.85 },
    });
    expect(labelsFromPhase2(r)).toEqual(["nsfw_sexual"]);
  });

  it("filters out categories below MIN_CONFIDENCE threshold", () => {
    const r = makeOpenAIResult({
      categories: ["hate", "violence"],
      scores: { hate: 0.6, violence: 0.4 },
    });
    // violence is below MIN_CONFIDENCE (0.5)
    expect(labelsFromPhase2(r)).toEqual(["hate"]);
  });

  it("filters out all categories when all are below threshold", () => {
    const r = makeOpenAIResult({
      categories: ["hate"],
      scores: { hate: 0.3 },
    });
    expect(labelsFromPhase2(r)).toEqual([]);
  });

  it("returns empty array for categories with no score entry", () => {
    const r = makeOpenAIResult({
      categories: ["hate"],
      scores: {},
    });
    expect(labelsFromPhase2(r)).toEqual([]);
  });

  it("maps 'hate/threatening' to 'hate'", () => {
    const r = makeOpenAIResult({
      categories: ["hate/threatening"],
      scores: { "hate/threatening": 0.7 },
    });
    expect(labelsFromPhase2(r)).toEqual(["hate"]);
  });

  it("maps 'harassment/threatening' to 'violent'", () => {
    const r = makeOpenAIResult({
      categories: ["harassment/threatening"],
      scores: { "harassment/threatening": 0.8 },
    });
    expect(labelsFromPhase2(r)).toEqual(["violent"]);
  });

  it("maps all self-harm variants to 'violent'", () => {
    for (const cat of ["self-harm", "self-harm/intent", "self-harm/instructions"]) {
      const r = makeOpenAIResult({
        categories: [cat],
        scores: { [cat]: 0.9 },
      });
      expect(labelsFromPhase2(r)).toEqual(["violent"]);
    }
  });

  it("maps 'illicit/violent' to 'violent'", () => {
    const r = makeOpenAIResult({
      categories: ["illicit/violent"],
      scores: { "illicit/violent": 0.85 },
    });
    expect(labelsFromPhase2(r)).toEqual(["violent"]);
  });

  it("does NOT map plain 'illicit' (unmapped category)", () => {
    const r = makeOpenAIResult({
      categories: ["illicit"],
      scores: { illicit: 0.9 },
    });
    expect(labelsFromPhase2(r)).toEqual([]);
  });

  it("deduplicates labels when multiple categories map to the same label", () => {
    const r = makeOpenAIResult({
      categories: ["hate", "hate/threatening"],
      scores: { hate: 0.8, "hate/threatening": 0.85 },
    });
    expect(labelsFromPhase2(r)).toEqual(["hate"]);
  });

  it("returns multiple distinct labels from a single result", () => {
    const r = makeOpenAIResult({
      categories: ["hate", "violence", "sexual"],
      scores: { hate: 0.8, violence: 0.9, sexual: 0.85 },
    });
    const labels = labelsFromPhase2(r);
    expect(labels).toContain("hate");
    expect(labels).toContain("violent");
    expect(labels).toContain("nsfw_sexual");
    expect(labels).toHaveLength(3);
  });
});
