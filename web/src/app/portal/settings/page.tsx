import { createClient } from "@/lib/supabase/server";

const PROVIDER_LABELS: Record<string, string> = {
  x: "X",
  email: "Email",
};

function providerLabel(provider?: string) {
  if (!provider) return "Unknown";
  return PROVIDER_LABELS[provider] ?? provider[0].toUpperCase() + provider.slice(1);
}

/** Minimal account page: shows the email, or the sign-up provider (e.g. X). */
export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const email = user?.email;
  const provider = user?.app_metadata?.provider;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <dl className="mt-6 divide-y divide-line rounded-xl border border-line">
        <div className="flex items-center justify-between px-5 py-3">
          <dt className="text-sm text-ink-2">
            {email ? "Email" : "Signed in with"}
          </dt>
          <dd className="text-sm">{email ?? providerLabel(provider)}</dd>
        </div>
      </dl>
    </main>
  );
}
