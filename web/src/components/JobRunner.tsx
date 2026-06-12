"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  runAudit,
  runLikesDrain,
  type AuditSnapshot,
} from "@/lib/audit/engine";
import { chargeDeterministic } from "@/lib/audit/source";
import { loadAudit, saveAudit, type StoredAudit } from "@/lib/audit/storage";
import {
  RISK_LABELS,
  type AuditedPost,
  type Flag,
  type RiskCategory,
  type Severity,
} from "@/lib/audit/types";
import {
  postSeverity,
  shouldRedact,
  redactReason,
  SEVERITY_TOKEN,
  type DesignSeverity,
} from "@/lib/audit/severity";
import { RiskCard } from "@/components/ui/RiskCard";
import { StatStrip } from "@/components/ui/StatStrip";
import { StatusBadge, formatDate, scanName } from "@/components/CardList";

type JobMeta = {
  jobId: string;
  status: string;
  enabledCategories: RiskCategory[];
  createdAt: string;
  startedAt: string | null;
  scanLimit: number | null;
  likesCap: number | null;
  likesProcessed: number;
  likesCursor: string | null;
  likesEnabled: boolean;
};

type Phase =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "running"; snapshot: AuditSnapshot; label: string }
  | { kind: "done"; result: StoredAudit }
  | { kind: "missing_results" }
  | {
      kind: "likes_exhausted";
      processedCount: number;
      likesCap: number;
      reason?: "rate_limited";
    }
  | { kind: "stopped"; processedCount: number; fromLikes: boolean }
  | { kind: "error"; message: string };

const SEVERITY_STYLES: Record<Severity, string> = {
  low: "bg-low-soft text-low",
  medium: "bg-med-soft text-med",
  high: "bg-high-soft text-high",
  critical: "bg-crit-soft text-crit",
};

