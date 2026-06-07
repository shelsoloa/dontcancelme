import Link from "next/link";

export type CardItem = {
  href: string;
  title: string;
  subtitle?: string;
  status?: string;
  date?: string | null;
};

const STATUS_STYLES: Record<string, string> = {
  queued: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  running: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  completed: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  canceled: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

export function StatusBadge({ status }: { status?: string }) {
  const cls = STATUS_STYLES[status ?? ""] ?? STATUS_STYLES.canceled;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${cls}`}
    >
      {status ?? "unknown"}
    </span>
  );
}

export function formatDate(date?: string | null) {
  if (!date) return "—";
  return new Date(date).toLocaleString();
}

export function CardList({
  items,
  className = "",
}: {
  items: CardItem[];
  className?: string;
}) {
  return (
    <ul className={`space-y-3 ${className}`}>
      {items.map((item) => (
        <li key={item.href}>
          <Link
            href={item.href}
            className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 px-5 py-4 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{item.title}</p>
              {item.subtitle && (
                <p className="truncate text-sm text-zinc-500">{item.subtitle}</p>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {item.status && <StatusBadge status={item.status} />}
              <span className="text-xs text-zinc-400">{formatDate(item.date)}</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
