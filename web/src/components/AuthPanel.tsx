"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const DEV_LOGIN = process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN === "true";

/**
 * X login/signup widget (+ env-gated dev login for local testing). Shared by the
 * `/login` page and the `/start` audit gate.
 *
 * - `next`: where to land after auth (default `/portal/jobs`). For X this is the
 *   `?next=` on the auth callback; for dev login it's a client redirect unless
 *   `onDevSignedIn` is provided.
 * - `onBeforeOAuth`: run right before the X redirect (e.g. stash pending state).
 * - `onDevSignedIn`: run after a successful dev sign-in instead of redirecting.
 */
export function AuthPanel({
  next = "/portal/jobs",
  onBeforeOAuth,
  onDevSignedIn,
  className = "",
}: {
  next?: string;
  onBeforeOAuth?: () => void;
  onDevSignedIn?: () => void | Promise<void>;
  className?: string;
}) {
  const router = useRouter();
  const [devEmail, setDevEmail] = useState("dev@example.com");
  const [devPassword, setDevPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleX() {
    setError(null);
    onBeforeOAuth?.();
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "x",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(
          next,
        )}`,
        scopes: "users.read tweet.read offline.access",
      },
    });
    if (error) setError(error.message);
  }

  async function handleDevAuth(e: React.FormEvent) {
    e.preventDefault();
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
    if (onDevSignedIn) {
      await onDevSignedIn();
    } else {
      router.push(next);
      router.refresh();
    }
  }

  const field =
    "w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

  return (
    <div
      className={`rounded-xl border border-zinc-200 p-5 dark:border-zinc-800 ${className}`}
    >
      <button
        onClick={handleX}
        disabled={submitting}
        className="inline-flex h-11 w-full items-center justify-center rounded-full bg-black px-6 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-black"
      >
        Continue with X
      </button>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

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
  );
}
