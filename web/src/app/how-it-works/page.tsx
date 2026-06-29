import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { Footer } from "@/components/Footer";

export const metadata = {
  title: "How it works — dontcancel.me",
};

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-2 text-xl font-bold tracking-tight">{children}</h2>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm leading-relaxed text-ink-2">{children}</p>;
}

export default function HowItWorksPage() {
  return (
    <>
      <TopBar />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
          Three steps
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">
          How it works
        </h1>

        <div className="mt-10 flex flex-col gap-6">
          {/* Step 1 */}
          <div className="rounded-xl border border-line bg-surface p-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
              Step 1
            </p>
            <H2>Scan your X history</H2>
            <P>
              Connect your X account and we scan your entire post history —
              tweets, reposts, and liked posts — using a two-phase AI moderation
              pipeline.
            </P>
          </div>

          {/* Step 2 */}
          <div className="rounded-xl border border-line bg-surface p-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
              Step 2
            </p>
            <H2>Review what we find</H2>
            <P>
              Flagged posts are surfaced by risk category and severity (Critical,
              High, Medium, Low). You decide what stays and what goes.
            </P>
          </div>

          {/* Step 3 */}
          <div className="rounded-xl border border-line bg-surface p-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
              Step 3
            </p>
            <H2>Delete in one click</H2>
            <P>
              Remove risky posts directly via the X API. No copy-pasting, no
              opening each tweet manually. One click and it&apos;s gone.
            </P>
          </div>
        </div>

        {/* Privacy note */}
        <p className="mt-10 text-xs leading-relaxed text-ink-3">
          Your tweet text never leaves your browser. We store only a
          cryptographic hash to avoid re-scanning posts we&apos;ve already
          checked. First 100 posts free.
        </p>

        {/* CTA */}
        <div className="mt-10">
          <Link
            href="/start"
            className="inline-flex h-12 items-center justify-center rounded-full bg-primary px-8 text-base font-semibold text-primary-ink transition-opacity hover:opacity-90"
          >
            Clean it up now →
          </Link>
        </div>
      </main>
      <Footer />
    </>
  );
}
