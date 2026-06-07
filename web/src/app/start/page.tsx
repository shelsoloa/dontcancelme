"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { RiskCategory, RISK_LABELS } from "@/lib/audit/types";
import { startAudit, type StartAuditInput } from "./actions";

const PENDING_KEY = "pendingAudit";
const DEV_LOGIN = process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN === "true";

const GENDERS = ["Woman", "Man", "Non-binary", "Other", "Prefer not to say"];

export default function StartPage() {
  const router = useRouter();
  const finalizingRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [race, setRace] = useState("");
  const [orientation, setOrientation] = useState("");
  const [country, setCountry] = useState("");
  const [categories, setCategories] = useState<RiskCategory[]>([]);

  const [showAuth, setShowAuth] = useState(false);
  const [devEmail, setDevEmail] = useState("dev@example.com");
  const [devPassword, setDevPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On load: resolve session, prefill from profile, and finish a pending audit
  // if we just came back from an auth redirect.
  useEffect(() => {
    const supabase = createClient();
    (async () => {
      if (new URLSearchParams(window.location.search).get("error") === "auth") {
        setError("Sign-in failed. Please try again.");
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        setUserId(user.id);
        const { data: profile } = await supabase
          .from("profiles")
          .select("*")
          .eq("user_id", user.id)
          .maybeSingle();
        if (profile) {
          setAge(profile.age != null ? String(profile.age) : "");
          setGender(profile.gender ?? "");
          setRace(profile.race ?? "");
          setOrientation(profile.sexual_orientation ?? "");
          setCountry(profile.country ?? "");
        }
        const pending = sessionStorage.getItem(PENDING_KEY);
        if (pending) {
          try {
            await finalize(JSON.parse(pending) as StartAuditInput);
            return;
          } catch {
            sessionStorage.removeItem(PENDING_KEY);
          }
        }
      }
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleCategory(c: RiskCategory) {
    setCategories((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );
  }

  function buildPayload(): StartAuditInput | null {
    setError(null);
    const ageNum = parseInt(age, 10);
    if (!Number.isFinite(ageNum) || ageNum < 13 || ageNum > 120) {
      setError("Enter an age between 13 and 120.");
      return null;
    }
    if (!gender) {
      setError("Select a gender.");
      return null;
    }
    if (categories.length === 0) {
      setError("Select at least one category to audit.");
      return null;
    }
    return {
      profile: {
        age: ageNum,
        gender,
        race: race || undefined,
        sexualOrientation: orientation || undefined,
        country: country || undefined,
      },
      categories,
    };
  }

  async function finalize(payload: StartAuditInput) {
    if (finalizingRef.current) return;
    finalizingRef.current = true;
    setSubmitting(true);
    const result = await startAudit(payload);
    if ("jobId" in result) {
      sessionStorage.removeItem(PENDING_KEY);
      router.push(`/portal/jobs/${result.jobId}`);
    } else {
      finalizingRef.current = false;
      setSubmitting(false);
      setError(result.error);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = buildPayload();
    if (!payload) return;
    if (userId) {
      finalize(payload);
    } else {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(payload));
      setShowAuth(true);
    }
  }

  async function handleX() {
    const payload = buildPayload();
    if (payload) sessionStorage.setItem(PENDING_KEY, JSON.stringify(payload));
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "x",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/start`,
        scopes: "users.read tweet.read offline.access",
      },
    });
    if (error) setError(error.message);
  }

  async function handleDevAuth(e: React.FormEvent) {
    e.preventDefault();
    const payload = buildPayload();
    if (!payload) return;
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(payload));
    setError(null);
    setSubmitting(true);
    const supabase = createClient();
    const signIn = await supabase.auth.signInWithPassword({
      email: devEmail,
      password: devPassword,
    });
    if (signIn.error) {
      const signUp = await supabase.auth.signUp({
        email: devEmail,
        password: devPassword,
      });
      if (signUp.error) {
        setSubmitting(false);
        setError(signUp.error.message);
        return;
      }
    }
    await finalize(payload);
  }

  if (!ready) {
    return (
      <main className="flex flex-1 items-center justify-center p-6 text-zinc-500">
        Loading…
      </main>
    );
  }

  const field =
    "w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Start an audit</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Tell us a bit about you so we can judge what counts as risky, then pick
        what to scan for.
      </p>

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
          <p className="text-xs text-zinc-500">Optional — helps flag targeted risks.</p>
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
            What should we scan for?
          </legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {Object.values(RiskCategory).map((c) => (
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

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex h-11 items-center justify-center rounded-full bg-foreground px-6 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Starting…" : "Start audit"}
        </button>
      </form>

      {showAuth && !userId && (
        <div className="mt-8 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
          <h2 className="text-sm font-medium">Sign in to start your audit</h2>
          <p className="mt-1 text-xs text-zinc-500">
            We need access to your X account to scan it.
          </p>
          <button
            onClick={handleX}
            disabled={submitting}
            className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-full bg-black px-6 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-black"
          >
            Continue with X
          </button>

          {DEV_LOGIN && (
            <form
              onSubmit={handleDevAuth}
              className="mt-5 space-y-3 border-t border-zinc-200 pt-5 dark:border-zinc-800"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                Dev login (local only)
              </p>
              <input
                type="email"
                value={devEmail}
                onChange={(e) => setDevEmail(e.target.value)}
                placeholder="email"
                className={field}
                required
              />
              <input
                type="password"
                value={devPassword}
                onChange={(e) => setDevPassword(e.target.value)}
                placeholder="password (min 6 chars)"
                minLength={6}
                className={field}
                required
              />
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex h-10 w-full items-center justify-center rounded-full border border-zinc-300 px-6 text-sm font-medium transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                {submitting ? "Signing in…" : "Sign in / sign up"}
              </button>
            </form>
          )}
        </div>
      )}
    </main>
  );
}
