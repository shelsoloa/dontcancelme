import { describe, it, expect } from "vitest";
import { labelsForHit, severityBucket } from "./taxonomy";
import type { GateHit } from "@/lib/audit/types";

function hit(cats: string[], severity: number | null): GateHit {
  return { term: "t", start: 0, end: 1, severity, severityDesc: null, categories: cats };
}

describe("labelsForHit", () => {
  // Hate categories
  it.each([
    "racial/ethnic slurs",
    "sexual orientation/gender",
    "mental disability",
    "physical disability",
    "physical attributes",
    "religious offense",
    "political",
  ])("maps '%s' → hate", (cat) => {
    expect(labelsForHit(hit([cat], 2))).toContain("hate");
  });

  // sexual anatomy / sexual acts
  it("sexual anatomy sev<2 → curse", () => {
    expect(labelsForHit(hit(["sexual anatomy / sexual acts"], 1))).toEqual(["curse"]);
  });
  it("sexual anatomy sev≥2 → nsfw_sexual", () => {
    expect(labelsForHit(hit(["sexual anatomy / sexual acts"], 2))).toEqual(["nsfw_sexual"]);
  });

  // bodily fluids
  it("bodily fluids sev<2.5 → curse", () => {
    expect(labelsForHit(hit(["bodily fluids / excrement"], 2))).toEqual(["curse"]);
  });
  it("bodily fluids sev≥2.5 → strong_curse", () => {
    expect(labelsForHit(hit(["bodily fluids / excrement"], 2.5))).toEqual(["strong_curse"]);
  });

  // other / general insult
  it("insult sev<2 → curse", () => {
    expect(labelsForHit(hit(["other / general insult"], 1))).toEqual(["curse"]);
  });
  it("insult sev≥2 → strong_curse", () => {
    expect(labelsForHit(hit(["other / general insult"], 2))).toEqual(["strong_curse"]);
  });

  // animal references
  it("animal references → curse", () => {
    expect(labelsForHit(hit(["animal references"], 1))).toEqual(["curse"]);
  });

  // multi-category term deduplicates labels
  it("multi-category hit returns unique labels", () => {
    const labels = labelsForHit(
      hit(["other / general insult", "other / general insult"], 2),
    );
    expect(labels.filter((l) => l === "strong_curse")).toHaveLength(1);
  });

  // unknown / unmapped category produces no label
  it("unmapped category produces no label", () => {
    expect(labelsForHit(hit(["unknown category xyz"], 2))).toEqual([]);
  });
});

describe("severityBucket", () => {
  it("sev 0 → mild", () => expect(severityBucket(0)).toBe("mild"));
  it("sev 1 → mild", () => expect(severityBucket(1)).toBe("mild"));
  it("sev 1.9 → mild", () => expect(severityBucket(1.9)).toBe("mild"));
  it("sev 2.0 → strong", () => expect(severityBucket(2.0)).toBe("strong"));
  it("sev 2.4 → strong", () => expect(severityBucket(2.4)).toBe("strong"));
  it("sev 2.5 → severe", () => expect(severityBucket(2.5)).toBe("severe"));
  it("sev 3.0 → severe", () => expect(severityBucket(3.0)).toBe("severe"));
});
