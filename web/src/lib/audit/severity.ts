/**
 * FLOODLIGHT severity helpers — single source of truth for the risk scale.
 *
 * The product uses a 4-level `Severity` (`low | medium | high | critical`).
 * The FLOODLIGHT design language adds a 5th level, "clear", for posts with
 * no flags. This module maps between them and exposes the display metadata
 * (badge classes, scale words, meter percentages) reused everywhere risk is
 * shown — badges, stat strips, meters, cards.
 */

import { RiskCategory, type Flag, type Severity } from "./types";

/** The 5-level design-token severity, matching CSS var names (--clear/low/med/high/crit). */
export type DesignSeverity = "clear" | "low" | "med" | "high" | "crit";

/** Map product Severity → FLOODLIGHT token name. */
export const SEVERITY_TOKEN: Record<Severity, DesignSeverity> = {
  low: "low",
  medium: "med",
  high: "high",
  critical: "crit",
};

/** Display word shown on the severity rail and in meters. */
export const SEVERITY_WORD: Record<DesignSeverity, string> = {
  clear: "Safe",
  low: "Watch",
  med: "Review",
  high: "Risky",
  crit: "Pull it",
};

/** Human label shown in badge/chip text. */
export const SEVERITY_LABEL: Record<DesignSeverity, string> = {
  clear: "Clear",
  low: "Low risk",
  med: "Medium risk",
  high: "High risk",
  crit: "Critical",
};

/** Tailwind classes for the soft-tint pill badge (`bg-{sev}-soft text-{sev}`). */
export const SEVERITY_BADGE_CLASS: Record<DesignSeverity, string> = {
  clear: "bg-clear-soft text-clear",
  low: "bg-low-soft text-low",
  med: "bg-med-soft text-med",
  high: "bg-high-soft text-high",
  crit: "bg-crit-soft text-crit",
};

/** Tailwind class for the solid fill color (e.g. meter fill, rail segment). */
export const SEVERITY_FILL_CLASS: Record<DesignSeverity, string> = {
  clear: "bg-clear",
  low: "bg-low",
  med: "bg-med",
  high: "bg-high",
  crit: "bg-crit",
};

/**
 * Tailwind class for the foreground color on a solid fill.
 * In dark mode, the clear/low/med/high fills are light-on-bright, so they
 * need dark text — only crit keeps white text (matching spec dark-mode rail).
 */
export const SEVERITY_FILL_TEXT_CLASS: Record<DesignSeverity, string> = {
  clear: "text-white dark:text-[#0A0A0B]",
  low: "text-white dark:text-[#0A0A0B]",
  med: "text-white dark:text-[#0A0A0B]",
  high: "text-white dark:text-[#0A0A0B]",
  crit: "text-white",
};

/**
 * Approximate meter fill percentage per tier (mirrors the spec's sample scores:
 * clear≈8%, low≈30%, med≈58%, high≈80%, crit≈96%).
 */
export const SEVERITY_METER_PCT: Record<DesignSeverity, number> = {
  clear: 8,
  low: 30,
  med: 58,
  high: 80,
  crit: 96,
};

/** Ordering for sort / max comparisons (higher = worse). */
const SEVERITY_RANK: Record<DesignSeverity, number> = {
  clear: 0,
  low: 1,
  med: 2,
  high: 3,
  crit: 4,
};

/** Return the highest FLOODLIGHT severity from a list of flags. Returns "clear" when empty. */
export function postSeverity(flags: Flag[]): DesignSeverity {
  if (flags.length === 0) return "clear";
  let max: DesignSeverity = "clear";
  for (const f of flags) {
    const ds = SEVERITY_TOKEN[f.severity];
    if (SEVERITY_RANK[ds] > SEVERITY_RANK[max]) max = ds;
  }
  return max;
}

/**
 * Categories that produce redacted-by-default display.
 * Slur / hate / doxxing / NSFW posts should never render their text inline.
 */
export const REDACT_CATEGORIES = new Set<RiskCategory>([
  RiskCategory.HateSpeech,
  RiskCategory.Nsfw,
  RiskCategory.Doxxing,
]);

/**
 * Returns true if this post's content should be hidden behind the redaction
 * block until the user explicitly reveals it.
 * Rule: redact when any flag is Critical tier OR is in a redact category.
 */
export function shouldRedact(flags: Flag[]): boolean {
  return flags.some(
    (f) => f.severity === "critical" || REDACT_CATEGORIES.has(f.category),
  );
}

/** Return a short reason string for the redacted block label (e.g. "slur"). */
export function redactReason(flags: Flag[]): string {
  const critical = flags.find((f) => f.severity === "critical");
  if (critical) return critical.reason.toLowerCase();
  const cat = flags.find((f) => REDACT_CATEGORIES.has(f.category));
  if (cat) return cat.reason.toLowerCase();
  return "flagged content";
}
