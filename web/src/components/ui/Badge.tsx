/**
 * Severity badge / pill.
 *
 * Matches spec `.badge` — pill shape, Space Mono ~12px, 7px colored dot,
 * soft-tint background + text, and in light mode a faint 22%-opacity border
 * derived from `currentColor` (dark mode: no border).
 */

import {
  SEVERITY_BADGE_CLASS,
  SEVERITY_LABEL,
  type DesignSeverity,
} from "@/lib/audit/severity";

interface BadgeProps {
  severity: DesignSeverity;
  /** Override the default severity label (e.g. a category name like "NSFW"). */
  children?: React.ReactNode;
  className?: string;
}

export function Badge({ severity, children, className = "" }: BadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center gap-[7px]",
        "font-mono text-[12px] font-medium leading-none tracking-[0.02em]",
        "px-[11px] py-[5px] rounded-full",
        // light: faint border derived from currentColor; dark: no border
        "border border-[color-mix(in_srgb,currentColor_22%,transparent)] dark:border-transparent",
        SEVERITY_BADGE_CLASS[severity],
        className,
      ].join(" ")}
    >
      {/* 7px dot */}
      <span
        aria-hidden="true"
        className={`inline-block h-[7px] w-[7px] shrink-0 rounded-full bg-current`}
      />
      {children ?? SEVERITY_LABEL[severity]}
    </span>
  );
}
