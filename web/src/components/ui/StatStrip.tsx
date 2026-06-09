/**
 * FLOODLIGHT StatStrip — horizontal row of severity stat tiles.
 *
 * Matches spec `.stat-strip / .stat` (lines 255–258):
 * - Each stat: bg-surface, border-line, rounded-lg (10px), padded 12/16
 * - Number: big display font weight-700, colored by severity
 * - Label: 12px, text-ink-3
 */

import { type DesignSeverity } from "@/lib/audit/severity";

// Tailwind class for the large display number (foreground color only)
const NUMBER_COLOR: Record<DesignSeverity, string> = {
  clear: "text-clear",
  low: "text-low",
  med: "text-med",
  high: "text-high",
  crit: "text-crit",
};

interface StatProps {
  count: number;
  label: string;
  severity: DesignSeverity;
}

export function Stat({ count, label, severity }: StatProps) {
  return (
    <div className="flex min-w-[110px] flex-1 flex-col gap-[5px] rounded-lg border border-line bg-surface px-4 py-3">
      <span
        className={`font-sans text-[26px] font-bold leading-none ${NUMBER_COLOR[severity]}`}
      >
        {count.toLocaleString()}
      </span>
      <span className="text-[12px] text-ink-3">{label}</span>
    </div>
  );
}

interface StatStripProps {
  stats: StatProps[];
  className?: string;
}

export function StatStrip({ stats, className = "" }: StatStripProps) {
  return (
    <div className={`flex flex-wrap gap-[10px] ${className}`}>
      {stats.map((s) => (
        <Stat key={s.label} {...s} />
      ))}
    </div>
  );
}

// Re-export the NUMBER_COLOR map in case callers want it
export { NUMBER_COLOR };
