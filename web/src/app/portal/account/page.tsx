import { createClient } from "@/lib/supabase/server";
import { FREE_TWEET_LIMIT } from "@/lib/billing";
import { TopUpButton } from "@/components/TopUpButton";

export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: credits } = user
    ? await supabase
        .from("user_credits")
        .select("free_used, balance")
        .eq("user_id", user.id)
        .maybeSingle()
    : { data: null };

  const freeUsed = credits?.free_used ?? 0;
  const balance = credits?.balance ?? 0;
  const freeRemaining = Math.max(0, FREE_TWEET_LIMIT - freeUsed);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Account</h1>

      <section className="mt-6">
        <h2 className="text-sm font-medium text-ink-2">Credits</h2>
        <dl className="mt-3 divide-y divide-line rounded-xl border border-line">
          <div className="flex items-center justify-between px-5 py-3">
            <dt className="text-sm text-ink-2">Free Tier</dt>
            <dd className="text-sm tabular-nums">
              {freeRemaining.toLocaleString()} / {FREE_TWEET_LIMIT.toLocaleString()}
            </dd>
          </div>
          <div className="flex items-center justify-between px-5 py-3">
            <dt className="text-sm text-ink-2">Balance</dt>
            <dd className="text-sm tabular-nums">{balance.toLocaleString()}</dd>
          </div>
          <div className="px-5 py-4">
            <TopUpButton />
          </div>
        </dl>
        <p className="mt-2 text-xs text-ink-3">
          1 credit = 1 post analyzed · $1 / 100 credits
        </p>
      </section>
    </main>
  );
}
