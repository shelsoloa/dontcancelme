import JobRunner from "@/components/JobRunner";

/**
 * Job Detail. The audit runs CLIENT-SIDE (orchestration + progress + result
 * storage), so this server page just resolves the id and hands off to the
 * client runner. The proxy already gates `/portal/*` behind auth.
 */
export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  return <JobRunner jobId={jobId} />;
}
