"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { runAudit, type AuditSnapshot } from "@/lib/audit/engine";
import { loadAudit, saveAudit, type StoredAudit } from "@/lib/audit/storage";
import {
  PaymentRequiredError,
  type PaymentRequiredDetails,
} from "@/lib/audit/source";
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
import { StatusBadge, formatDate, auditName } from "@/components/CardList";

type JobMeta = {
  jobId: string;
  status: string;
  enabledCategories: RiskCategory[];
  createdAt: string;
  startedAt: string | null;
  scanLimit: number | null;
};

type Phase =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "running"; snapshot: AuditSnapshot }
  | { kind: "done"; result: StoredAudit }
  | { kind: "missing_results" } // job completed elsewhere; no local data
  | { kind: "payment_required"; details: PaymentRequiredDetails }
  | { kind: "error"; message: string };

// Severity → display style is now in lib/audit/severity.ts and the ui/RiskCard/Badge
// components. Kept minimal here for the compact running-view chip only.
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

  useEffect(() => {
    const supabase = createClient();

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data: job } = await supabase
        .from("audit_jobs")
        .select("job_id, status, enabled_categories, created_at, started_at, scan_limit")
        .eq("job_id", jobId)
        .maybeSingle();

      if (!job || !user) {
        setPhase({ kind: "not_found" });
        return;
      }

      // X-authenticated users scan their real timeline; others get sample data.
      const isLive = user.app_metadata?.provider === "x";
      setLive(isLive);

      const jobMeta: JobMeta = {
        jobId: job.job_id,
        status: job.status,
        enabledCategories: (job.enabled_categories ?? []) as RiskCategory[],
        createdAt: job.created_at,
        startedAt: job.started_at,
        scanLimit: typeof job.scan_limit === "number" ? job.scan_limit : null,
      };
      setMeta(jobMeta);

      const existing = loadAudit(jobId);
      if (existing) {
        setPhase({ kind: "done", result: existing });
        return;
      }

      if (job.status === "completed" || job.status === "failed") {
        // Results were produced on another device / cleared locally.
        setPhase({ kind: "missing_results" });
        return;
      }

      // queued or running with no local results → run it now.
      void start(jobMeta, user.id, isLive, supabase);
    })();
    // No abort-on-cleanup: under React StrictMode the effect mounts twice, and
    // aborting here would kill the real run (it finishes + persists regardless).
  }, [jobId]);

  async function start(
    jobMeta: JobMeta,
    userId: string,
    isLive: boolean,
    supabase: ReturnType<typeof createClient>,
  ) {
    if (startedRef.current) return;
    startedRef.current = true;

    setPhase({
      kind: "running",
      snapshot: { progress: { total: 0, processed: 0, flagged: 0 }, stats: {}, posts: [] },
    });

    await supabase
      .from("audit_jobs")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("job_id", jobMeta.jobId);

    try {
      const result = await runAudit({
        jobId: jobMeta.jobId,
        userId,
        enabledCategories: jobMeta.enabledCategories,
        live: isLive,
        // Real scans are slow enough already; the per-tweet delay only exists to
        // make sample-data progress visible.
        stepDelayMs: isLive ? 0 : undefined,
        onProgress: (snapshot) => setPhase({ kind: "running", snapshot }),
      });

      const finishedAt = new Date().toISOString();
      const stored: StoredAudit = {
        jobId: jobMeta.jobId,
        status: "completed",
        posts: result.posts,
        progress: result.progress,
        stats: result.stats,
        finishedAt,
      };
      saveAudit(stored);

      await supabase
        .from("audit_jobs")
        .update({
          status: "completed",
          progress: result.progress,
          stats: result.stats,
          finished_at: finishedAt,
        })
        .eq("job_id", jobMeta.jobId);

      setPhase({ kind: "done", result: stored });
    } catch (err) {
      if (err instanceof PaymentRequiredError) {
        // Not a failure — the user just needs to pay. Re-queue so returning
        // after checkout re-runs the scan (which now passes the gate).
        await supabase
          .from("audit_jobs")
          .update({ status: "queued" })
          .eq("job_id", jobMeta.jobId);
        startedRef.current = false;
        setPhase({ kind: "payment_required", details: err.details });
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
      if (user) {
        void start(meta, user.id, live, supabase);
      }
    })();
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <Link href="/portal/jobs" className="text-sm text-ink-2 hover:underline">
        ← Back to audits
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        {auditName(meta?.createdAt)}
      </h1>
      <p className="mt-1 text-sm text-ink-3">#{jobId}</p>

      {phase.kind === "loading" && (
        <p className="mt-6 text-sm text-ink-2">Loading…</p>
      )}

      {phase.kind === "not_found" && (
        <p className="mt-6 text-sm text-ink-2">
          We couldn’t find that audit.
        </p>
      )}

      {phase.kind === "running" && <RunningView snapshot={phase.snapshot} />}

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
            We never store any of your tweets on our server, so if you cleared
            your cache, the tweets in this run were cleared too.
          </p>
          <RerunButton onClick={rerun} />
        </div>
      )}

      {phase.kind === "payment_required" && (
        <PaymentView jobId={jobId} details={phase.details} />
      )}

      {phase.kind === "done" && meta && (
        <ResultsView result={phase.result} meta={meta} live={live} />
      )}
    </main>
  );
}