export default function JobRunner({ jobId }: { jobId: string }) {
  const [meta, setMeta] = useState<JobMeta | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [live, setLive] = useState(false);
  const startedRef = useRef(false);
  /**
   * Holds the AbortController for the current run.  Only ever aborted via the
   * "Stop scan" button click — NEVER in useEffect cleanup (StrictMode
   * double-mount would abort the real run; see CLAUDE.md trap).
   */
  const controllerRef = useRef<AbortController | null>(null);
  /** Last snapshot emitted by onProgress — used to recover partial results
   *  if Phase A is aborted before runAudit resolves. */
  const lastSnapshotRef = useRef<AuditSnapshot | null>(null);

  useEffect(() => {
    const supabase = createClient();

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data: job } = await supabase
        .from("audit_jobs")
        .select(
          "job_id, status, enabled_categories, enabled_sources, created_at, started_at, scan_limit, likes_cap, likes_processed, likes_cursor",
        )
        .eq("job_id", jobId)
        .maybeSingle();

      if (!job || !user) {
        setPhase({ kind: "not_found" });
        return;
      }

      const isLive = user.app_metadata?.provider === "x";
      setLive(isLive);

      const sources: string[] = Array.isArray(job.enabled_sources)
        ? job.enabled_sources
        : [];
      const likesEnabled = sources.includes("likes");

      const jobMeta: JobMeta = {
        jobId: job.job_id,
        status: job.status,
        enabledCategories: (job.enabled_categories ?? []) as RiskCategory[],
        createdAt: job.created_at,
        startedAt: job.started_at,
        scanLimit: typeof job.scan_limit === "number" ? job.scan_limit : null,
        likesCap: typeof job.likes_cap === "number" ? job.likes_cap : null,
        likesProcessed:
          typeof job.likes_processed === "number" ? job.likes_processed : 0,
        likesCursor:
          typeof job.likes_cursor === "string" ? job.likes_cursor : null,
        likesEnabled,
      };
      setMeta(jobMeta);

      const existing = loadAudit(jobId);
      if (existing) {
        // Results already in localStorage — but if likes are enabled and the
        // job was exhausted mid-drain, show the exhaustion UI so the user can
        // top up and resume.
        if (
          existing.status === "completed" &&
          job.status === "likes_exhausted"
        ) {
          setPhase({
            kind: "likes_exhausted",
            processedCount: jobMeta.likesProcessed,
            likesCap: jobMeta.likesCap ?? 0,
          });
        } else {
          setPhase({ kind: "done", result: existing });
        }
        return;
      }

      if (job.status === "completed" || job.status === "failed") {
        setPhase({ kind: "missing_results" });
        return;
      }

      if (job.status === "likes_exhausted") {
        // Show exhaustion UI so user can top up without re-running Phase A.
        setPhase({
          kind: "likes_exhausted",
          processedCount: jobMeta.likesProcessed,
          likesCap: jobMeta.likesCap ?? 0,
        });
        return;
      }

      // queued or running with no local results → run it now.
      void start(jobMeta, user.id, isLive, supabase);
    })();
    // No abort-on-cleanup: StrictMode double-mounts; aborting would kill the real run.
  }, [jobId]);

  async function start(
    jobMeta: JobMeta,
    userId: string,
    isLive: boolean,
    supabase: ReturnType<typeof createClient>,
  ) {
    if (startedRef.current) return;
    startedRef.current = true;
    lastSnapshotRef.current = null;

    // Create a fresh controller for this run.  Only aborted on button click.
    controllerRef.current = new AbortController();
    const { signal } = controllerRef.current;

    setPhase({
      kind: "running",
      snapshot: {
        progress: { total: 0, processed: 0, flagged: 0 },
        stats: {},
        posts: [],
      },
      label: "Fetching tweets…",
    });

    await supabase
      .from("audit_jobs")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("job_id", jobMeta.jobId);

    try {
      // ── Phase A: charge + fetch + detect deterministic content ──────────
      if (isLive) {
        const chargeResult = await chargeDeterministic(jobMeta.jobId);
        if (chargeResult.shortfall > 0) {
          throw new Error(
            `Insufficient credits (shortfall: ${chargeResult.shortfall}). ` +
              "Please top up your balance from the account page.",
          );
        }
      }

      const deterministic = await runAudit({
        jobId: jobMeta.jobId,
        userId,
        enabledCategories: jobMeta.enabledCategories,
        live: isLive,
        stepDelayMs: isLive ? 0 : undefined,
        signal,
        onProgress: (snapshot) => {
          lastSnapshotRef.current = snapshot;
          setPhase({
            kind: "running",
            snapshot,
            label: "Scanning your posts…",
          });
        },
      });

      // ── Phase B: likes drain (if enabled) ────────────────────────────────
      if (jobMeta.likesEnabled && jobMeta.likesCap && isLive) {
        setPhase({
          kind: "running",
          snapshot: deterministic,
          label: "Starting liked posts drain…",
        });

        const drainResult = await runLikesDrain({
          jobId: jobMeta.jobId,
          userId,
          enabledCategories: jobMeta.enabledCategories,
          likesCap: jobMeta.likesCap,
          initialCursor: jobMeta.likesCursor ?? undefined,
          initialProcessed: jobMeta.likesProcessed,
          priorPosts: deterministic.posts,
          priorStats: deterministic.stats,
          signal,
          onProgress: (snapshot, processedCount) => {
            lastSnapshotRef.current = snapshot;
            setPhase({
              kind: "running",
              snapshot,
              label: `Scanning liked posts (${processedCount} of ${jobMeta.likesCap ?? "??"})…`,
            });
          },
          onExhausted: async (processedCount, nextCursor) => {
            // Persist the cursor before showing the exhaustion/stopped UI.
            await supabase
              .from("audit_jobs")
              .update({
                status: "likes_exhausted",
                likes_processed: processedCount,
                likes_cursor: nextCursor ?? null,
              })
              .eq("job_id", jobMeta.jobId);
          },
        });

        if (drainResult.kind === "exhausted") {
          // Save whatever we got to localStorage so partial results are visible.
          const finishedAt = new Date().toISOString();
          const stored: StoredAudit = {
            jobId: jobMeta.jobId,
            status: "completed",
            posts: drainResult.snapshot.posts,
            progress: drainResult.snapshot.progress,
            stats: drainResult.snapshot.stats,
            finishedAt,
          };
          saveAudit(stored);

          startedRef.current = false;
          setPhase({
            kind: "likes_exhausted",
            processedCount: drainResult.processedCount,
            likesCap: jobMeta.likesCap,
            reason: drainResult.reason,
          });
          return;
        }

        if (drainResult.kind === "stopped") {
          // User hit Stop — save partial results and show the stopped view.
          const finishedAt = new Date().toISOString();
          const stored: StoredAudit = {
            jobId: jobMeta.jobId,
            status: "completed",
            posts: drainResult.snapshot.posts,
            progress: drainResult.snapshot.progress,
            stats: drainResult.snapshot.stats,
            finishedAt,
          };
          saveAudit(stored);

          startedRef.current = false;
          setPhase({
            kind: "stopped",
            processedCount: drainResult.processedCount,
            fromLikes: true,
          });
          return;
        }

        // Drain completed — update the job with final likes count.
        await supabase
          .from("audit_jobs")
          .update({
            likes_processed: drainResult.processedCount,
            likes_cursor: null,
          })
          .eq("job_id", jobMeta.jobId);

        // Use the final merged snapshot (deterministic + all likes).
        const finalSnapshot = drainResult.snapshot;
        const finishedAt = new Date().toISOString();
        const stored: StoredAudit = {
          jobId: jobMeta.jobId,
          status: "completed",
          posts: finalSnapshot.posts,
          progress: finalSnapshot.progress,
          stats: finalSnapshot.stats,
          finishedAt,
        };
        saveAudit(stored);
        await supabase
          .from("audit_jobs")
          .update({
            status: "completed",
            progress: finalSnapshot.progress,
            stats: finalSnapshot.stats,
            finished_at: finishedAt,
          })
          .eq("job_id", jobMeta.jobId);
        // Refresh meta so ResultsView shows the real "N of cap" count.
        setMeta((m) =>
          m ? { ...m, likesProcessed: drainResult.processedCount } : m,
        );
        setPhase({ kind: "done", result: stored });
        return;
      }

      // ── No likes (or dev mode) — deterministic only ──────────────────────
      const finishedAt = new Date().toISOString();
      const stored: StoredAudit = {
        jobId: jobMeta.jobId,
        status: "completed",
        posts: deterministic.posts,
        progress: deterministic.progress,
        stats: deterministic.stats,
        finishedAt,
      };
      saveAudit(stored);
      await supabase
        .from("audit_jobs")
        .update({
          status: "completed",
          progress: deterministic.progress,
          stats: deterministic.stats,
          finished_at: finishedAt,
        })
        .eq("job_id", jobMeta.jobId);
      setPhase({ kind: "done", result: stored });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // User stopped the scan during Phase A.
        // Cast needed: TS 5.9 narrows lastSnapshotRef.current to `null` after
        // the explicit `.current = null` assignment at the top of `start()` because
        // it can't track writes that happen inside onProgress callbacks.
        const stopSnapshot = lastSnapshotRef.current as AuditSnapshot | null;
        const processedCount =
          stopSnapshot != null ? stopSnapshot.progress.processed : 0;

        if (stopSnapshot != null && processedCount > 0) {
          // Save whatever was scanned so far.
          const finishedAt = new Date().toISOString();
          const stored: StoredAudit = {
            jobId: jobMeta.jobId,
            status: "completed",
            posts: stopSnapshot.posts,
            progress: stopSnapshot.progress,
            stats: stopSnapshot.stats,
            finishedAt,
          };
          saveAudit(stored);
          await supabase
            .from("audit_jobs")
            .update({ status: "completed", finished_at: finishedAt })
            .eq("job_id", jobMeta.jobId);
        } else {
          // Nothing scanned yet — reset to queued so the user can rerun.
          await supabase
            .from("audit_jobs")
            .update({ status: "queued" })
            .eq("job_id", jobMeta.jobId);
        }
        startedRef.current = false;
        setPhase({ kind: "stopped", processedCount, fromLikes: false });
        return;
      }

      const message = err instanceof Error ? err.message : "Audit failed.";
      await supabase
        .from("audit_jobs")
        .update({ status: "failed", error: message })
        .eq("job_id", jobMeta.jobId);
      setPhase({ kind: "error", message });
    }
  }

  function rerun() {
    if (!meta) return;
    const supabase = createClient();
    startedRef.current = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) void start(meta, user.id, live, supabase);
    })();
  }

  /** Resume likes drain after a top-up. */
  function resumeLikes() {
    if (!meta) return;
    // Re-load the latest cursor from the DB then re-enter start().
    const supabase = createClient();
    startedRef.current = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data: freshJob } = await supabase
        .from("audit_jobs")
        .select("likes_processed, likes_cursor, status")
        .eq("job_id", meta.jobId)
        .maybeSingle();
      if (!user || !freshJob) return;

      const updatedMeta: JobMeta = {
        ...meta,
        status: "queued",
        likesProcessed: freshJob.likes_processed ?? meta.likesProcessed,
        likesCursor: freshJob.likes_cursor ?? meta.likesCursor,
      };
      setMeta(updatedMeta);
      await supabase
        .from("audit_jobs")
        .update({ status: "queued" })
        .eq("job_id", meta.jobId);

      void start(updatedMeta, user.id, live, supabase);
    })();
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <Link href="/portal/scans" className="text-sm text-ink-2 hover:underline">
        ← Back to scans
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        {scanName(meta?.createdAt)}
      </h1>
      <p className="mt-1 text-sm text-ink-3">#{jobId}</p>

      {phase.kind === "loading" && (
        <p className="mt-6 text-sm text-ink-2">Loading…</p>
      )}

      {phase.kind === "not_found" && (
        <p className="mt-6 text-sm text-ink-2">
          We couldn&apos;t find that scan.
        </p>
      )}

      {phase.kind === "running" && (
        <RunningView
          snapshot={phase.snapshot}
          label={phase.label}
          onStop={() => controllerRef.current?.abort()}
        />
      )}

      {phase.kind === "error" && (
        <div className="mt-6">
          <StatusBadge status="failed" />
          <p className="mt-3 text-sm text-crit">{phase.message}</p>
          <RerunButton onClick={rerun} />
        </div>
      )}

      {phase.kind === "missing_results" && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold">This run has been cleared</h2>
          <p className="mt-2 text-sm text-ink-2">
            We never store your tweets on our server. If you cleared your cache,
            the tweets in this run were cleared too.
          </p>
          <RerunButton onClick={rerun} />
        </div>
      )}

      {phase.kind === "likes_exhausted" && (
        <LikesExhaustedView
          processedCount={phase.processedCount}
          likesCap={phase.likesCap}
          jobId={jobId}
          onResume={resumeLikes}
          reason={phase.reason}
        />
      )}

      {phase.kind === "stopped" && (
        <StoppedView
          processedCount={phase.processedCount}
          onAction={phase.fromLikes ? resumeLikes : rerun}
          actionLabel={phase.fromLikes ? "Resume scan" : "Re-run scan"}
        />
      )}

      {phase.kind === "done" && meta && (
        <ResultsView result={phase.result} meta={meta} live={live} />
      )}
    </main>
  );
}

