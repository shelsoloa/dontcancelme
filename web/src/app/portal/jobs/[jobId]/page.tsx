import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StatusBadge, formatDate } from "@/components/CardList";

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-5 py-3">
      <dt className="text-sm text-zinc-500">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("audit_jobs")
    .select("*")
    .eq("job_id", jobId)
    .maybeSingle();

  if (!job) notFound();

  const categories: string[] = job.enabled_categories ?? [];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <Link
        href="/portal/jobs"
        className="text-sm text-zinc-500 hover:underline"
      >
        ← Back to audits
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        Audit {String(job.job_id).slice(0, 8)}
      </h1>

      <dl className="mt-6 divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        <Row label="Status">
          <StatusBadge status={job.status} />
        </Row>
        <Row label="Date started">
          {formatDate(job.started_at ?? job.created_at)}
        </Row>
        <Row label="Categories">{categories.join(", ") || "—"}</Row>
      </dl>

      <p className="mt-6 text-sm text-zinc-500">
        This audit is queued. Scanning isn’t wired up yet — results will appear
        here once it runs.
      </p>
    </main>
  );
}