function PaymentView({
  jobId,
  details,
}: {
  jobId: string;
  details: PaymentRequiredDetails;
}) {
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    setPaying(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credits: details.creditsToBuy, jobId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      setError(data.error ?? "Could not start checkout.");
      setPaying(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start checkout.");
      setPaying(false);
    }
  }

  const costDollars = (details.creditsToBuy / 100).toFixed(2);
  return (
    <div className="mt-6 rounded-xl border border-line p-6">
      <h2 className="text-lg font-semibold">Not enough scan credits</h2>
      <p className="mt-2 text-sm text-ink-2">
        This scan needs{" "}
        <strong>{details.shortfall.toLocaleString()}</strong> more credits than
        you have. Top up{" "}
        <strong>{details.creditsToBuy.toLocaleString()}</strong> credits ($
        {costDollars}) to continue.
      </p>
      {error && <p className="mt-3 text-sm text-crit">{error}</p>}
      <button
        onClick={pay}
        disabled={paying}
        className="mt-4 inline-flex h-11 items-center justify-center rounded-full bg-primary px-6 text-sm font-medium text-primary-ink transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {paying
          ? "Starting checkout…"
          : `Top up ${details.creditsToBuy.toLocaleString()} credits`}
      </button>
    </div>
  );
}

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

function RunningView({ snapshot }: { snapshot: AuditSnapshot }) {
  const { total, processed, flagged } = snapshot.progress;
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
  const remaining = Math.max(total - processed, 0);

  return (
    <div className="mt-6">
      <div className="flex items-center gap-3">
        <StatusBadge status="running" />
        <span className="text-sm text-ink-2">
          {total === 0 ? "Fetching tweets…" : `Scanning ${processed} of ${total}`}
        </span>
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

      {/* Surface flags as they come in. */}
      <FlaggedList
        posts={snapshot.posts.filter((p) => p.flags.length > 0)}
        className="mt-6"
        compact
      />
    </div>
  );
}

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
      if (next.has(cat)) { next.delete(cat); } else { next.add(cat); }
      return next;
    });
  }

  function showAll() {
    setActiveCategories(new Set(allCats));
  }

  // Build StatStrip counts: severity tiers across all flagged posts + clear count.
  const severityBuckets: Record<DesignSeverity, number> = {
    clear: 0, low: 0, med: 0, high: 0, crit: 0,
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
  ).filter((s) => severityBuckets[s.severity] > 0).map((s) => ({
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
        <Row label="Categories">
          {meta.enabledCategories.map((c) => RISK_LABELS[c]).join(", ") || "—"}
        </Row>
      </dl>

      {/* Severity stat strip */}
      {statStripItems.length > 0 && (
        <StatStrip stats={statStripItems} />
      )}

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
          ? "Deletion isn’t available yet — review the flagged posts below."
          : "Sample data — sign in with X to scan real tweets. Deletion isn’t available yet; review the flagged posts below."}
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
          <summary className="cursor-pointer text-sm font-medium text-ink-2">
            No issues ({cleanPosts.length})
          </summary>
          <ul className="mt-3 space-y-2">
            {cleanPosts.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-line px-4 py-3 text-sm"
              >
                <span className="min-w-0 truncate text-ink-2">
                  {p.text}
                </span>
                <TweetLink url={p.url} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * Full results card list — uses RiskCard for complete post cards with severity
 * badge, reason chips, meter, and View-on-X action.
 */
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
    // Running-view inline compact list (no full RiskCard chrome)
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-5 py-3">
      <dt className="text-sm text-ink-2">{label}</dt>
      <dd className="text-right text-sm">{children}</dd>
    </div>
  );
}