// ── LikesExhaustedView ────────────────────────────────────────────────────────

function LikesExhaustedView({
  processedCount,
  likesCap,
  jobId,
  onResume,
  reason,
}: {
  processedCount: number;
  likesCap: number;
  jobId: string;
  onResume: () => void;
  reason?: "rate_limited";
}) {
  const [toppingUp, setToppingUp] = useState(false);
  const [topUpError, setTopUpError] = useState<string | null>(null);

  async function topUp() {
    setToppingUp(true);
    setTopUpError(null);
    try {
      // Use the job-specific checkout route (reads persisted quote for the amount).
      // If the quote is stale, fall back to the portal account top-up.
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.url) {
        window.location.href = d.url;
        return;
      }
      // Fallback to generic top-up if the job quote is gone.
      setTopUpError(d.error ?? "Could not start checkout.");
      setToppingUp(false);
    } catch (e) {
      setTopUpError(
        e instanceof Error ? e.message : "Could not start checkout.",
      );
      setToppingUp(false);
    }
  }

  if (reason === "rate_limited") {
    return (
      <div className="mt-6 rounded-xl border border-line p-6">
        <h2 className="text-lg font-semibold">X rate limit reached</h2>
        <p className="mt-2 text-sm text-ink-2">
          X temporarily paused requests for liked tweets — this resets every 15
          minutes. Your progress is saved; click below to try again.
        </p>
        <div className="mt-4">
          <button
            onClick={onResume}
            className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-6 text-sm font-medium text-primary-ink transition-opacity hover:opacity-90"
          >
            Try again
          </button>
        </div>
        <p className="mt-3 text-xs text-ink-2">
          Results scanned so far are saved. No tweets will be re-scanned.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-xl border border-line p-6">
      <h2 className="text-lg font-semibold">Credits ran out</h2>
      <p className="mt-2 text-sm text-ink-2">
        Processed <strong>{processedCount.toLocaleString()}</strong> of up to{" "}
        <strong>{likesCap.toLocaleString()}</strong> liked posts — credits ran
        out here. Top up to continue from where we stopped.
      </p>
      {topUpError && <p className="mt-3 text-sm text-crit">{topUpError}</p>}
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          onClick={topUp}
          disabled={toppingUp}
          className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-6 text-sm font-medium text-primary-ink transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {toppingUp ? "Starting checkout…" : "Top up & resume"}
        </button>
        <button
          onClick={onResume}
          className="inline-flex h-11 items-center justify-center rounded-full border border-line px-6 text-sm font-medium transition-colors hover:border-line-strong"
        >
          Resume with current balance
        </button>
      </div>
      <p className="mt-3 text-xs text-ink-2">
        Results scanned so far are saved. No tweets will be re-scanned.
      </p>
    </div>
  );
}

