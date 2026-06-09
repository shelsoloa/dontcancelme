/**
 * FLOODLIGHT Input — label + text input.
 *
 * Matches spec `.field / .input` (lines 213–216):
 * - bg-surface, border-line-strong, rounded-lg (10px)
 * - focus: border-primary + 3px ring of --primary-soft
 */

import React from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  id?: string;
}

export function Input({ label, id, className = "", ...rest }: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="flex flex-col gap-[7px]">
      {label && (
        <label
          htmlFor={inputId}
          className="text-[13px] font-semibold leading-none"
        >
          {label}
        </label>
      )}
      <input
        id={inputId}
        {...rest}
        className={[
          "w-full rounded-lg border border-line-strong bg-surface px-[14px] py-[11px]",
          "text-sm text-ink placeholder:text-ink-3",
          "outline-none",
          "focus:border-primary focus:ring-[3px] focus:ring-primary-soft",
          "transition-shadow duration-150",
          className,
        ].join(" ")}
      />
    </div>
  );
}
