"use client";

import { useState } from "react";
import {
  RiskCategory,
  RISK_LABELS,
  ALL_AUDIT_SOURCES,
  AUDIT_SOURCE_LABELS,
  type AuditSource,
} from "@/lib/audit/types";
import type { StartAuditInput } from "@/app/start/actions";

const GENDERS = ["Woman", "Man", "Non-binary", "Other", "Prefer not to say"];
const ALL_CATEGORIES = Object.values(RiskCategory);

export type JobFormInitial = {
  age?: string;
  gender?: string;
  race?: string;
  orientation?: string;
  country?: string;
  sources?: AuditSource[];
  categories?: RiskCategory[];
};

/**
 * Self-contained audit-intake form: demographics + a risk-category picker (with
 * a "select all" toggle). Manages its own field state and validation, then hands
 * a validated payload to {@link onSubmit}. The caller decides what to do next
 * (queue the job, or gate on auth first).
 */
export function JobCreationForm({
  initial,
  submitting = false,
  submitLabel = "Start audit",
  error,
  onSubmit,
}: {
  initial?: JobFormInitial;
  submitting?: boolean;
  submitLabel?: string;
  error?: string | null;
  onSubmit: (payload: StartAuditInput) => void;
}) {
  const [age, setAge] = useState(initial?.age ?? "");
  const [gender, setGender] = useState(initial?.gender ?? "");
  const [race, setRace] = useState(initial?.race ?? "");
  const [orientation, setOrientation] = useState(initial?.orientation ?? "");
  const [country, setCountry] = useState(initial?.country ?? "");
  const [sources, setSources] = useState<AuditSource[]>(
    initial?.sources ?? [...ALL_AUDIT_SOURCES],
  );
  const [categories, setCategories] = useState<RiskCategory[]>(
    initial?.categories ?? [],
  );
  const [limitRaw, setLimitRaw] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const allSelected = categories.length === ALL_CATEGORIES.length;

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
    const ageNum = parseInt(age, 10);
    if (!Number.isFinite(ageNum) || ageNum < 13 || ageNum > 120) {
      setLocalError("Enter an age between 13 and 120.");
      return null;
    }
    if (!gender) {
      setLocalError("Select a gender.");
      return null;
    }
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
    return {
      profile: {
        age: ageNum,
        gender,
        race: race || undefined,
        sexualOrientation: orientation || undefined,
        country: country || undefined,
      },
      sources,
      categories,
      limit,
    };
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = buildPayload();
    if (payload) onSubmit(payload);
  }

  const shownError = localError ?? error ?? null;
  const field =
    "w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

  return (
    <form onSubmit={handleSubmit} className="mt-8 space-y-6">
      <fieldset className="space-y-4">
        <legend className="text-sm font-medium text-zinc-500">About you</legend>
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="mb-1 block text-sm">Age</span>
            <input
              type="number"
              min={13}
              max={120}
              value={age}
              onChange={(e) => setAge(e.target.value)}
              className={field}
              required
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm">Gender</span>
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              className={field}
              required
            >
              <option value="">Select…</option>
              {GENDERS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-zinc-500">
          Optional — helps flag targeted risks.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-sm">Race</span>
            <input
              value={race}
              onChange={(e) => setRace(e.target.value)}
              className={field}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm">Sexual orientation</span>
            <input
              value={orientation}
              onChange={(e) => setOrientation(e.target.value)}
              className={field}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm">Country</span>
            <input
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className={field}
            />
          </label>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-zinc-500">
          What should we audit?
        </legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {ALL_AUDIT_SOURCES.map((s) => (
            <label
              key={s}
              className="flex items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
            >
              <input
                type="checkbox"
                checked={sources.includes(s)}
                onChange={() => toggleSource(s)}
                className="h-4 w-4"
              />
              {AUDIT_SOURCE_LABELS[s]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <div className="flex items-center justify-between">
          <legend className="text-sm font-medium text-zinc-500">
            What should we scan for?
          </legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="h-4 w-4"
            />
            Select all
          </label>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ALL_CATEGORIES.map((c) => (
            <label
              key={c}
              className="flex items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
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

      <details className="group">
        <summary className="cursor-pointer text-sm font-medium text-zinc-500 select-none">
          Advanced options
        </summary>
        <fieldset className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm">Number of posts to scan</span>
            <input
              type="number"
              min={1}
              value={limitRaw}
              onChange={(e) => setLimitRaw(e.target.value)}
              placeholder="No limit"
              className={field}
            />
            <span className="mt-1 block text-xs text-zinc-500">
              Leave blank to scan all available posts (up to 3,200 per source).
            </span>
          </label>
        </fieldset>
      </details>

      {shownError && <p className="text-sm text-red-600">{shownError}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex h-11 items-center justify-center rounded-full bg-foreground px-6 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? "Starting…" : submitLabel}
      </button>
    </form>
  );
}
