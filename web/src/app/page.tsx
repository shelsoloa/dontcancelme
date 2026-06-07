import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <div className="max-w-2xl">
        <p className="mb-4 text-sm font-medium uppercase tracking-widest text-zinc-500">
          Social media audit
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Find the posts that put you at risk.
        </h1>
        <p className="mt-6 text-lg text-zinc-600 dark:text-zinc-400">
          Scan your X account for personal info, credentials, and other
          sensitive content — then decide what to clean up.
        </p>
        <div className="mt-10">
          <Link
            href="/start"
            className="inline-flex h-12 items-center justify-center rounded-full bg-foreground px-8 text-base font-medium text-background transition-opacity hover:opacity-90"
          >
            Start now
          </Link>
        </div>
      </div>
    </main>
  );
}
