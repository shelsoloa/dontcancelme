"use client";

import { useState } from "react";
import {
  RiskCategory,
  RISK_LABELS,
  AUDIT_SOURCE_LABELS,
  type AuditSource,
} from "@/lib/audit/types";
import type { StartAuditInput } from "@/app/start/actions";

const GENDERS = ["Woman", "Man", "Non-binary", "Other", "Prefer not to say"];
const RACES = [
  "White",
  "Black",
  "Asian",
  "Native",
  "Pacific Islander",
  "Other",
  "Prefer not to say",
];
const ORIENTATIONS = ["Heterosexual", "Homosexual", "Queer", "Other"];
const COUNTRIES = [
  "Afghanistan", "Albania", "Algeria", "Andorra", "Angola",
  "Antigua and Barbuda", "Argentina", "Armenia", "Australia", "Austria",
  "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh", "Barbados",
  "Belarus", "Belgium", "Belize", "Benin", "Bhutan",
  "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei",
  "Bulgaria", "Burkina Faso", "Burundi", "Cabo Verde", "Cambodia",
  "Cameroon", "Canada", "Central African Republic", "Chad", "Chile",
  "China", "Colombia", "Comoros", "Congo (Brazzaville)", "Congo (Kinshasa)",
  "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czech Republic",
  "Denmark", "Djibouti", "Dominica", "Dominican Republic", "Ecuador",
  "Egypt", "El Salvador", "Equatorial Guinea", "Eritrea", "Estonia",
  "Eswatini", "Ethiopia", "Fiji", "Finland", "France",
  "Gabon", "Gambia", "Georgia", "Germany", "Ghana",
  "Greece", "Grenada", "Guatemala", "Guinea", "Guinea-Bissau",
  "Guyana", "Haiti", "Honduras", "Hungary", "Iceland",
  "India", "Indonesia", "Iran", "Iraq", "Ireland",
  "Israel", "Italy", "Jamaica", "Japan", "Jordan",
  "Kazakhstan", "Kenya", "Kiribati", "Kuwait", "Kyrgyzstan",
  "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia",
  "Libya", "Liechtenstein", "Lithuania", "Luxembourg", "Madagascar",
  "Malawi", "Malaysia", "Maldives", "Mali", "Malta",
  "Marshall Islands", "Mauritania", "Mauritius", "Mexico", "Micronesia",
  "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco",
  "Mozambique", "Myanmar", "Namibia", "Nauru", "Nepal",
  "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria",
  "North Korea", "North Macedonia", "Norway", "Oman", "Pakistan",
  "Palau", "Palestine", "Panama", "Papua New Guinea", "Paraguay",
  "Peru", "Philippines", "Poland", "Portugal", "Qatar",
  "Romania", "Russia", "Rwanda", "Saint Kitts and Nevis", "Saint Lucia",
  "Saint Vincent and the Grenadines", "Samoa", "San Marino",
  "Sao Tome and Principe", "Saudi Arabia", "Senegal", "Serbia",
  "Seychelles", "Sierra Leone", "Singapore", "Slovakia", "Slovenia",
  "Solomon Islands", "Somalia", "South Africa", "South Korea",
  "South Sudan", "Spain", "Sri Lanka", "Sudan", "Suriname",
  "Sweden", "Switzerland", "Syria", "Taiwan", "Tajikistan",
  "Tanzania", "Thailand", "Timor-Leste", "Togo", "Tonga",
  "Trinidad and Tobago", "Tunisia", "Turkey", "Turkmenistan", "Tuvalu",
  "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom",
  "United States", "Uruguay", "Uzbekistan", "Vanuatu", "Venezuela",
  "Vietnam", "Yemen", "Zambia", "Zimbabwe",
];

const ALL_CATEGORIES = Object.values(RiskCategory);

// Default source selection: own text + reposts on; images and likes off.
const DEFAULT_SOURCES: AuditSource[] = ["own_text", "reposts"];

export type JobFormInitial = {
  age?: string;
  gender?: string;
  race?: string[];
  orientation?: string;
  country?: string;
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
  const [age, setAge] = useState(initial?.age ?? "");
  const [gender, setGender] = useState(initial?.gender ?? "");
  const [races, setRaces] = useState<string[]>(initial?.race ?? []);
  const [orientation, setOrientation] = useState(initial?.orientation ?? "");
  const [country, setCountry] = useState(initial?.country ?? "");
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

  function toggleRace(r: string) {
    setRaces((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r],
    );
  }

  function buildPayload(): StartAuditInput | null {
    setLocalError(null);

    let ageNum: number | undefined;
    if (age.trim() !== "") {
      ageNum = parseInt(age, 10);
      if (!Number.isFinite(ageNum) || ageNum < 18 || ageNum > 120) {
        setLocalError("Enter an age between 18 and 120.");
        return null;
      }
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

    let likesCapped: number | undefined;
    if (sources.includes("likes")) {
      likesCapped = parseInt(likesCap, 10);
      if (!Number.isInteger(likesCapped) || likesCapped < 1) {
        setLocalError("Enter how many liked posts to process (must be ≥ 1).");
        return null;
      }
    }

    return {
      profile: {
        age: ageNum,
        gender: gender || undefined,
        race: races.length > 0 ? races.join(", ") : undefined,
        sexualOrientation: orientation || undefined,
        country: country || undefined,
      },
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
      <fieldset className="space-y-4">
        <legend className="text-sm font-medium text-ink-2">About you</legend>
        <p className="text-xs text-ink-2">
          All optional — helps contextualize what counts as risky for you.
        </p>

        {/* Age + Gender */}
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="mb-1 block text-sm">Age</span>
            <input
              type="number"
              min={18}
              max={120}
              value={age}
              onChange={(e) => setAge(e.target.value)}
              className={field}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm">Gender</span>
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              className={field}
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

        {/* Race — multi-select */}
        <div>
          <span className="mb-2 block text-sm">
            Race
            <span className="ml-1 text-xs text-ink-2">· select all that apply</span>
          </span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {RACES.map((r) => (
              <label
                key={r}
                className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={races.includes(r)}
                  onChange={() => toggleRace(r)}
                  className="h-4 w-4 shrink-0"
                />
                {r}
              </label>
            ))}
          </div>
        </div>

        {/* Sexual orientation + Country */}
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="mb-1 block text-sm">Sexual orientation</span>
            <select
              value={orientation}
              onChange={(e) => setOrientation(e.target.value)}
              className={field}
            >
              <option value="">Select…</option>
              {ORIENTATIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm">Country</span>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className={field}
            >
              <option value="">Select…</option>
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>

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
