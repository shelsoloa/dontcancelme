/**
 * FLOODLIGHT Button — four variants matching the spec (spec `.btn*` lines 202–210).
 *
 * - primary:   bg-primary text-primary-ink
 * - secondary: bg-surface-2 border-line-strong text-ink
 * - danger:    bg-crit text-white  (ships in library; not wired to any delete action)
 * - ghost:     border-line-strong text-ink-2 bg-transparent
 *
 * radius: rounded-lg (→ 10px via token), weight 600, subtle press translateY(1px).
 */

import React from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-primary text-primary-ink border-transparent hover:brightness-110",
  secondary:
    "bg-surface-2 text-ink border border-line-strong hover:brightness-95 dark:hover:brightness-110",
  danger: "bg-crit text-white border-transparent hover:brightness-110",
  ghost:
    "bg-transparent text-ink-2 border border-line-strong hover:bg-surface-2",
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button({
  variant = "primary",
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      className={[
        "inline-flex items-center justify-center gap-2",
        "rounded-sm px-[18px] py-[11px]",
        "text-sm font-semibold leading-none",
        "border",
        "cursor-pointer select-none",
        "transition-[filter,transform] duration-150",
        "active:translate-y-px",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        VARIANT_CLASSES[variant],
        className,
      ].join(" ")}
    >
      {children}
    </button>
  );
}
