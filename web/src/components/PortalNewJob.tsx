"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  JobCreationForm,
  type JobFormInitial,
} from "@/components/JobCreationForm";
import { startAudit, type StartAuditInput } from "@/app/start/actions";

/**
 * New-audit form for the (already-authenticated) portal. Queues the job and
 * jumps straight to its detail page, where the scan runs.
 */
export function PortalNewJob({ initial }: { initial?: JobFormInitial }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(payload: StartAuditInput) {
    setSubmitting(true);
    setError(null);
    const result = await startAudit(payload);
    if ("jobId" in result) {
      router.push(`/portal/jobs/${result.jobId}/quote`);
    } else {
      setSubmitting(false);
      setError(result.error);
    }
  }

  return (
    <JobCreationForm
      initial={initial}
      submitting={submitting}
      error={error}
      onSubmit={onSubmit}
    />
  );
}
