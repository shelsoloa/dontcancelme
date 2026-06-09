"use client";

/**
 * FLOODLIGHT Toggle Switch — 46×26 pill, on-state bg-primary.
 *
 * Matches spec `.switch` (lines 217–220):
 * - 46px wide, 26px tall, pill border-radius
 * - off: bg-line-strong; on: bg-primary
 * - 20×20 white knob, 3px from edge, translates 20px on
 */

interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  id?: string;
}

export function Switch({ checked, onChange, label, id }: SwitchProps) {
  const switchId = id ?? "switch";
  return (
    <div className="flex items-center gap-3">
      <button
        id={switchId}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={[
          "relative h-[26px] w-[46px] shrink-0 cursor-pointer rounded-full",
          "border-none outline-none",
          "transition-colors duration-200",
          checked ? "bg-primary" : "bg-line-strong",
          // focus ring
          "focus-visible:ring-[3px] focus-visible:ring-primary-soft",
        ].join(" ")}
      >
        <span
          aria-hidden="true"
          className={[
            "absolute top-[3px] left-[3px]",
            "h-[20px] w-[20px] rounded-full bg-white",
            "shadow-[0_1px_3px_rgba(0,0,0,0.3)]",
            "transition-transform duration-200",
            checked ? "translate-x-[20px]" : "translate-x-0",
          ].join(" ")}
        />
      </button>
      {label && (
        <label htmlFor={switchId} className="cursor-pointer select-none text-sm">
          {label}
        </label>
      )}
    </div>
  );
}
