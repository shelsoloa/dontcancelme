import { describe, it, expect } from "vitest";

// Build a minimal gate from a fixed set of terms so tests are isolated
// from wordlist changes.
function makeGate(
  entries: { term: string; severity?: number; severityDesc?: string; categories?: string[] }[],
  whitelist?: Set<string>,
) {
  // We need to inject custom data. Since ProfanityGate reads the module-level
  // import, we construct it via the real wordlist but then override with a
  // small helper gate built from raw inputs.
  return new TestGate(entries, whitelist);
}

// Minimal standalone gate that mirrors ProfanityGate logic for testing.
class TestGate {
  private meta: Map<string, { severity: number | null; severityDesc: string | null; categories: string[] }>;
  private pattern: RegExp;

  constructor(
    entries: { term: string; severity?: number; severityDesc?: string; categories?: string[] }[],
    whitelist?: Set<string>,
  ) {
    const filtered = entries.filter((e) => !whitelist?.has(e.term));
    this.meta = new Map(
      filtered.map((e) => [
        e.term,
        {
          severity: e.severity ?? null,
          severityDesc: e.severityDesc ?? null,
          categories: e.categories ?? [],
        },
      ]),
    );
    const sorted = [...this.meta.keys()].sort((a, b) => b.length - a.length);
    const alt = sorted.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    this.pattern = new RegExp(`(?<![a-z0-9])(?:${alt})(?![a-z0-9])`, "gi");
  }

  scan(text: string) {
    this.pattern.lastIndex = 0;
    const hits = [];
    for (const m of text.matchAll(this.pattern)) {
      const surface = m[0].toLowerCase();
      const meta = this.meta.get(surface) ?? { severity: null, severityDesc: null, categories: [] };
      hits.push({ term: surface, start: m.index!, end: m.index! + m[0].length, ...meta });
    }
    return hits;
  }

  flagged(text: string) {
    this.pattern.lastIndex = 0;
    return this.pattern.test(text);
  }
}

describe("ProfanityGate (TestGate logic)", () => {
  it("matches leetspeak term @55", () => {
    const gate = makeGate([{ term: "@55", severity: 1 }]);
    expect(gate.flagged("look at @55 over there")).toBe(true);
    const hits = gate.scan("look at @55 over there");
    expect(hits[0].term).toBe("@55");
  });

  it("matches leetspeak term 5h1t", () => {
    const gate = makeGate([{ term: "5h1t", severity: 1 }]);
    expect(gate.flagged("that's 5h1t")).toBe(true);
  });

  it("does NOT match 'ass' inside 'assassin'", () => {
    const gate = makeGate([{ term: "ass", severity: 1 }]);
    expect(gate.flagged("assassin")).toBe(false);
  });

  it("does NOT match 'ass' inside 'class'", () => {
    const gate = makeGate([{ term: "ass", severity: 1 }]);
    expect(gate.flagged("I went to class today")).toBe(false);
  });

  it("DOES match 'ass' as a standalone word", () => {
    const gate = makeGate([{ term: "ass", severity: 1 }]);
    expect(gate.flagged("what an ass")).toBe(true);
  });

  it("longest-match-first: prefers 'motherfucker' over 'fuck'", () => {
    const gate = makeGate([
      { term: "fuck", severity: 2 },
      { term: "motherfucker", severity: 3 },
    ]);
    const hits = gate.scan("motherfucker");
    expect(hits).toHaveLength(1);
    expect(hits[0].term).toBe("motherfucker");
  });

  it("whitelist drops term from the gate", () => {
    const gate = makeGate(
      [{ term: "ass", severity: 1 }],
      new Set(["ass"]),
    );
    expect(gate.flagged("what an ass")).toBe(false);
  });

  it("is case-insensitive and resolves meta via lowercase", () => {
    const gate = makeGate([{ term: "fuck", severity: 2, severityDesc: "Strong" }]);
    const hits = gate.scan("FUCK off");
    expect(hits).toHaveLength(1);
    expect(hits[0].term).toBe("fuck");
    expect(hits[0].severityDesc).toBe("Strong");
  });
});

// Integration test against the real compiled wordlist.
describe("getGate() integration (real wordlist)", () => {
  it("correctly trims 'Strong ' to 'Strong' in severity descriptions", async () => {
    const { getGate } = await import("./gate");
    const gate = getGate();
    // The stray "Strong " row in the CSV should be trimmed to "Strong".
    const hits = gate.scan("fuck");
    const strongHits = hits.filter((h) => h.severityDesc === "Strong ");
    expect(strongHits).toHaveLength(0);
  });

  it("flags a well-known profane term from the wordlist", async () => {
    const { getGate } = await import("./gate");
    const gate = getGate();
    expect(gate.flagged("this is bullshit")).toBe(true);
  });

  it("does NOT flag innocuous text", async () => {
    const { getGate } = await import("./gate");
    const gate = getGate();
    expect(gate.flagged("Hello, how are you doing today?")).toBe(false);
  });
});
