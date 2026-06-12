import type { GateHit, ModerationLabel } from "@/lib/audit/types";

const HATE_CATEGORIES = new Set([
  "racial/ethnic slurs",
  "sexual orientation/gender",
  "mental disability",
  "physical disability",
  "physical attributes",
  "religious offense",
  "political",
]);

export function labelsForHit(hit: GateHit): ModerationLabel[] {
  const sev = hit.severity ?? 0;
  const labels = new Set<ModerationLabel>();

  for (const cat of hit.categories) {
    if (HATE_CATEGORIES.has(cat)) {
      labels.add("hate");
    } else if (cat === "sexual anatomy / sexual acts") {
      labels.add(sev >= 2 ? "nsfw_sexual" : "curse");
    } else if (cat === "bodily fluids / excrement") {
      labels.add(sev >= 2.5 ? "strong_curse" : "curse");
    } else if (cat === "other / general insult") {
      labels.add(sev >= 2 ? "strong_curse" : "curse");
    } else if (cat === "animal references") {
      labels.add("curse");
    }
    // Surge has no violence category — `violent` can only come from Phase 2.
  }

  return [...labels];
}

export function severityBucket(
  maxSev: number,
): "mild" | "strong" | "severe" {
  if (maxSev >= 2.5) return "severe";
  if (maxSev >= 2) return "strong";
  return "mild";
}
