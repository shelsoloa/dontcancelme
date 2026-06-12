/**
 * /design — FLOODLIGHT design system showcase
 *
 * Public route (not under /portal). Renders the full component library and
 * scan-results dashboard composition. Toggle light/dark with the ThemeToggle
 * in the header and compare against design/design-language.html.
 *
 * All sample data is static/fictional. No real post data is used.
 */

import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FilterRule } from "@/components/ui/FilterRule";
import { Input } from "@/components/ui/Input";
import { RiskCard } from "@/components/ui/RiskCard";
import { StatStrip } from "@/components/ui/StatStrip";
import type { DesignSeverity } from "@/lib/audit/severity";

// ── Sample data ──────────────────────────────────────────────────────────────

const SAMPLE_CARDS = [
  {
    name: "you",
    handle: "yourhandle",
    date: "2014",
    body: "[post hidden — flagged for slur]",
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
    body: "hot take that did NOT age well…",
    severity: "high" as DesignSeverity,
    reasons: [
      { label: "Insensitive", severity: "high" as DesignSeverity },
      { label: "Aged take", severity: "low" as DesignSeverity },
    ],
    redacted: false,
    href: "#",
  },
  {
    name: "you",
    handle: "yourhandle",
    date: "2019",
    body: "ok but pineapple on pizza is a war crime and i will not be apologizing 🍍",
    severity: "med" as DesignSeverity,
    reasons: [
      { label: "Insensitive", severity: "med" as DesignSeverity },
      { label: "Aged take", severity: "low" as DesignSeverity },
    ],
    redacted: false,
    href: "#",
  },
];

// ── Components ───────────────────────────────────────────────────────────────

