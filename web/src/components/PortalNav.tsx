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
                ? "bg-surface-2 font-medium"
                : "text-ink-2 hover:bg-surface-2"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
