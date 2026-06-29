"use client";

import { useState } from "react";
import {
  RiskCategory,
  RISK_LABELS,
  AUDIT_SOURCE_LABELS,
  type AuditSource,
} from "@/lib/audit/types";
import type { StartAuditInput } from "@/app/start/actions";

const ALL_CATEGORIES = Object.values(RiskCategory);

// Default source selection: own text + reposts on; images and likes off.
const DEFAULT_SOURCES: AuditSource[] = ["own_text", "reposts"];

export type JobFormInitial = {
  sources?: AuditSource[];
  categories?: RiskCategory[];
  likesCap?: string;
};

/**
 * Self-contained audit-intake form: demographics + risk-category picker + source
 * selector. Manages its own field state and validation, then hands a validated
 * payload to {@link onSubmit}. The caller decides what to do next (queue the job,
 * or gate on auth first).
 */
export function JobCreationForm({
  initial,
  submitting = false,
  submitLabel = "Get quote",
  error,
  onSubmit,
}: {
  initial?: JobFormInitial;
  submitting?: boolean;
  submitLabel?: string;
  error?: string | null;
  onSubmit: (payload: StartAuditInput) => void;
}) {
  const [sources, setSources] = useState<AuditSource[]>(
    initial?.sources ?? DEFAULT_SOURCES,
  );
  const [likesCap, setLikesCap] = useState(initial?.likesCap ?? "");
  const [categories, setCategories] = useState<RiskCategory[]>(
    initial?.categories ?? [...ALL_CATEGORIES],
  );
  const [limitRaw, setLimitRaw] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const allSelected = categories.length === ALL_CATEGORIES.length;
  const likesEnabled = sources.includes("likes");

  function toggleAll() {
    setCategories(allSelected ? [] : [...ALL_CATEGORIES]);
  }

  function toggleCategory(c: RiskCategory) {
    setCategories((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );
  }

  function toggleSource(s: AuditSource) {
    setSources((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  }

  function buildPayload(): StartAuditInput | null {
    setLocalError(null);

    if (sources.length === 0) {
      setLocalError("Select at least one thing to audit.");
      return null;
    }
    if (categories.length === 0) {
      setLocalError("Select at least one category to audit.");
      return null;
    }

    let limit: number | undefined;
    if (limitRaw.trim() !== "") {
      limit = parseInt(limitRaw, 10);
      if (!Number.isInteger(limit) || limit < 1) {
        setLocalError("Post limit must be a positive whole number.");
        return null;
      }
    }

    let likesCapped: number | undefined;
    if (sources.includes("likes")) {
      likesCapped = parseInt(likesCap, 10);
      if (!Number.isInteger(likesCapped) || likesCapped < 1) {
        setLocalError("Enter how many liked posts to process (must be ≥ 1).");
        return null;
      }
    }

    return {
      sources,
      categories,
      limit,
      likesCap: likesCapped,
    };
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = buildPayload();
    if (payload) onSubmit(payload);
  }

  const shownError = localError ?? error ?? null;
  const field =
    "w-full rounded-lg border border-line-strong bg-transparent px-3 py-2 text-sm outline-none focus:border-primary";

  return (
    <form onSubmit={handleSubmit} className="mt-8 space-y-6">
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-ink-2">
          What should we audit?
        </legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {/* own_text */}
          <label className="flex items-start gap-3 rounded-lg border border-line px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={sources.includes("own_text")}
              onChange={() => toggleSource("own_text")}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <div>
              <span className="font-medium">{AUDIT_SOURCE_LABELS.own_text}</span>
              <p className="text-xs text-ink-2">1¢ per post</p>
            </div>
          </label>

          {/* own_images */}
          <label className="flex items-start gap-3 rounded-lg border border-line px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={sources.includes("own_images")}
              onChange={() => toggleSource("own_images")}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <div>
              <span className="font-medium">{AUDIT_SOURCE_LABELS.own_images}</span>
              <p className="text-xs text-ink-2">4¢ per post · videos not supported</p>
            </div>
          </label>

          {/* reposts */}
          <label className="flex items-start gap-3 rounded-lg border border-line px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={sources.includes("reposts")}
              onChange={() => toggleSource("reposts")}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <div>
              <span className="font-medium">{AUDIT_SOURCE_LABELS.reposts}</span>
              <p className="text-xs text-ink-2">1¢ per post</p>
            </div>
          </label>

          {/* likes */}
          <label className="flex items-start gap-3 rounded-lg border border-line px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={sources.includes("likes")}
              onChange={() => toggleSource("likes")}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <div>
              <span className="font-medium">{AUDIT_SOURCE_LABELS.likes}</span>
              <p className="text-xs text-ink-2">
                Prepaid · processed until credits run out
              </p>
            </div>
          </label>
        </div>

        {/* likes cap — required when likes is selected */}
        {likesEnabled && (
          <label className="block">
            <span className="mb-1 block text-sm font-medium">
              Process most recent N liked posts
              <span className="ml-1 text-xs text-ink-2">(required)</span>
            </span>
            <input
              type="number"
              min={1}
              value={likesCap}
              onChange={(e) => setLikesCap(e.target.value)}
              placeholder="e.g. 500"
              className={field}
              required
            />
            <span className="mt-1 block text-xs text-ink-2">
              Processing stops if credits run out before reaching this limit.
              You can top up and resume.
            </span>
          </label>
        )}
      </fieldset>

      <details className="group">
        <summary className="cursor-pointer text-sm font-medium text-ink-2 select-none">
          Advanced settings
        </summary>

        <div className="mt-4 space-y-6">
          <fieldset className="space-y-3">
            <div className="flex items-center justify-between">
              <legend className="text-sm font-medium">
                What to scan for
              </legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="h-4 w-4"
                />
                {allSelected ? "Deselect all" : "Select all"}
              </label>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {ALL_CATEGORIES.map((c) => (
                <label
                  key={c}
                  className="flex items-center gap-3 rounded-lg border border-line px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={categories.includes(c)}
                    onChange={() => toggleCategory(c)}
                    className="h-4 w-4"
                  />
                  {RISK_LABELS[c]}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-sm">Max own posts to scan</span>
              <input
                type="number"
                min={1}
                value={limitRaw}
                onChange={(e) => setLimitRaw(e.target.value)}
                placeholder="No limit"
                className={field}
              />
              <span className="mt-1 block text-xs text-ink-2">
                Leave blank to scan all available posts (up to 3,200 per source).
                Does not apply to liked posts (use the N above).
              </span>
            </label>
          </fieldset>
        </div>
      </details>

      {shownError && <p className="text-sm text-crit">{shownError}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-6 text-sm font-medium text-primary-ink transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? "Setting up…" : submitLabel}
      </button>
    </form>
  );
}