/** Section wrapper matching spec section layout. */
function Section({
  num,
  kicker,
  title,
  sub,
  children,
}: {
  num: string;
  kicker: string;
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-line py-[84px] first:border-t-0">
      <div className="mb-10 flex items-baseline gap-[18px]">
        <span className="shrink-0 pt-1 font-mono text-[13px] uppercase tracking-[0.05em] text-ink-3">
          {num}
        </span>
        <div>
          <p className="font-mono text-[12px] uppercase tracking-[0.18em] text-primary">
            {kicker}
          </p>
          <h2 className="mt-1 text-[clamp(28px,4vw,44px)] font-bold leading-[1.0] tracking-[-0.02em]">
            {title}
          </h2>
          {sub && (
            <p className="mt-[14px] max-w-[62ch] text-[16px] text-ink-2">
              {sub}
            </p>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

/** Severity rail: five colored fills (matches spec .sev-rail). */
function SeverityRail() {
  const segs: {
    ds: DesignSeverity;
    label: string;
    word: string;
    fillVar: string;
  }[] = [
    { ds: "clear", label: "00 · Clear", word: "Safe", fillVar: "var(--clear)" },
    { ds: "low", label: "01 · Low", word: "Watch", fillVar: "var(--low)" },
    { ds: "med", label: "02 · Medium", word: "Review", fillVar: "var(--med)" },
    { ds: "high", label: "03 · High", word: "Risky", fillVar: "var(--high)" },
    {
      ds: "crit",
      label: "04 · Critical",
      word: "Pull it",
      fillVar: "var(--crit)",
    },
  ];
  return (
    <div className="flex overflow-hidden rounded-xl border border-line">
      {segs.map((s) => (
        <div
          key={s.ds}
          className="flex-1 px-4 py-[18px]"
          style={{ background: s.fillVar }}
        >
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-white opacity-90 dark:[color:inherit]">
            <span
              className={
                // dark mode: clear/low/med/high get dark text; crit stays white
                s.ds === "crit"
                  ? "text-white"
                  : "text-white dark:text-[#0A0A0B]"
              }
            >
              {s.label}
            </span>
          </div>
          <div
            className={`mt-1 text-[26px] font-bold leading-none ${
              s.ds === "crit" ? "text-white" : "text-white dark:text-[#0A0A0B]"
            }`}
          >
            {s.word}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function DesignPage() {
  return (
    <div className="min-h-screen bg-bg text-ink">
      {/* Sticky top bar */}
      <header
        className="sticky top-0 z-50 border-b border-line"
        style={{
          background: "color-mix(in srgb, var(--bg) 82%, transparent)",
          backdropFilter: "saturate(1.4) blur(14px)",
        }}
      >
        <div className="mx-auto flex max-w-[1120px] items-center justify-between gap-5 px-10 py-[14px]">
          {/* Brandmark */}
          <div className="flex items-center gap-[10px] text-[18px] font-bold tracking-[-0.02em]">
            <span
              className="h-[10px] w-[10px] rounded-full bg-primary"
              aria-hidden="true"
            />
            dontcancel<span className="text-primary">.me</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-[12px] text-ink-3 sm:block font-mono uppercase tracking-widest">
              Design Language v0.1
            </span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="mx-auto max-w-[1120px] px-10">
        {/* ══ 00 Severity ══ */}
        <Section
          num="00"
          kicker="The risk scale"
          title="Five levels. One language."
          sub="The spine of the product. Every flagged post gets a level — the same five colors appear on badges, meters, the dashboard, and rule outcomes."
        >
          <SeverityRail />
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {(["clear", "low", "med", "high", "crit"] as DesignSeverity[]).map(
              (ds) => (
                <Badge key={ds} severity={ds} />
              ),
            )}
          </div>
        </Section>

        {/* ══ 01 Components ══ */}
        <Section num="01" kicker="Components" title="Building blocks.">
          {/* Buttons */}
          <p className="mb-[14px] font-mono text-[11px] uppercase tracking-[0.1em] text-ink-3">
            Buttons
          </p>
          <div className="mb-10 flex flex-wrap items-center gap-3">
            <Button variant="primary">Protect my account</Button>
            <Button variant="secondary">Run a scan</Button>
            <Button variant="danger">Delete 3 posts (danger variant)</Button>
            <Button variant="ghost">Keep anyway</Button>
          </div>

          {/* Inputs + Switch */}
          <div className="mb-10 grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="flex flex-col gap-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-3">
                Inputs
              </p>
              <Input
                label="Search your posts"
                placeholder="e.g. keyword, @handle, date…"
              />
              <SwitchDemo />
            </div>
            <div>
              <p className="mb-[14px] font-mono text-[11px] uppercase tracking-[0.1em] text-ink-3">
                Badges &amp; chips
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge severity="crit">NSFW</Badge>
                <Badge severity="crit">Slur</Badge>
                <Badge severity="high">Violence</Badge>
                <Badge severity="high">Insensitive</Badge>
                <Badge severity="med">Profanity</Badge>
                <Badge severity="low">Aged take</Badge>
                <Badge severity="clear">Cleared</Badge>
              </div>
            </div>
          </div>

          {/* Risk cards */}
          <p className="mb-[14px] font-mono text-[11px] uppercase tracking-[0.1em] text-ink-3">
            Risk card · the core unit
          </p>
          <div className="mb-10 grid grid-cols-1 gap-[18px] sm:grid-cols-2">
            <RiskCard
              name="you"
              handle="yourhandle"
              date="2019"
              body="ok but pineapple on pizza is a war crime and i will not be apologizing 🍍"
              severity="med"
              reasons={[
                { label: "Insensitive", severity: "med" },
                { label: "Aged take", severity: "low" },
              ]}
              href="#"
            />
            <RiskCard
              name="you"
              handle="yourhandle"
              date="2014"
              body="[content hidden]"
              severity="crit"
              reasons={[
                { label: "Slur", severity: "crit" },
                { label: "Hate speech", severity: "crit" },
              ]}
              redacted
              redactReason="slur"
              href="#"
            />
          </div>

          {/* Filter rules */}
          <p className="mb-[14px] font-mono text-[11px] uppercase tracking-[0.1em] text-ink-3">
            Filter rules
          </p>
          <div className="flex flex-col gap-3">
            <FilterRule
              parts={[
                { type: "op", text: "When" },
                { type: "token", text: "post.category" },
                { type: "op", text: "is" },
                { type: "value", text: "Slur · Hate · Doxxing" },
                { type: "op", text: "→" },
                { type: "outcome", text: "Critical — flag for review" },
              ]}
            />
            <FilterRule
              parts={[
                { type: "op", text: "When" },
                { type: "token", text: "risk.severity" },
                { type: "op", text: "≥" },
                { type: "value", text: "High" },
                { type: "op", text: "and" },
                { type: "token", text: "post.age" },
                { type: "op", text: ">" },
                { type: "value", text: "2 yrs" },
                { type: "op", text: "→" },
                { type: "outcome", text: "flag for review" },
              ]}
            />
          </div>
        </Section>

        {/* ══ 02 Dashboard composition ══ */}
        <Section
          num="02"
          kicker="Putting it together"
          title="Scan results dashboard."
          sub="A calm stat strip up top, then a card grid sorted by severity. Color does the triage; the user stays in control."
        >
          {/* Browser mock chrome */}
          <div className="overflow-hidden rounded-xl border border-line-strong bg-bg shadow-card">
            {/* Mock browser bar */}
            <div className="flex items-center gap-[10px] border-b border-line bg-surface px-[18px] py-[13px]">
              <div className="flex gap-[6px]">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="block h-[11px] w-[11px] rounded-full bg-line-strong"
                  />
                ))}
              </div>
              <span className="mx-auto max-w-[260px] flex-1 rounded-full bg-surface-2 px-3 py-[5px] text-center font-mono text-[12px] text-ink-3">
                dontcancel.me/portal/jobs/…
              </span>
            </div>

            {/* Dashboard content */}
            <div className="p-[22px]">
              <div className="mb-[18px] flex items-center justify-between">
                <h3 className="text-[22px] font-bold tracking-[-0.02em]">
                  We scanned 4,182 posts.{" "}
                  <span className="text-primary">12 need a look.</span>
                </h3>
              </div>

              <StatStrip
                className="mb-[18px]"
                stats={[
                  { count: 3, label: "Critical", severity: "crit" },
                  { count: 4, label: "High", severity: "high" },
                  { count: 5, label: "Medium", severity: "med" },
                  { count: 4170, label: "Clear ✓", severity: "clear" },
                ]}
              />

              <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 lg:grid-cols-3">
                {SAMPLE_CARDS.map((c, i) => (
                  <RiskCard key={i} {...c} />
                ))}
              </div>
            </div>
          </div>
        </Section>
      </div>

      <footer className="border-t border-line py-[60px] text-center font-mono text-[12.5px] text-ink-3">
        dontcancel.me · Design Language v0.1 · Floodlight — flip the toggle to
        compare.
      </footer>
    </div>
  );
}

/** Client wrapper for the Switch demo (needs useState in a Server Component page). */
function SwitchDemo() {
  // We can't use useState in an RSC — import a client wrapper.
  // Defined at module scope to keep the page a Server Component.
  return <SwitchDemoClient />;
}

// Tiny client component for the demo switch only
import { SwitchDemoClient } from "./SwitchDemoClient";
