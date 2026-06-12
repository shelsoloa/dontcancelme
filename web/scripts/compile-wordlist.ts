/**
 * Compile the Surge AI Obscenity List CSV into a JSON wordlist used by gate.ts.
 *
 * Run: pnpm build:wordlist  (tsx scripts/compile-wordlist.ts)
 * Output: src/lib/moderation/data/wordlist.json (commit this file)
 *
 * CSV columns: text, canonical_form_1..3, category_1..3,
 *              severity_rating, severity_description
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

type WordEntry = {
  term: string;
  severity: number | null;
  severityDesc: string | null;
  categories: string[];
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CSV_PATH = path.join(
  __dirname,
  "../src/lib/moderation/data/profanity_en.csv",
);
const OUT_PATH = path.join(
  __dirname,
  "../src/lib/moderation/data/wordlist.json",
);

async function main() {
  const stream = fs.createReadStream(CSV_PATH, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  const map = new Map<string, WordEntry>();
  let headerParsed = false;
  let headers: string[] = [];

  for await (const line of rl) {
    const cols = parseCsvLine(line);

    if (!headerParsed) {
      headers = cols;
      headerParsed = true;
      continue;
    }

    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? "";
    });

    const term = (row["text"] ?? "").trim().toLowerCase();
    if (!term) continue;

    const severityRaw = (row["severity_rating"] ?? "").trim();
    const severity = severityRaw ? Number(severityRaw) : null;
    const severityDesc = (row["severity_description"] ?? "").trim() || null;

    const categories = [
      row["category_1"] ?? "",
      row["category_2"] ?? "",
      row["category_3"] ?? "",
    ]
      .map((c) => c.trim())
      .filter(Boolean);

    map.set(term, { term, severity, severityDesc, categories });
  }

  const entries = Array.from(map.values());
  fs.writeFileSync(OUT_PATH, JSON.stringify(entries, null, 2) + "\n", "utf-8");
  console.log(`Wrote ${entries.length} entries → ${OUT_PATH}`);

  // Spot-check: "Strong " trimmed
  const strongEntry = entries.find((e) => e.severityDesc === "Strong");
  const trailingEntry = entries.find((e) => e.severityDesc === "Strong ");
  if (trailingEntry) {
    console.error('WARN: found untrimmed "Strong " severityDesc entry');
    process.exit(1);
  }
  if (strongEntry) {
    console.log('✓ "Strong " trimmed correctly → "Strong"');
  }
}

/** Minimal CSV parser — handles double-quoted fields with embedded commas. */
function parseCsvLine(line: string): string[] {
  const cols: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (ch === "," && !inQuote) {
      cols.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  return cols;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
