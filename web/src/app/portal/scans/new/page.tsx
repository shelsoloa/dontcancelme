import Link from "next/link";
import { PortalNewJob } from "@/components/PortalNewJob";

/**
 * New scan, from inside the portal. The proxy gates `/portal/*` behind auth.
 */
export default async function NewScanPage() {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-10">
      <Link href="/portal/scans" className="text-sm text-ink-2 hover:underline">
        ← Back to scans
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">New scan</h1>
      <p className="mt-2 text-sm text-ink-2">
        Pick what to scan for and set your options.
      </p>

      <PortalNewJob />
    </main>
  );
}