// ── StoppedView ───────────────────────────────────────────────────────────────

function StoppedView({
  processedCount,
  onAction,
  actionLabel,
}: {
  processedCount: number;
  onAction: () => void;
  actionLabel: string;
}) {
  return (
    <div className="mt-6 rounded-xl border border-line p-6">
      <h2 className="text-lg font-semibold">Scan stopped</h2>
      <p className="mt-2 text-sm text-ink-2">
        Processed <strong>{processedCount.toLocaleString()}</strong> post
        {processedCount !== 1 ? "s" : ""} before stopping. Results scanned so
        far are saved below.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          onClick={onAction}
          className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-6 text-sm font-medium text-primary-ink transition-opacity hover:opacity-90"
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

// ── RunningView ────────────────────────────────────────────────────────────────

function RunningView({
  snapshot,
  label,
  onStop,
}: {
  snapshot: AuditSnapshot;
  label: string;
  onStop: () => void;
}) {
  const { total, processed, flagged } = snapshot.progress;
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
  const remaining = Math.max(total - processed, 0);

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <StatusBadge status="running" />
          <span className="text-sm text-ink-2">
            {total === 0 ? label : `${label} (${processed} of ${total})`}
          </span>
        </div>
        <button
          onClick={onStop}
          className="shrink-0 text-sm text-ink-2 hover:text-ink hover:underline"
        >
          Stop scan
        </button>
      </div>

      <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="mt-3 flex gap-6 text-sm">
        <span>
          <strong>{remaining}</strong> left to scan
        </span>
        <span>
          <strong>{flagged}</strong> flagged so far
        </span>
      </div>

      <FlaggedList
        posts={snapshot.posts.filter((p) => p.flags.length > 0)}
        className="mt-6"
        compact
      />
    </div>
  );
}

// ── ResultsView ────────────────────────────────────────────────────────────────

function ResultsView({
  result,
  meta,
  live,
}: {
  result: StoredAudit;
  meta: JobMeta;
  live: boolean;
}) {
  const allFlaggedPosts = result.posts.filter((p) => p.flags.length > 0);
  const cleanPosts = result.posts.filter((p) => p.flags.length === 0);
  const statEntries = Object.entries(result.stats) as [RiskCategory, number][];
  const allCats = statEntries.map(([cat]) => cat);

  const [activeCategories, setActiveCategories] = useState<Set<RiskCategory>>(
    () => new Set(allCats),
  );
  const isAllOn = activeCategories.size === allCats.length;

  const visiblePosts = allFlaggedPosts.filter((p) =>
    p.flags.some((f) => activeCategories.has(f.category)),
  );

  function toggleCategory(cat: RiskCategory) {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  }

  function showAll() {
    setActiveCategories(new Set(allCats));
  }

  const severityBuckets: Record<DesignSeverity, number> = {
    clear: 0,
    low: 0,
    med: 0,
    high: 0,
    crit: 0,
  };
  for (const p of allFlaggedPosts) {
    severityBuckets[postSeverity(p.flags)]++;
  }
  severityBuckets.clear = cleanPosts.length;

  const statStripItems = (
    [
      { severity: "crit" as DesignSeverity, label: "Critical" },
      { severity: "high" as DesignSeverity, label: "High" },
      { severity: "med" as DesignSeverity, label: "Medium" },
      { severity: "low" as DesignSeverity, label: "Low" },
      { severity: "clear" as DesignSeverity, label: "Clear ✓" },
    ] as const
  )
    .filter((s) => severityBuckets[s.severity] > 0)
    .map((s) => ({
      severity: s.severity,
      label: s.label,
      count: severityBuckets[s.severity],
    }));

  return (
    <div className="mt-6 space-y-8">
      <dl className="divide-y divide-line rounded-xl border border-line">
        <Row label="Status">
          <StatusBadge status="completed" />
        </Row>
        <Row label="Date started">
          {formatDate(meta.startedAt ?? meta.createdAt)}
        </Row>
        <Row label="Scanned">{result.progress.total} tweets</Row>
        <Row label="Flagged">{result.progress.flagged} tweets</Row>
        {meta.scanLimit != null && (
          <Row label="Post limit">{meta.scanLimit.toLocaleString()}</Row>
        )}
        {meta.likesCap != null && (
          <Row label="Likes processed">
            {meta.likesProcessed.toLocaleString()} of{" "}
            {meta.likesCap.toLocaleString()}
          </Row>
        )}
        <Row label="Categories">
          {meta.enabledCategories.map((c) => RISK_LABELS[c]).join(", ") || "—"}
        </Row>
      </dl>

      {statStripItems.length > 0 && <StatStrip stats={statStripItems} />}

      {statEntries.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {statEntries.map(([cat, n]) => {
            const isOn = activeCategories.has(cat);
            return (
              <button
                key={cat}
                onClick={() => toggleCategory(cat)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
                  isOn
                    ? "border-primary bg-primary text-primary-ink"
                    : "border-line text-ink-3 hover:border-line-strong"
                }`}
              >
                {RISK_LABELS[cat]}
                <span className="font-semibold">{n}</span>
              </button>
            );
          })}
          <button
            onClick={showAll}
            disabled={isAllOn}
            className="rounded-full border border-line px-3 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-30 enabled:hover:border-line-strong"
          >
            Show all
          </button>
        </div>
      )}

      <p className="rounded-lg bg-low-soft px-4 py-2 text-xs text-low">
        {live
          ? "Deletion isn't available yet — review the flagged posts below."
          : "Sample data — sign in with X to scan real tweets. Deletion isn't available yet; review the flagged posts below."}
      </p>

      <section>
        <h2 className="text-sm font-medium text-ink-2">
          {isAllOn
            ? `Flagged (${allFlaggedPosts.length})`
            : `Flagged (${visiblePosts.length} of ${allFlaggedPosts.length})`}
        </h2>
        {visiblePosts.length === 0 ? (
          <p className="mt-3 text-sm text-ink-2">Nothing flagged. 🎉</p>
        ) : (
          <FlaggedList posts={visiblePosts} className="mt-3" />
        )}
      </section>

      {cleanPosts.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-sm font-medium text-ink-2 select-none">
            No issues ({cleanPosts.length})
          </summary>
          <ul className="mt-3 space-y-2">
            {cleanPosts.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-line px-4 py-3 text-sm"
              >
                <span className="min-w-0 truncate text-ink-2">{p.text}</span>
                <TweetLink url={p.url} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function RerunButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="mt-4 inline-flex h-10 items-center justify-center rounded-full bg-primary px-5 text-sm font-medium text-primary-ink transition-opacity hover:opacity-90"
    >
      Re-run scan
    </button>
  );
}

function FlaggedList({
  posts,
  className = "",
  compact = false,
}: {
  posts: AuditedPost[];
  className?: string;
  compact?: boolean;
}) {
  if (posts.length === 0) return null;

  if (compact) {
    return (
      <ul className={`space-y-2 ${className}`}>
        {posts.map((p) => (
          <li
            key={p.id}
            className="flex items-start gap-3 rounded-lg border border-line px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <span className="text-xs text-ink-3">
                @{p.authorHandle} · {formatDate(p.postedAt)}
              </span>
              <p className="mt-0.5 truncate text-sm">{p.text}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {dedupeCategories(p.flags).map((f, i) => (
                  <span
                    key={i}
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${SEVERITY_STYLES[f.severity]}`}
                    title={f.reason}
                  >
                    {RISK_LABELS[f.category]}
                  </span>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${className}`}>
      {posts.map((p) => {
        const sev = postSeverity(p.flags);
        const redacted = shouldRedact(p.flags);
        const reasons = dedupeCategories(p.flags).map((f) => ({
          label: RISK_LABELS[f.category],
          severity: SEVERITY_TOKEN[f.severity],
        }));
        return (
          <li key={p.id} className="list-none">
            <RiskCard
              name={p.authorHandle}
              handle={p.authorHandle}
              date={formatDate(p.postedAt)}
              avatarUrl={p.authorAvatarUrl}
              body={p.text}
              mediaUrls={p.mediaUrls}
              severity={sev}
              reasons={reasons}
              redacted={redacted}
              redactReason={redactReason(p.flags)}
              href={p.url}
            />
          </li>
        );
      })}
    </ul>
  );
}

function dedupeCategories(flags: Flag[]): Flag[] {
  const seen = new Set<RiskCategory>();
  const out: Flag[] = [];
  for (const f of flags) {
    if (seen.has(f.category)) continue;
    seen.add(f.category);
    out.push(f);
  }
  return out;
}

function TweetLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="shrink-0 whitespace-nowrap text-xs font-medium text-ink-2 hover:underline hover:text-ink"
    >
      View on X ↗
    </a>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-5 py-3">
      <dt className="text-sm text-ink-2">{label}</dt>
      <dd className="text-right text-sm">{children}</dd>
    </div>
  );
}
