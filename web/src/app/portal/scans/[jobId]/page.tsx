import JobRunner from "@/components/JobRunner";

/**
 * Job Detail. The scan runs CLIENT-SIDE (orchestration + progress + result
 * storage), so this server page just resolves the id and hands off to the
 * client runner. The proxy already gates `/portal/*` behind auth.
 */
export default async function JobDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<{ paid?: string; start?: string }>;
}) {
  const { jobId } = await params;
  const sp = await searchParams;
  // The runner auto-runs (and charges) ONLY when the user explicitly authorized
  // the spend on the prior screen: "Pay & start" → Stripe success (`paid=1`), or
  // "Start scan" when existing credits cover it (`start=1`). Every other arrival
  // (direct nav, reload, balance-covered redirect) must wait for a click.
  const authorized = sp.paid === "1" || sp.start === "1";
  return <JobRunner jobId={jobId} authorized={authorized} />;
}
