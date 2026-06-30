"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

type DeterministicQuote = {
  textCount: number;
  imageCount: number;
  repostCount: number;
  freeApplied: number;
  units: number;
  usd: string;
};

type LikesQuote = {
  enabled: boolean;
  capN: number | null;
  suggestedBundleUnits: number;
  suggestedBundleUsd: string;
  metered: true;
};

type Quote = {
  deterministic: DeterministicQuote;
  likes: LikesQuote;
  totalUpfrontUnits: number;
  totalUpfrontUsd: string;
  currentBalance: number;
};

type ViewPhase =
  | { kind: "loading" }
  | { kind: "not_live" } // dev user — skip to runner
  | { kind: "error"; message: string }
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | { kind: "ready"; quote: Quote }
  | { kind: "paying" };

/**
 * QuoteView — client component for the /portal/scans/[jobId]/quote route.
 *
 * Calls POST /api/quote to compute and persist the job's price quote, then
 * renders it for the user to review before checkout. X-unauthenticated (dev)
 * users skip the quote page entirely and go straight to the runner.
 */
export default function QuoteView({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<ViewPhase>({ kind: "loading" });
  const [payError, setPayError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      // Non-X users (dev login, email) get sample data and bypass payment.
      const isLive = user?.app_metadata?.provider === "x";
      if (!isLive) {
        // Redirect directly to the runner — no quote, no payment needed.
        router.replace(`/portal/scans/${jobId}`);
        return;
      }

      try {
        const res = await fetch("/api/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId }),
        });
        if (res.status === 429) {
          const d = await res.json().catch(() => ({}));
          setPhase({
            kind: "rate_limited",
            retryAfterSeconds: d.retryAfterSeconds ?? 60,
          });
          return;
        }
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          setPhase({
            kind: "error",
            message: d.error ?? `Quote failed (${res.status})`,
          });
          return;
        }
        const quote = (await res.json()) as Quote;

        // If the job is entirely free (0 units needed), go to the runner — but
        // the runner still gates the (free) run behind an explicit Start click.
        if (quote.totalUpfrontUnits === 0) {
          router.replace(`/portal/scans/${jobId}`);
          return;
        }

        // Otherwise show the quote and let the user decide. When their balance
        // already covers it there's no checkout — but we never silently skip to
        // the runner and spend their credits; they must click Start.
        setPhase({ kind: "ready", quote });
      } catch (e) {
        setPhase({
          kind: "error",
          message: e instanceof Error ? e.message : "Could not load quote.",
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  /**
   * Balance already covers the quote — no checkout needed. Navigate to the
   * runner WITH the authorization flag, since clicking this button IS the
   * user's explicit consent to spend their credits.
   */
  function startWithCredits() {
    router.push(`/portal/scans/${jobId}?start=1`);
  }

  async function pay(quote: Quote) {
    setPhase({ kind: "paying" });
    setPayError(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.url) {
        window.location.href = d.url;
        return;
      }
      setPayError(d.error ?? "Could not start checkout.");
      setPhase({ kind: "ready", quote });
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Could not start checkout.");
      setPhase({ kind: "ready", quote });
    }
  }

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-12">
      <Link href="/portal/scans" className="text-sm text-ink-2 hover:underline">
        ← Back to scans
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        Review your scan
      </h1>
      <p className="mt-2 text-sm text-ink-2">
        Pay once — your credits are yours to keep and use across scans.
      </p>

      {phase.kind === "loading" && (
        <p className="mt-8 text-sm text-ink-2">Computing your scan…</p>
      )}

      {phase.kind === "error" && (
        <div className="mt-8 rounded-xl border border-line p-6">
          <p className="text-sm text-crit">{phase.message}</p>
          <Link
            href="/portal/scans"
            className="mt-4 inline-block text-sm text-ink-2 hover:underline"
          >
            Back to scans
          </Link>
        </div>
      )}

      {phase.kind === "rate_limited" && (
        <div className="mt-8 rounded-xl border border-line p-6">
          <h2 className="text-base font-semibold">Too many requests</h2>
          <p className="mt-2 text-sm text-ink-2">
            You&apos;ve started too many scans in a short window. Try again
            in {phase.retryAfterSeconds} seconds.
          </p>
        </div>
      )}

      {phase.kind === "ready" && (
        <QuoteDetails
          quote={phase.quote}
          paying={false}
          needsCheckout={phase.quote.currentBalance < phase.quote.totalUpfrontUnits}
          onPay={() => pay(phase.quote)}
          onStart={startWithCredits}
          payError={payError}
        />
      )}

      {phase.kind === "paying" && (
        <div className="mt-8 text-sm text-ink-2">Redirecting to checkout…</div>
      )}
    </main>
  );
}

function QuoteDetails({
  quote,
  paying,
  needsCheckout,
  onPay,
  onStart,
  payError,
}: {
  quote: Quote;
  paying: boolean;
  needsCheckout: boolean;
  onPay: () => void;
  onStart: () => void;
  payError: string | null;
}) {
  const { deterministic, likes } = quote;
  const hasDetItems =
    deterministic.textCount > 0 ||
    deterministic.imageCount > 0 ||
    deterministic.repostCount > 0;

  return (
    <div className="mt-8 space-y-6">
      {/* ── Firm deterministic block ── */}
      <section className="rounded-xl border border-line p-6">
        <h2 className="text-base font-semibold">Your posts</h2>
        <p className="mt-1 text-xs text-ink-2">
          Exact total — guaranteed to complete.
        </p>

        {hasDetItems ? (
          <dl className="mt-4 divide-y divide-line text-sm">
            {deterministic.textCount > 0 && (
              <Row
                label={`Text posts (${deterministic.textCount.toLocaleString()} × 1¢)`}
                value={`$${(deterministic.textCount / 100).toFixed(2)}`}
              />
            )}
            {deterministic.imageCount > 0 && (
              <Row
                label={`Image posts (${deterministic.imageCount.toLocaleString()} × 4¢)`}
                value={`$${((deterministic.imageCount * 4) / 100).toFixed(2)}`}
              />
            )}
            {deterministic.repostCount > 0 && (
              <Row
                label={`Reposts (${deterministic.repostCount.toLocaleString()} × 1¢)`}
                value={`$${(deterministic.repostCount / 100).toFixed(2)}`}
              />
            )}
            {deterministic.freeApplied > 0 && (
              <Row
                label={`Free tier (${deterministic.freeApplied.toLocaleString()} posts)`}
                value={`−$${(deterministic.freeApplied / 100).toFixed(2)}`}
                muted
              />
            )}
            <div className="flex items-center justify-between py-3 font-semibold">
              <dt>Subtotal</dt>
              <dd>${deterministic.usd}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-4 text-sm text-ink-2">
            {deterministic.freeApplied > 0
              ? `Covered by your free tier (${deterministic.freeApplied} posts). No charge.`
              : "No own posts selected."}
          </p>
        )}
      </section>

      {/* ── Likes block (indeterministic) ── */}
      {likes.enabled && (
        <section className="rounded-xl border border-line p-6">
          <h2 className="text-base font-semibold">Liked posts</h2>
          <p className="mt-1 text-xs text-ink-2">
            Metered — processed until credits run out. Not an exact total.
          </p>
          <dl className="mt-4 divide-y divide-line text-sm">
            <Row
              label={`Up to ${likes.capN?.toLocaleString() ?? "??"} most recent liked posts`}
              value=""
            />
            <Row
              label="Suggested prepaid bundle (refundable via top-up)"
              value={`$${likes.suggestedBundleUsd}`}
            />
          </dl>
          <p className="mt-3 text-xs text-ink-2">
            Processing stops when your balance runs out. You can top up and
            resume from where we left off.
          </p>
        </section>
      )}

      {/* ── Total & pay ── */}
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-6">
        <div className="flex items-center justify-between text-lg font-semibold">
          <span>Total to purchase</span>
          <span>${quote.totalUpfrontUsd}</span>
        </div>
        <p className="mt-1 text-xs text-ink-2">
          {needsCheckout
            ? `${quote.totalUpfrontUnits.toLocaleString()} credits · unused credits stay in your balance.`
            : `Covered by your balance of ${quote.currentBalance.toLocaleString()} credits.`}
        </p>

        {payError && <p className="mt-3 text-sm text-crit">{payError}</p>}

        <button
          onClick={needsCheckout ? onPay : onStart}
          disabled={paying}
          className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-ink transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {needsCheckout
            ? paying
              ? "Redirecting to checkout…"
              : `Pay $${quote.totalUpfrontUsd} & start scan`
            : `Start scan — use $${quote.totalUpfrontUsd} of your credits`}
        </button>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between py-3 ${muted ? "text-ink-2" : ""}`}
    >
      <dt>{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
