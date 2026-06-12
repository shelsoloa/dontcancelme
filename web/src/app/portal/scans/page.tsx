import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { scanName, StatusBadge } from "@/components/CardList";
import { RISK_LABELS, type RiskCategory } from "@/lib/audit/types";
import { deleteJob } from "./actions";

function categoryLabels(codes: string[] | null): string[] {
  return (codes ?? [])
    .map((c) => RISK_LABELS[c as RiskCategory])
    .filter((label): label is string => Boolean(label));
}

export default async function ScansPage() {
  const supabase = await createClient();
  const { data: jobs } = await supabase
    .from("audit_jobs")
    .select("job_id, status, enabled_categories, created_at, progress")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Your scans</h1>
        <Link
          href="/portal/scans/new"
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-full bg-primary px-5 text-sm font-medium text-primary-ink transition-opacity hover:opacity-90"
        >
          New scan
        </Link>
      </div>

      {!jobs || jobs.length === 0 ? (
        <p className="mt-6 text-sm text-ink-2">
          No scans yet.{" "}
          <Link href="/portal/scans/new" className="underline">
            Start one
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {jobs.map((j) => {
            const progress = j.progress as {
              total?: number;
              flagged?: number;
            } | null;
            const scanned = progress?.total ?? 0;
            const flagged = progress?.flagged ?? 0;
            const hasStats = scanned > 0;
            const labels = categoryLabels(j.enabled_categories);

            return (
              <li key={j.job_id} className="flex items-stretch gap-2">
                <Link
                  href={`/portal/scans/${j.job_id}`}
                  className="flex min-w-0 flex-1 items-start justify-between gap-4 rounded-xl border border-line px-5 py-4 transition-colors hover:bg-surface-2"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {scanName(j.created_at)}
                    </p>
                    <p className="text-sm text-ink-2">
                      {hasStats
                        ? `${scanned.toLocaleString()} posts scanned · ${flagged.toLocaleString()} flagged`
                        : `#${j.job_id}`}
                    </p>
                    {labels.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {labels.map((label) => (
                          <span
                            key={label}
                            className="inline-flex items-center rounded-full border border-line px-2.5 py-0.5 text-xs text-ink-2"
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <StatusBadge status={j.status} />
                </Link>

                <form action={deleteJob.bind(null, j.job_id)}>
                  <button
                    type="submit"
                    aria-label="Delete scan"
                    className="flex h-full items-center justify-center rounded-xl border border-line px-3.5 text-ink-3 transition-colors hover:border-crit/40 hover:bg-crit-soft hover:text-crit"
                  >
                    ✕
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
