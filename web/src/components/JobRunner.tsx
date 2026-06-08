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
import { StatusBadge, formatDate, auditName } from "@/components/CardList";

type JobMeta = {
  jobId: string;
  status: string;
  enabledCategories: RiskCategory[];
  createdAt: string;
  startedAt: string | null;
};

type Phase =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "running"; snapshot: AuditSnapshot }
  | { kind: "done"; result: StoredAudit }
  | { kind: "missing_results" } // job completed elsewhere; no local data
  | { kind: "payment_required"; details: PaymentRequiredDetails }
  | { kind: "error"; message: string };

const SEVERITY_STYLES: Record<Severity, string> = {
  low: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  critical: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
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
        .select("job_id, status, enabled_categories, created_at, started_at")
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
      <Link href="/portal/jobs" className="text-sm text-zinc-500 hover:underline">
        ← Back to audits
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        {auditName(meta?.createdAt)}
      </h1>
      <p className="mt-1 text-sm text-zinc-500">#{jobId}</p>

      {phase.kind === "loading" && (
        <p className="mt-6 text-sm text-zinc-500">Loading…</p>
      )}

      {phase.kind === "not_found" && (
        <p className="mt-6 text-sm text-zinc-500">
          We couldn’t find that audit.
        </p>
      )}

      {phase.kind === "running" && <RunningView snapshot={phase.snapshot} />}

      {phase.kind === "error" && (
        <div className="mt-6">
          <StatusBadge status="failed" />
          <p className="mt-3 text-sm text-red-600">{phase.message}</p>
          <RerunButton onClick={rerun} />
        </div>
      )}

      {phase.kind === "missing_results" && (
        <div className="mt-6">
          <p className="text-sm text-zinc-500">
            This audit finished, but its results aren’t stored on this device
            (tweets are kept client-side for now). Re-run the scan to see them.
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
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
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

  const blocks = details.billableBlocks;
  return (
    <div className="mt-6 rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
      <h2 className="text-lg font-semibold">This scan needs the Pro plan</h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Your account has <strong>{details.tweetCount.toLocaleString()}</strong>{" "}
        scannable tweets — over the free {details.freeLimit}-tweet limit. Scanning
        the rest costs <strong>{blocks}</strong> × 500-tweet block
        {blocks === 1 ? "" : "s"}.
      </p>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <button
        onClick={pay}
        disabled={paying}
        className="mt-4 inline-flex h-11 items-center justify-center rounded-full bg-foreground px-6 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {paying
          ? "Starting checkout…"
          : `Pay to scan ${details.tweetCount.toLocaleString()} tweets`}
      </button>
    </div>
  );
}

function RerunButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="mt-4 inline-flex h-10 items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-90"
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
        <span className="text-sm text-zinc-500">
          {total === 0 ? "Fetching tweets…" : `Scanning ${processed} of ${total}`}
        </span>
      </div>

      <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div
          className="h-full rounded-full bg-foreground transition-all"
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

  return (
    <div className="mt-6 space-y-8">
      <dl className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        <Row label="Status">
          <StatusBadge status="completed" />
        </Row>
        <Row label="Date started">
          {formatDate(meta.startedAt ?? meta.createdAt)}
        </Row>
        <Row label="Scanned">{result.progress.total} tweets</Row>
        <Row label="Flagged">{result.progress.flagged} tweets</Row>
        <Row label="Categories">
          {meta.enabledCategories.map((c) => RISK_LABELS[c]).join(", ") || "—"}
        </Row>
      </dl>

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
                    ? "border-foreground bg-foreground text-background"
                    : "border-zinc-200 text-zinc-400 hover:border-zinc-400 dark:border-zinc-800 dark:text-zinc-600 dark:hover:border-zinc-600"
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
            className="rounded-full border border-zinc-200 px-3 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-30 dark:border-zinc-800 enabled:hover:border-zinc-400 dark:enabled:hover:border-zinc-600"
          >
            Show all
          </button>
        </div>
      )}

      <p className="rounded-lg bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
        {live
          ? "Deletion isn’t available yet — review the flagged posts below."
          : "Sample data — sign in with X to scan real tweets. Deletion isn’t available yet; review the flagged posts below."}
      </p>

      <section>
        <h2 className="text-sm font-medium text-zinc-500">
            {isAllOn
            ? `Flagged (${allFlaggedPosts.length})`
            : `Flagged (${visiblePosts.length} of ${allFlaggedPosts.length})`}
        </h2>
        {visiblePosts.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">Nothing flagged. 🎉</p>
        ) : (
          <FlaggedList posts={visiblePosts} className="mt-3" />
        )}
      </section>

      {cleanPosts.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-sm font-medium text-zinc-500">
            No issues ({cleanPosts.length})
          </summary>
          <ul className="mt-3 space-y-2">
            {cleanPosts.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-zinc-200 px-4 py-3 text-sm dark:border-zinc-800"
              >
                <span className="min-w-0 truncate text-zinc-600 dark:text-zinc-400">
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
  return (
    <ul className={`space-y-3 ${className}`}>
      {posts.map((p) => (
        <li
          key={p.id}
          className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {p.authorAvatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.authorAvatarUrl}
                    alt={`@${p.authorHandle}`}
                    className="h-6 w-6 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <div className="h-6 w-6 shrink-0 rounded-full bg-zinc-200 dark:bg-zinc-700" />
                )}
                <span className="text-xs text-zinc-400">
                  @{p.authorHandle} · {formatDate(p.postedAt)}
                </span>
              </div>
              <p className="mt-1 text-sm">{p.text}</p>
              {p.mediaUrls && p.mediaUrls.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {p.mediaUrls.map((src, i) => (
                    <a
                      key={i}
                      href={src}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={src}
                        alt={`Media ${i + 1} from @${p.authorHandle}`}
                        loading="lazy"
                        className="h-40 max-w-xs rounded-lg border border-zinc-200 object-cover dark:border-zinc-700"
                      />
                    </a>
                  ))}
                </div>
              )}
            </div>
            <TweetLink url={p.url} />
          </div>
          {!compact && (
            <div className="mt-3 flex flex-wrap gap-2">
              {p.flags.map((f, i) => (
                <FlagChip key={i} flag={f} />
              ))}
            </div>
          )}
          {compact && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {dedupeCategories(p.flags).map((f, i) => (
                <FlagChip key={i} flag={f} labelOnly />
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function FlagChip({ flag, labelOnly = false }: { flag: Flag; labelOnly?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${SEVERITY_STYLES[flag.severity]}`}
      title={flag.reason}
    >
      {RISK_LABELS[flag.category]}
      {!labelOnly && (
        <span className="font-normal opacity-80">· {flag.reason}</span>
      )}
    </span>
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
      className="shrink-0 whitespace-nowrap text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
    >
      View on X ↗
    </a>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-5 py-3">
      <dt className="text-sm text-zinc-500">{label}</dt>
      <dd className="text-right text-sm">{children}</dd>
    </div>
  );
}
