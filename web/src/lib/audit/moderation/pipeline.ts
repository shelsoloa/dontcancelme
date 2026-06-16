import "server-only";
import { getGate } from "./gate";
import { labelsForHit, severityBucket } from "./taxonomy";
import { moderateOpenAI, labelsFromPhase2, MIN_CONFIDENCE, type Phase2PerItem } from "./phase2";
import type { ModerationResult } from "@/lib/audit/types";

type BatchItem = { id: string; text: string };
type BatchOpts = { phase2: boolean; timeoutMs?: number };

/** Categories whose detection forces overall severity to "severe". */
const SEVERE_OVERRIDE_CATEGORIES = new Set([
  "sexual/minors",
  "hate/threatening",
  "harassment/threatening",
  "violence/graphic",
]);

/** Map a severity label to a numeric rank for max-of-both computation. */
function sevRank(severity: ModerationResult["severity"]): number {
  if (severity === "severe") return 3;
  if (severity === "strong") return 2;
  if (severity === "mild") return 1;
  return 0;
}

/**
 * Compute the Phase 2 severity rank from a raw OpenAI result.
 * Returns 0 when the result is absent or all scores are below the threshold.
 */
function p2SevRank(p2: Phase2PerItem | null): number {
  if (!p2) return 0;
  const maxScore = Math.max(0, ...Object.values(p2.scores));

  // Special override: any "severe override" category that fired forces
  // the severity floor to "severe" regardless of its individual score.
  const hasOverride = p2.categories.some((c) => SEVERE_OVERRIDE_CATEGORIES.has(c));
  if (hasOverride) return 3;

  if (maxScore >= 0.9) return 3;
  if (maxScore >= 0.7) return 2;
  if (maxScore >= MIN_CONFIDENCE) return 1;
  return 0;
}

export async function moderateBatch(
  items: BatchItem[],
  opts: BatchOpts,
): Promise<ModerationResult[]> {
  const gate = getGate();

  // ── Phase 1: Surge wordlist regex gate (synchronous) ──────────────────────
  const p1 = items.map(({ id, text }) => {
    const t0 = performance.now();
    const hits = gate.scan(text);
    const ms = performance.now() - t0;
    const labelSet = new Set(hits.flatMap(labelsForHit));
    const labels = [...labelSet];
    const maxSev = hits.reduce((acc, h) => Math.max(acc, h.severity ?? 0), 0);
    const severity = hits.length > 0 ? severityBucket(maxSev) : null;
    return {
      id,
      labels,
      severity,
      hits,
      ms,
      decision: hits.length > 0 ? ("flagged" as const) : ("clean" as const),
    };
  });

  // ── Phase 2: OpenAI omni-moderation-latest (batched, fail-open) ──────────
  let p2Results: (Phase2PerItem | null)[] = [];
  if (opts.phase2) {
    const openAIResult = await moderateOpenAI(
      items.map((i) => ({ id: i.id, text: i.text })),
    );
    if (openAIResult) {
      p2Results = openAIResult;
    } else {
      // Every item degraded — Phase 2 call failed entirely.
      p2Results = items.map(() => null);
    }
  }

  // ── Merge Phase 1 + Phase 2 per item ─────────────────────────────────────
  return items.map((item, i) => {
    const p1r = p1[i];
    const p2r = p2Results[i] ?? null;
    const phase2Failed = opts.phase2 && !p2r;

    // Merge labels.
    const p2Labels = p2r ? labelsFromPhase2(p2r) : [];
    const labels = [...new Set([...p1r.labels, ...p2Labels])];

    // Merge severity — max of numeric ranks across both signals.
    const maxRank = Math.max(sevRank(p1r.severity), p2SevRank(p2r));
    const severity: ModerationResult["severity"] =
      maxRank >= 3 ? "severe"
      : maxRank >= 2 ? "strong"
      : maxRank >= 1 ? "mild"
      : null;

    return {
      id: item.id,
      decision: labels.length > 0 ? "flagged" : "clean",
      labels,
      severity,
      degraded: phase2Failed,
      phase1: { ms: p1r.ms, hits: p1r.hits },
      phase2: p2r
        ? { status: p2r.status, categories: p2r.categories, scores: p2r.scores }
        : null,
    };
  });
}
