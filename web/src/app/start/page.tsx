"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  JobCreationForm,
  type JobFormInitial,
} from "@/components/JobCreationForm";
import { AuthPanel } from "@/components/AuthPanel";
import { startAudit, type StartAuditInput } from "./actions";

const PENDING_KEY = "pendingAudit";

export default function StartPage() {
  const router = useRouter();
  const finalizingRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [initial, setInitial] = useState<JobFormInitial | undefined>();
  const [pendingPayload, setPendingPayload] = useState<StartAuditInput | null>(
    null,
  );

  const [showAuth, setShowAuth] = useState(false);
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
          setInitial({
            age: profile.age != null ? String(profile.age) : "",
            gender: profile.gender ?? "",
            race: profile.race ?? "",
            orientation: profile.sexual_orientation ?? "",
            country: profile.country ?? "",
          });
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

  function handleSubmit(payload: StartAuditInput) {
    setError(null);
    if (userId) {
      finalize(payload);
    } else {
      setPendingPayload(payload);
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(payload));
      setShowAuth(true);
    }
  }

  if (!ready) {
    return (
      <main className="flex flex-1 items-center justify-center p-6 text-ink-2">
        Loading…
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Start an audit</h1>
      <p className="mt-2 text-sm text-ink-2">
        Tell us a bit about you so we can judge what counts as risky, then pick
        what to scan for.
      </p>

      <JobCreationForm
        initial={initial}
        submitting={submitting}
        error={error}
        onSubmit={handleSubmit}
      />

      {showAuth && !userId && pendingPayload && (
        <div className="mt-8">
          <h2 className="text-sm font-medium">Sign in to start your audit</h2>
          <p className="mt-1 text-xs text-ink-2">
            We need access to your X account to scan it.
          </p>
          <AuthPanel
            className="mt-4"
            next="/start"
            onBeforeOAuth={() =>
              sessionStorage.setItem(PENDING_KEY, JSON.stringify(pendingPayload))
            }
            onDevSignedIn={() => finalize(pendingPayload)}
          />
        </div>
      )}
    </main>
  );
}
