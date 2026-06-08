import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing-page top bar: app name on the left; a Portal button when signed in,
 * otherwise a Login button. (The portal has its own header.)
 */
export async function TopBar() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-base font-semibold tracking-tight">
          SocialAuditor
        </Link>
        <nav className="flex items-center gap-3 text-sm">
          {user ? (
            <Link
              href="/portal/jobs"
              className="inline-flex h-9 items-center justify-center rounded-full bg-foreground px-4 font-medium text-background transition-opacity hover:opacity-90"
            >
              Portal
            </Link>
          ) : (
            <Link
              href="/login"
              className="inline-flex h-9 items-center justify-center rounded-full border border-zinc-300 px-4 font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Login
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
