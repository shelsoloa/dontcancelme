"use client";

import { useState } from "react";

// Mirrors MIN_CREDITS / CREDITS_PER_DOLLAR in lib/billing.ts.
const MIN_CREDITS = 500;
const CREDITS_PER_DOLLAR = 100;

/**
 * Inline top-up control: an exact credit-amount input + button that kicks off a
 * Stripe Checkout session. Rate: $1 per 100 credits. Minimum: 500 credits.
 *
 * If `jobId` is provided, the Stripe success URL returns the user to that job
 * so a scan blocked by insufficient credits can resume immediately.
 */
export function TopUpButton({ jobId }: { jobId?: string }) {
  const [credits, setCredits] = useState(MIN_CREDITS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const belowMin = credits < MIN_CREDITS;
  const costDollars = (credits / CREDITS_PER_DOLLAR).toFixed(2);

  async function handleTopUp() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credits, jobId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      setError(data.error ?? "Could not start checkout.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start checkout.");
    }
    setLoading(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={MIN_CREDITS}
          step={1}
          value={credits}
          onChange={(e) => {
            const v = Math.floor(Number(e.target.value));
            setCredits(Number.isFinite(v) && v > 0 ? v : 1);
          }}
          className="w-24 rounded-lg border border-zinc-300 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
        />
        <span className="text-sm text-zinc-500">
          credits = ${costDollars}
        </span>
      </div>
      <button
        onClick={handleTopUp}
        disabled={loading || belowMin}
        className="inline-flex h-9 items-center justify-center rounded-full bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {loading ? "Loading…" : "+ Top Up"}
      </button>
      {belowMin && (
        <p className="mt-1 w-full text-sm text-red-600">
          Minimum 500 credits / transaction
        </p>
      )}
      {!belowMin && error && (
        <p className="mt-1 w-full text-sm text-red-600">{error}</p>
      )}
    </div>
  );
}
