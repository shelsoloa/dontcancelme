"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "./ui/Button";

const DEV_LOGIN = process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN === "true";

/**
 * X login/signup widget (+ env-gated dev login for local testing). Shared by the
 * `/login` page and the `/start` audit gate.
 *
 * - `next`: where to land after auth (default `/portal/scans`). For X this is the
 *   `?next=` on the auth callback; for dev login it's a client redirect unless
 *   `onDevSignedIn` is provided.
 * - `onBeforeOAuth`: run right before the X redirect (e.g. stash pending state).
 * - `onDevSignedIn`: run after a successful dev sign-in instead of redirecting.
 */
export function AuthPanel({
  next = "/portal/scans",
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
        scopes: "users.read tweet.read like.read offline.access",
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
    "w-full rounded-lg border border-line-strong bg-transparent px-3 py-2 text-sm outline-none focus:border-primary";

  return (
    <div className={`rounded-xl border border-line p-5 ${className}`}>
      <Button
        variant="primary"
        onClick={handleX}
        disabled={submitting}
        className="inline-flex h-11 w-full items-center justify-center rounded-full bg-primary px-6 text-sm font-medium text-primary-ink transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        Continue with X
      </Button>

      {error && <p className="mt-3 text-sm text-crit">{error}</p>}

      {DEV_LOGIN && (
        <form
          onSubmit={handleDevAuth}
          className="mt-5 space-y-3 border-t border-line pt-5"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-ink-3">
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
          <Button
            variant="secondary"
            type="submit"
            disabled={submitting}
            className="inline-flex h-10 w-full items-center justify-center rounded-full border border-line-strong px-6 text-sm font-medium transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            {submitting ? "Signing in…" : "Sign in / sign up"}
          </Button>
        </form>
      )}
    </div>
  );
}
