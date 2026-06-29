import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-6">
        {/* Brandmark */}
        <span className="text-sm font-semibold tracking-tight">
          dontcancel<span className="text-primary">.me</span>
        </span>

        {/* Links */}
        <nav className="flex flex-wrap items-center gap-5 text-xs text-ink-3">
          <Link href="/how-it-works" className="hover:text-ink transition-colors">
            How it works
          </Link>
          <Link href="/privacy" className="hover:text-ink transition-colors">
            Privacy Policy
          </Link>
          <Link href="/terms" className="hover:text-ink transition-colors">
            Terms of Use
          </Link>
          <a
            href="https://x.com/shelsoloa"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-ink transition-colors"
          >
            Made by @shelsoloa
          </a>
        </nav>
      </div>
    </footer>
  );
}
