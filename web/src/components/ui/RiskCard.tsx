"use client";

/**
 * RiskCard — the core post-audit card unit.
 *
 * Matches spec `.riskcard` structure (lines 222–238):
 *   - Top row: avatar circle + name/handle/date + severity badge (top-right)
 *   - Body: post text OR redacted block (dashed/hatched) with Reveal toggle
 *   - Reason chips: flag category badges
 *   - Meter: bg-surface-2 track, severity-colored fill, "RISK · {word}" label
 *   - Actions: "View on X" link + optional "Dismiss"
 *
 * Product-truth adaptations (per CLAUDE.md "No deletion"):
 *   - Delete/auto-scrub actions are replaced with "View on X" + "Dismiss"
 *   - No 0-100 numeric score; meter fill width derived from DesignSeverity tier
 *   - Redacted-by-default for critical/NSFW/hate: Reveal is a display toggle only
 */

import { useState } from "react";
import {
  SEVERITY_FILL_CLASS,
  SEVERITY_METER_PCT,
  SEVERITY_WORD,
  type DesignSeverity,
} from "@/lib/audit/severity";
import { Badge } from "./Badge";
import type { AuditedPost } from "@/lib/audit/types";
import { DeleteTweetButton } from "@/components/DeleteTweetButton";

interface RiskReason {
  label: string;
  severity: DesignSeverity;
}

interface RiskCardProps {
  name: string;
  handle: string;
  /** Display date string, e.g. "2019" or "Mar 2018". */
  date: string;
  avatarUrl?: string;
  /** Post body text. */
  body: string;
  mediaUrls?: string[];
  severity: DesignSeverity;
  reasons: RiskReason[];
  /** If true, render the dashed redaction block instead of the post body. */
  redacted?: boolean;
  /** Short reason for the redaction block (e.g. "slur"). */
  redactReason?: string;
  /** Link out to the original post (X URL). */
  href?: string;
  onDismiss?: () => void;
  className?: string;
  /** Post data for the delete button. When absent, no delete button is shown. */
  onDelete?: { post: AuditedPost; onDeleted: () => void };
}

export function RiskCard({
  name,
  handle,
  date,
  avatarUrl,
  body,
  mediaUrls,
  severity,
  reasons,
  redacted = false,
  redactReason = "flagged content",
  href,
  onDismiss,
  onDelete,
  className = "",
}: RiskCardProps) {
  const [revealed, setReveal] = useState(false);
  const meterPct = SEVERITY_METER_PCT[severity];
  const fillClass = SEVERITY_FILL_CLASS[severity];

  return (
    <article
      className={[
        "flex flex-col overflow-hidden",
        "rounded-xl border border-line bg-surface",
        "shadow-card",
        className,
      ].join(" ")}
    >
      {/* ── Top row: avatar + identity + severity badge ── */}
      <div className="flex items-center gap-3 px-4 pt-4">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt={`@${handle}`}
            className="h-10 w-10 shrink-0 rounded-full border border-line object-cover"
          />
        ) : (
          <div className="h-10 w-10 shrink-0 rounded-full border border-line bg-surface-2" />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 leading-snug">
          <span className="truncate text-sm font-bold">{name}</span>
          <span className="font-mono text-[12.5px] text-ink-3">
            @{handle} · {date}
          </span>
        </div>
        <Badge severity={severity} className="ml-auto shrink-0" />
      </div>

      {/* ── Body or redacted block ── */}
      {redacted && !revealed ? (
        <div className="mx-4 mt-3">
          <div
            className={[
              "rounded-lg border border-dashed border-line-strong px-4 py-3",
              "font-mono text-[12.5px] text-ink-3",
              // diagonal hatch background matching spec
              "bg-[repeating-linear-gradient(45deg,transparent,transparent_8px,var(--surface-2)_8px,var(--surface-2)_9px)]",
            ].join(" ")}
          >
            <span className="mr-1 opacity-70">▍</span>
            post hidden — flagged for {redactReason}.{" "}
            <button
              onClick={() => setReveal(true)}
              className="ml-1 text-ink-2 underline underline-offset-2 hover:text-ink"
            >
              tap to reveal before reviewing.
            </button>
          </div>
        </div>
      ) : (
        <div className="px-4 pt-3 text-[15px] leading-[1.45] text-ink">
          {redacted && revealed && (
            <button
              onClick={() => setReveal(false)}
              className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-ink-3 hover:text-ink-2"
            >
              ▲ hide again
            </button>
          )}
          <p>{body}</p>
          {/* Media attachments */}
          {mediaUrls && mediaUrls.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {mediaUrls.map((src, i) => (
                <a
                  key={i}
                  href={src}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt={`Media ${i + 1}`}
                    loading="lazy"
                    className="h-40 max-w-xs rounded-lg border border-line object-cover"
                  />
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Reason chips ── */}
      {reasons.length > 0 && (
        <div className="flex flex-wrap gap-[7px] px-4 pt-3">
          {reasons.map((r, i) => (
            <Badge key={i} severity={r.severity}>
              {r.label}
            </Badge>
          ))}
        </div>
      )}

      {/* ── Risk meter ── */}
      <div className="px-4 pt-3 pb-1">
        <div className="mb-[7px] flex justify-between font-mono text-[11px] uppercase tracking-[0.04em] text-ink-3">
          <span>Risk</span>
          <span>{SEVERITY_WORD[severity]}</span>
        </div>
        <div className="h-[6px] overflow-hidden rounded-full bg-surface-2">
          <div
            className={`h-full rounded-full transition-all ${fillClass}`}
            style={{ width: `${meterPct}%` }}
          />
        </div>
      </div>

      {/* ── Actions ── */}
      <div className="mt-1 flex gap-2.5 border-t border-line px-4 py-3">
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={[
              "flex-1 inline-flex items-center justify-center gap-1.5",
              "rounded-lg px-[14px] py-[9px]",
              "text-sm font-semibold leading-none",
              "bg-primary text-primary-ink",
              "hover:brightness-110 transition-[filter] duration-150",
            ].join(" ")}
          >
            View on X ↗
          </a>
        )}
        {onDismiss && (
          <button
            onClick={onDismiss}
            className={[
              "flex-1 inline-flex items-center justify-center",
              "rounded-lg border border-line-strong px-[14px] py-[9px]",
              "text-sm font-semibold leading-none text-ink-2",
              "hover:bg-surface-2 transition-colors duration-150",
            ].join(" ")}
          >
            Dismiss
          </button>
        )}
        {onDelete && (
          <DeleteTweetButton
            post={onDelete.post}
            onDeleted={onDelete.onDeleted}
          />
        )}
      </div>
    </article>
  );
}
