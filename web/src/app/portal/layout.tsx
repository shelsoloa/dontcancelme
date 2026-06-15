import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/SignOutButton";
import { PortalNav } from "@/components/PortalNav";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Brandmark } from "@/components/Brandmark";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/start");

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Brandmark />
            <ThemeToggle />
          </div>
          <div className="flex items-center gap-4 text-sm text-ink-2">
            <span className="hidden sm:inline">
              {(user.user_metadata?.user_name as string) ?? user.email ?? "Account"}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1">
        <aside className="w-44 shrink-0 border-r border-line px-3 py-6">
          <PortalNav />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}
