"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/portal/account", label: "Account" },
  { href: "/portal/jobs", label: "Jobs" },
  { href: "/portal/settings", label: "Settings" },
];

/** Portal sidebar navigation with active-route highlighting. */
export function PortalNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1 text-sm">
      {LINKS.map((l) => {
        const active =
          pathname === l.href || pathname.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded-lg px-3 py-2 transition-colors ${
              active
                ? "bg-zinc-100 font-medium dark:bg-zinc-900"
                : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-900"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
