"use client";

import { useState, useTransition } from "react";
import { deleteJob } from "./actions";

export function DeleteScanButton({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      await deleteJob(jobId);
      setOpen(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Delete scan"
        className="flex h-full items-center justify-center rounded-xl border border-line px-3.5 text-ink-3 transition-colors hover:border-crit/40 hover:bg-crit-soft hover:text-crit"
      >
        ✕
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-xl">
            <h2 id="delete-modal-title" className="text-lg font-semibold">
              Delete this scan?
            </h2>
            <p className="mt-3 text-sm text-ink-2">
              Scan results are stored locally in your browser — once deleted
              they cannot be recovered.
            </p>
            <p className="mt-2 text-sm text-ink-2">
              Deleting a scan does not reinstate any credits used.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                onClick={confirm}
                disabled={pending}
                className="inline-flex h-10 flex-1 items-center justify-center rounded-full bg-crit-soft px-4 text-sm font-medium text-crit transition-opacity hover:opacity-80 disabled:opacity-50"
              >
                {pending ? "Deleting…" : "Yes, delete"}
              </button>
              <button
                onClick={() => setOpen(false)}
                disabled={pending}
                className="inline-flex h-10 flex-1 items-center justify-center rounded-full border border-line px-4 text-sm font-medium transition-colors hover:border-line-strong disabled:opacity-50"
              >
                No, keep it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
