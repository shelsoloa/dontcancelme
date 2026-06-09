import Link from "next/link";

export type CardItem = {
  href: string;
  title: string;
  subtitle?: string;
  status?: string;
  date?: string | null;
  /** Small pill labels rendered under the subtitle (e.g. audit categories). */
  badges?: string[];
};

const STATUS_STYLES: Record<string, string> = {
  queued: "bg-low-soft text-low",
  running: "bg-primary-soft text-primary",
  completed: "bg-clear-soft text-clear",
  failed: "bg-crit-soft text-crit",
  canceled: "bg-surface-2 text-ink-3",
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

/** An audit's display name is its creation date + time, e.g. "Audit Jun 7, 2026, 3:42 PM". */
export function auditName(createdAt?: string | null) {
  if (!createdAt) return "Audit";
  return `Audit ${new Date(createdAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })}`;
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
            className="flex items-start justify-between gap-4 rounded-xl border border-line px-5 py-4 transition-colors hover:bg-surface-2"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{item.title}</p>
              {item.subtitle && (
                <p className="truncate text-sm text-ink-2">{item.subtitle}</p>
              )}
              {item.badges && item.badges.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {item.badges.map((label) => (
                    <span
                      key={label}
                      className="inline-flex items-center rounded-full border border-line px-2.5 py-0.5 text-xs text-ink-2"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {item.status && <StatusBadge status={item.status} />}
              {item.date && (
                <span className="text-xs text-ink-3">{formatDate(item.date)}</span>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
