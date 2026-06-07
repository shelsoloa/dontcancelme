import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { CardList } from "@/components/CardList";

export default async function JobsPage() {
  const supabase = await createClient();
  const { data: jobs } = await supabase
    .from("audit_jobs")
    .select("job_id, status, enabled_categories, created_at, started_at, progress")
    .order("created_at", { ascending: false });

  function subtitle(j: {
    enabled_categories: string[] | null;
    status: string;
    progress: { flagged?: number; total?: number } | null;
  }) {
    const n = (j.enabled_categories ?? []).length;
    const cats = `${n} categor${n === 1 ? "y" : "ies"}`;
    if (j.status === "completed" && j.progress) {
      return `${cats} · ${j.progress.flagged ?? 0} of ${j.progress.total ?? 0} flagged`;
    }
    return cats;
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Your audits</h1>

      {!jobs || jobs.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-500">
          No audits yet.{" "}
          <Link href="/start" className="underline">
            Start one
          </Link>
          .
        </p>
      ) : (
        <CardList
          className="mt-6"
          items={jobs.map((j) => ({
            href: `/portal/jobs/${j.job_id}`,
            title: `Audit ${String(j.job_id).slice(0, 8)}`,
            subtitle: subtitle(j),
            status: j.status,
            date: j.started_at ?? j.created_at,
          }))}
        />
      )}
    </main>
  );
}
