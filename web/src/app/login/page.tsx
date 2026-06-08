import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthPanel } from "@/components/AuthPanel";

/** Standalone sign-in page. Already-authenticated users skip to the portal. */
export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/portal/jobs");

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <Link href="/" className="text-base font-semibold tracking-tight">
        SocialAuditor
      </Link>
      <div className="mt-8 w-full max-w-sm">
        <h1 className="text-center text-2xl font-semibold tracking-tight">
          Sign in
        </h1>
        <p className="mt-2 text-center text-sm text-zinc-600 dark:text-zinc-400">
          Connect your X account to start auditing.
        </p>
        <AuthPanel next="/portal/jobs" className="mt-6" />
      </div>
    </main>
  );
}
