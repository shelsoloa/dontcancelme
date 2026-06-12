import { TopBar } from "@/components/TopBar";
import { Footer } from "@/components/Footer";

export const metadata = {
  title: "Privacy Policy — dontcancel.me",
};

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-10 text-lg font-bold tracking-tight first:mt-0">
      {children}
    </h2>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm leading-relaxed text-ink-2">{children}</p>;
}

export default function PrivacyPage() {
  return (
    <>
      <TopBar />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
          Last updated June 8, 2026
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">
          Privacy Policy
        </h1>

        <div className="mt-10 divide-y divide-line">
          {/* Short version */}
          <section className="pb-8">
            <H2>The short version</H2>
            <P>
              We store your email address so you can create an account and log
              back in. That&apos;s it. We won&apos;t email you, we don&apos;t
              sell your data, and we don&apos;t build a profile on you. Your
              posts stay in your browser — they&apos;re never saved on our
              servers.
            </P>
          </section>

          {/* What we store */}
          <section className="py-8">
            <H2>What we store</H2>
            <P>
              The only personal data we keep is your{" "}
              <strong>email address</strong>, held by our auth provider
              (Supabase) so you can sign in. If you connect via X (Twitter)
              OAuth instead, we store your X account identifier in the same way
              — no password is ever created or stored on our end.
            </P>
            <P>
              We also store a record of each scan job you run (when it started,
              how many posts were scanned, how many were flagged) so you can
              return to the results list. We do <strong>not</strong> store the
              content of your posts anywhere on our servers.
            </P>
          </section>

          {/* Tweets / posts */}
          <section className="py-8">
            <H2>Your posts &amp; tweets</H2>
            <P>
              When you run a scan, your posts are fetched from the X API and
              processed on our backend to detect risky content. They pass
              through our servers but are <strong>never saved there</strong>.
              The full scan results — every post, every flag — are written only
              to your browser&apos;s local storage on your device.
            </P>
            <P>
              This means if you clear your browser cache, your results are gone.
              We can&apos;t recover them because we never had them. That&apos;s
              intentional.
            </P>
          </section>

          {/* Payments */}
          <section className="py-8">
            <H2>Payments</H2>
            <P>
              Payments are processed by <strong>Stripe</strong>. Your card
              number, CVC, and billing details go directly to Stripe — we never
              see or store them. We receive a record of whether a payment
              succeeded and how many credits were purchased; nothing more.
            </P>
          </section>

          {/* Analytics */}
          <section className="py-8">
            <H2>Analytics</H2>
            <P>
              We use <strong>Vercel Analytics</strong> for basic, anonymous
              page-view counts and session duration. There is no Google
              Analytics on this site. Vercel Analytics does not track you across
              other sites, does not build ad profiles, and does not do any
              attribution or remarketing. It tells us roughly how many people
              visited a page — that&apos;s all.
            </P>
          </section>

          {/* Contact / changes */}
          <section className="pt-8">
            <H2>Contact &amp; changes</H2>
            <P>
              We won&apos;t contact you. If this policy changes, we&apos;ll
              update this page with a new date at the top. Continuing to use the
              service after a change means you&apos;ve accepted it.
            </P>
            <P>
              If you have questions, find <strong>@shelsoloa</strong> on X.
            </P>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
