import { getGate } from "./gate";
import { labelsForHit, severityBucket } from "./taxonomy";
import type { ModerationResult } from "@/lib/audit/types";

type BatchItem = { id: string; text: string };
type BatchOpts = { phase2: boolean; timeoutMs?: number };

export async function moderateBatch(
  items: BatchItem[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _opts: BatchOpts,
): Promise<ModerationResult[]> {
  const gate = getGate();

  return items.map(({ id, text }) => {
    const t0 = performance.now();
    const hits = gate.scan(text);
    const ms = performance.now() - t0;

    const labelSet = new Set(hits.flatMap(labelsForHit));
    const labels = [...labelSet];

    const maxSev = hits.reduce((acc, h) => Math.max(acc, h.severity ?? 0), 0);
    const severity = hits.length > 0 ? severityBucket(maxSev) : null;

    return {
      id,
      decision: hits.length > 0 ? "flagged" : "clean",
      labels,
      severity,
      degraded: false,
      phase1: { ms, hits },
      phase2: null,
    };
  });
}
