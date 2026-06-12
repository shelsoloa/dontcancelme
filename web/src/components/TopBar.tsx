import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Brandmark } from "./Brandmark";
import { Button } from "./ui/Button";

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
          <Button
            variant="secondary"
            className="inline-flex h-9 items-center justify-center rounded-full border border-line-strong px-4 font-medium transition-colors hover:bg-surface-2"
          >
            {user ? (
              <Link href="/portal/scans">Portal</Link>
            ) : (
              <Link href="/login">Login</Link>
            )}
          </Button>
        </nav>
      </div>
    </header>
  );
}
