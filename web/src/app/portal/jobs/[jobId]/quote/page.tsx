import QuoteView from "@/components/QuoteView";

/**
 * Quote page — shows the exact deterministic cost plus a metered likes estimate
 * before the user pays. The proxy already gates /portal/* behind auth.
 */
export default async function QuotePage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  return <QuoteView jobId={jobId} />;
}
