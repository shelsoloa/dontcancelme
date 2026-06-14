/**
 * Client-side persistence for audit results (v1).
 *
 * Per the current design, scanned tweets are stored ON THE CLIENT only — not in
 * the database. We keep one record per job in localStorage, keyed by job id, so
 * revisiting the Job Detail page shows results without re-scanning. The DB still
 * holds the job *metadata* (status/progress/stats) so the Jobs list is accurate.
 *
 * Note: redacted text is already secret-free by the time it lands here (see
 * `detectors.ts`), so nothing sensitive is written to localStorage.
 */

import type {
  AuditedPost,
  AuditJobProgress,
  RiskCategory,
} from "./types";

export type StoredAudit = {
  jobId: string;
  /** "running" = in-flight checkpoint saved mid-run so an interrupted scan can
   *  resume without re-scanning (or re-charging) what was already processed. */
  status: "completed" | "failed" | "running";
  /** True once Phase A (deterministic) finished. Only meaningful while "running". */
  deterministicDone?: boolean;
  posts: AuditedPost[];
  progress: AuditJobProgress;
  /** Per-category flagged counts. */
  stats: Partial<Record<RiskCategory, number>>;
  /** ISO 8601. Absent while the run is still in flight. */
  finishedAt?: string;
};

const key = (jobId: string) => `audit:${jobId}`;

export function loadAudit(jobId: string): StoredAudit | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key(jobId));
    return raw ? (JSON.parse(raw) as StoredAudit) : null;
  } catch {
    return null;
  }
}

export function saveAudit(audit: StoredAudit): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key(audit.jobId), JSON.stringify(audit));
  } catch {
    // Quota or serialization failure — non-fatal; results just won't persist.
  }
}

export function clearAudit(jobId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key(jobId));
  } catch {
    // ignore
  }
}
