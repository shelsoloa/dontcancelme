"use client";

import { useEffect, useState } from "react";

/**
 * Light/dark theme toggle. Flips `.dark` on <html> and persists the choice to
 * `localStorage`. The initial class is set before hydration by the anti-FOUC
 * script in layout.tsx, so this component reads from the DOM on mount rather
 * than from localStorage directly (avoids a hydration mismatch).
 */
export function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  // Subscribe to class changes so the icon stays in sync with external changes
  // (OS preference flip, other tabs). The observer fires synchronously for the
  // initial attributeFilter match, which also covers the anti-FOUC script read.
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setIsDark(root.classList.contains("dark"));
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributeFilter: ["class"] });
    // Manually trigger once to read whatever the anti-FOUC script set.
    observer.takeRecords(); // flush any queued records
    sync();
    return () => observer.disconnect();
  }, []);

  function toggle() {
    const next = !isDark;
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {}
    setIsDark(next);
  }

  return (
    <button
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-ink-3 transition-colors hover:border-line-strong hover:text-ink-2"
    >
      {isDark ? "☾" : "☀"}
    </button>
  );
}
