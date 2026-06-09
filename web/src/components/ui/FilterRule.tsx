/**
 * FilterRule — read-only display of a detection rule.
 *
 * Matches spec `.rule` (lines 241–244):
 *   when {token} {op} {value} → {outcome}
 *
 * Tokens (field/key) rendered as mono chips in bg-surface-2.
 * Operators in muted mono uppercase text.
 * Value in text-primary (brand accent).
 * Outcome is always a severity label or descriptive phrase, never "auto-delete".
 */

interface Part {
  type: "op" | "token" | "value" | "outcome";
  text: string;
}

interface FilterRuleProps {
  parts: Part[];
  className?: string;
}

export function FilterRule({ parts, className = "" }: FilterRuleProps) {
  return (
    <div
      className={[
        "flex flex-wrap items-center gap-[10px]",
        "rounded-lg border border-line bg-surface px-4 py-[14px]",
        "text-sm",
        className,
      ].join(" ")}
    >
      {parts.map((p, i) => {
        if (p.type === "op") {
          return (
            <span
              key={i}
              className="font-mono text-[12px] uppercase tracking-[0.08em] text-ink-3"
            >
              {p.text}
            </span>
          );
        }
        if (p.type === "value") {
          return (
            <span key={i} className="font-semibold text-primary">
              {p.text}
            </span>
          );
        }
        if (p.type === "outcome") {
          return (
            <span
              key={i}
              className="rounded-[8px] border border-line bg-surface-2 px-[10px] py-[5px] font-mono text-[12.5px] text-ink"
            >
              {p.text}
            </span>
          );
        }
        // token
        return (
          <span
            key={i}
            className="rounded-[8px] border border-line bg-surface-2 px-[10px] py-[5px] font-mono text-[12.5px] text-ink"
          >
            {p.text}
          </span>
        );
      })}
    </div>
  );
}
