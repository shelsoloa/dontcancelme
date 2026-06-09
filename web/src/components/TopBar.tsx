import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Brandmark } from "./Brandmark";

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
    <header className="border-b border-line">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <Brandmark />
          <ThemeToggle />
        </div>
        <nav className="flex items-center gap-3 text-sm">
          {user ? (
            <Link
              href="/portal/jobs"
              className="inline-flex h-9 items-center justify-center rounded-full bg-primary px-4 font-medium text-primary-ink transition-opacity hover:opacity-90"
            >
              Portal
            </Link>
          ) : (
            <Link
              href="/login"
              className="inline-flex h-9 items-center justify-center rounded-full border border-line-strong px-4 font-medium transition-colors hover:bg-surface-2"
            >
              Login
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
