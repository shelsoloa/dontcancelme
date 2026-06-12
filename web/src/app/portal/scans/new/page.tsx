import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PortalNewJob } from "@/components/PortalNewJob";
import type { JobFormInitial } from "@/components/JobCreationForm";

/**
 * New scan, from inside the portal. Prefills demographics from the user's saved
 * profile so they only pick categories. The proxy gates `/portal/*` behind auth.
 */
export default async function NewScanPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let initial: JobFormInitial | undefined;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    if (profile) {
      initial = {
        age: profile.age != null ? String(profile.age) : "",
        gender: profile.gender ?? "",
        race: profile.race
          ? profile.race
              .split(",")
              .map((s: string) => s.trim())
              .filter(Boolean)
          : [],
        orientation: profile.sexual_orientation ?? "",
        country: profile.country ?? "",
      };
    }
  }

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-10">
      <Link href="/portal/scans" className="text-sm text-ink-2 hover:underline">
        ← Back to scans
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">New scan</h1>
      <p className="mt-2 text-sm text-ink-2">
        Confirm your details and pick what to scan for.
      </p>

      <PortalNewJob initial={initial} />
    </main>
  );
}
