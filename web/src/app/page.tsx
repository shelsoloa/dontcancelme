import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { RiskCard } from "@/components/ui/RiskCard";
import { StatStrip } from "@/components/ui/StatStrip";
import type { DesignSeverity } from "@/lib/audit/severity";

const PREVIEW_CARDS = [
  {
    name: "you",
    handle: "yourhandle",
    date: "2014",
    body: "[content hidden]",
    severity: "crit" as DesignSeverity,
    reasons: [
      { label: "Slur", severity: "crit" as DesignSeverity },
      { label: "Hate speech", severity: "crit" as DesignSeverity },
    ],
    redacted: true,
    redactReason: "slur",
    href: "#",
  },
  {
    name: "you",
    handle: "yourhandle",
    date: "2018",
    body: "some people deserve to be beaten",
    severity: "high" as DesignSeverity,
    reasons: [{ label: "Violence", severity: "high" as DesignSeverity }],
    href: "#",
  },
  {
    name: "you",
    handle: "yourhandle",
    date: "2019",
    body: "imagine being this ugly and still posting selfies 📸🤪",
    severity: "low" as DesignSeverity,
    reasons: [{ label: "Insensitive", severity: "low" as DesignSeverity }],
    href: "#",
  },
];

export default function Home() {
  return (
    <>
      <TopBar />
      <main className="flex flex-1 flex-col">
        {/* Hero */}
        <section className="mx-auto w-full max-w-5xl px-6 pb-16 pt-20 sm:pt-28">
          <h1 className="text-5xl font-bold leading-none tracking-tight sm:text-8xl">
            dontcancel<span className="text-primary">.me</span>
          </h1>
          <h2 className="mt-6 max-w-2xl text-xl font-semibold tracking-tight text-ink-2 sm:text-2xl">
            Find the posts that put you at risk <em>before</em> the internet
            does.
          </h2>
          <p className="mt-4 max-w-xl text-base text-ink-2">
            Scan your X account for personal info, credentials, hate speech, and
            other risky content — then decide what to clean up.
          </p>
          <div className="mt-10">
            <Link
              href="/start"
              className="inline-flex h-12 items-center justify-center rounded-full bg-primary px-8 text-base font-semibold text-primary-ink transition-opacity hover:opacity-90"
            >
              Clean it up now
            </Link>
          </div>
        </section>

        {/* Dashboard preview */}
        <section className="mx-auto w-full max-w-5xl px-6 pb-24">
          <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
            Here&apos;s what it finds
          </p>

          <div className="overflow-hidden rounded-xl border border-line bg-bg shadow-card">
            <div className="p-6 sm:p-8">
              <div className="mb-5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <h3 className="text-xl font-bold tracking-tight sm:text-2xl">
                  We scanned 4,182 posts.
                </h3>
                <span className="text-xl font-bold tracking-tight text-primary sm:text-2xl">
                  12 need a look.
                </span>
              </div>

              <StatStrip
                className="mb-6"
                stats={[
                  { count: 3, label: "Critical", severity: "crit" },
                  { count: 4, label: "High", severity: "high" },
                  { count: 5, label: "Medium", severity: "med" },
                  { count: 4170, label: "Clear ✓", severity: "clear" },
                ]}
              />

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {PREVIEW_CARDS.map((c, i) => (
                  <RiskCard key={i} {...c} />
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
