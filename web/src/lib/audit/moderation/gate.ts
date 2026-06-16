import "server-only";
import wordlist from "./data/wordlist.json";
import type { GateHit } from "@/lib/audit/types";

type WordEntry = {
  term: string;
  severity: number | null;
  severityDesc: string | null;
  categories: string[];
};

export class ProfanityGate {
  private meta: Map<string, Omit<WordEntry, "term">>;
  private pattern: RegExp;

  constructor(whitelist?: Set<string>) {
    const entries = (wordlist as WordEntry[]).filter(
      (e) => !whitelist?.has(e.term),
    );

    this.meta = new Map(
      entries.map(({ term, severity, severityDesc, categories }) => [
        term,
        { severity, severityDesc, categories },
      ]),
    );

    // Longest-first so the alternation prefers the most specific match
    // (e.g. "motherfucker" matches before "fuck").
    const sorted = [...this.meta.keys()].sort((a, b) => b.length - a.length);
    const alt = sorted.map(escapeRegex).join("|");
    // Digit-aware whole-word boundaries: leetspeak anchors correctly
    // (@55, 5h1t) and "ass" won't fire inside "assassin" or "class".
    this.pattern = new RegExp(`(?<![a-z0-9])(?:${alt})(?![a-z0-9])`, "gi");
  }

  scan(text: string): GateHit[] {
    this.pattern.lastIndex = 0;
    const hits: GateHit[] = [];
    for (const m of text.matchAll(this.pattern)) {
      const surface = m[0].toLowerCase();
      const meta = this.meta.get(surface) ?? {
        severity: null,
        severityDesc: null,
        categories: [],
      };
      hits.push({
        term: surface,
        start: m.index!,
        end: m.index! + m[0].length,
        severity: meta.severity,
        severityDesc: meta.severityDesc,
        categories: meta.categories,
      });
    }
    return hits;
  }

  flagged(text: string): boolean {
    this.pattern.lastIndex = 0;
    return this.pattern.test(text);
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

let _gate: ProfanityGate | null = null;

/** Lazy module-scope singleton — compiles once, reused across warm invocations. */
export function getGate(): ProfanityGate {
  if (!_gate) _gate = new ProfanityGate();
  return _gate;
}
