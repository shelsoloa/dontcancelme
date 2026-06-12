import { createClient } from "@/lib/supabase/server";

const PROVIDER_LABELS: Record<string, string> = {
  x: "X",
  email: "Email",
};

function providerLabel(provider?: string) {
  if (!provider) return "Unknown";
  return PROVIDER_LABELS[provider] ?? provider[0].toUpperCase() + provider.slice(1);
}

function StatusBadge({ status }: { status: string }) {
  if (status === "paid") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-low-soft px-2.5 py-0.5 text-xs font-medium text-low">
        <span className="h-1.5 w-1.5 rounded-full bg-low" />
        Cleared
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-med-soft px-2.5 py-0.5 text-xs font-medium text-med">
      <span className="h-1.5 w-1.5 rounded-full bg-med" />
      Processing
    </span>
  );
}

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const email = user?.email;
  const provider = user?.app_metadata?.provider;

  const [{ data: credits }, { data: purchases }] = await Promise.all([
    supabase
      .from("user_credits")
      .select("balance, free_used")
      .maybeSingle(),
    supabase
      .from("credit_purchases")
      .select("id, credits, status, created_at")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const balance = credits?.balance ?? 0;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Account</h1>

      {/* Account info */}
      <dl className="mt-6 divide-y divide-line rounded-xl border border-line">
        <div className="flex items-center justify-between px-5 py-3">
          <dt className="text-sm text-ink-2">
            {email ? "Email" : "Signed in with"}
          </dt>
          <dd className="text-sm">{email ?? providerLabel(provider)}</dd>
        </div>
      </dl>

      {/* Credits */}
      <h2 className="mt-10 text-lg font-semibold">Credits</h2>

      <div className="mt-3 rounded-xl border border-line px-5 py-4">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold tabular-nums">
            {balance.toLocaleString()}
          </span>
          <span className="text-sm text-ink-2">credits available</span>
        </div>
        <p className="mt-1 text-xs text-ink-2">
          Each liked text post costs 1 credit · image post costs 4 credits
        </p>
      </div>

      {/* Top-up history */}
      <h2 className="mt-8 text-lg font-semibold">Top-up history</h2>

      {!purchases || purchases.length === 0 ? (
        <p className="mt-3 text-sm text-ink-2">No top-ups yet.</p>
      ) : (
        <div className="mt-3 divide-y divide-line rounded-xl border border-line">
          {purchases.map((p) => (
            <div key={p.id} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="text-sm font-medium">{p.credits.toLocaleString()} credits</p>
                <p className="text-xs text-ink-2">
                  {new Date(p.created_at).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
              <StatusBadge status={p.status} />
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
