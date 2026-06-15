"use client";

import { useState } from "react";
import type { AuditedPost } from "@/lib/audit/types";

type DeleteResult = "idle" | "loading" | "success" | { error: string };

export function DeleteTweetButton({
  post,
  onDeleted,
}: {
  post: AuditedPost;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<DeleteResult>("idle");

  function close() {
    if (result === "loading") return;
    setOpen(false);
    setResult("idle");
  }

  async function confirm() {
    if (!post.auditSource) return;
    setResult("loading");

    try {
      const res = await fetch("/api/x/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platformPostId: post.platformPostId,
          auditSource: post.auditSource,
        }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };

      if (data.success) {
        setResult("success");
        setTimeout(() => {
          setOpen(false);
          setResult("idle");
          onDeleted();
        }, 800);
      } else {
        setResult({
          error: data.error ?? `Request failed (${res.status})`,
        });
      }
    } catch (e) {
      setResult({
        error: e instanceof Error ? e.message : "Network error — try again",
      });
    }
  }

  if (!post.auditSource) return null;

  const actionLabel =
    post.auditSource === "likes"
      ? "unlike this tweet"
      : post.auditSource === "reposts"
        ? "undo this repost"
        : "delete this tweet";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={actionLabel}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-crit-soft hover:text-crit"
        title={actionLabel}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="3,6 5,6 21,6" />
          <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
          <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-tweet-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-xl">
            {result === "loading" ? (
              <p className="text-center text-sm text-ink-2">
                Deleting&hellip;
              </p>
            ) : result === "success" ? (
              <div className="text-center">
                <p className="text-lg font-semibold text-primary">
                  Deleted &#10003;
                </p>
              </div>
            ) : (
              <>
                <h2
                  id="delete-tweet-modal-title"
                  className="text-lg font-semibold"
                >
                  Delete this tweet?
                </h2>
                <p className="mt-3 text-sm text-ink-2">
                  THIS WILL {actionLabel.toUpperCase()}. NO UNDO.
                </p>
                {typeof result === "object" && result.error && (
                  <p className="mt-3 text-sm text-crit">{result.error}</p>
                )}
                <div className="mt-6 flex gap-3">
                  <button
                    onClick={confirm}
                    className="inline-flex h-10 flex-1 items-center justify-center rounded-full bg-crit-soft px-4 text-sm font-medium text-crit transition-opacity hover:opacity-80"
                  >
                    Yes, delete
                  </button>
                  <button
                    onClick={close}
                    className="inline-flex h-10 flex-1 items-center justify-center rounded-full border border-line px-4 text-sm font-medium transition-colors hover:border-line-strong"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
