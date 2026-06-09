import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/Button";

export default function Home() {
  return (
    <>
      <TopBar />
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-24">
        <div className="max-w-3xl relative">
          <h1 className="text-4xl font-bold sm:text-8xl">
            dontcancel<span className="text-primary">.me</span>
          </h1>
          <h2 className="mt-6 text-2xl font-semibold tracking-tight sm:text-3xl text-ink-2">
            Find the posts that put you at risk <i>before</i> the internet does.
          </h2>
          <p className="mt-4 text-lg text-ink-2">
            Scan your X account for personal info, credentials, and other
            sensitive content — then decide what to clean up.
          </p>
          <div className="mt-10 float-right">
            <Button
              className="inline-flex h-12 items-center justify-center rounded-full bg-primary px-8 text-base font-medium text-primary-ink transition-opacity hover:opacity-90"
              variant="primary"
            >
              <Link href="/start">Clean it up now</Link>
            </Button>
          </div>
        </div>
      </main>
    </>
  );
}
