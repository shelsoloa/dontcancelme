/**
 * Client-side content detectors (v1, TEXT-ONLY).
 *
 * Pure, dependency-free regex/keyword matchers — one pass per tweet, in the
 * browser. They are intentionally simple and high-recall-ish; an LLM detector
 * (see {@link Detector}) can be layered on later behind the same `Flag` shape.
 *
 * Security: matches marked `secret` (credentials, SSNs, card numbers) are MASKED
 * IN PLACE in the stored post text — we never persist the raw value, on the
 * client or anywhere else. Every flag's `evidence.redactedSample` is masked too.
 */

import {
  RiskCategory,
  type Detector,
  type Flag,
  type Severity,
} from "./types";

type Matcher = {
  category: RiskCategory;
  severity: Severity;
  /** Detector confidence, 0–1. Regex precision, not "how bad". */
  confidence: number;
  /** Short human explanation shown next to the flag. */
  reason: string;
  /** Global regex. Must have the `g` flag (we iterate all matches). */
  pattern: RegExp;
  /** When true, matched spans are masked out of the stored text. */
  secret?: boolean;
};

const DETECTOR: Detector = "regex";

// NOTE: the keyword lists below are deliberately small, tasteful placeholders so
// the taxonomy is demonstrable. Real lexicons/models replace these later.
const MATCHERS: Matcher[] = [
  // --- credentials -------------------------------------------------------
  {
    category: RiskCategory.Credentials,
    severity: "critical",
    confidence: 0.95,
    reason: "Looks like an AWS access key ID",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    secret: true,
  },
  {
    category: RiskCategory.Credentials,
    severity: "critical",
    confidence: 0.9,
    reason: "Looks like an API secret key",
    pattern: /\bsk-[A-Za-z0-9]{20,}\b/g,
    secret: true,
  },
  {
    category: RiskCategory.Credentials,
    severity: "critical",
    confidence: 0.9,
    reason: "Looks like a Google API key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    secret: true,
  },
  {
    category: RiskCategory.Credentials,
    severity: "critical",
    confidence: 0.9,
    reason: "Looks like a GitHub token",
    pattern: /\bghp_[A-Za-z0-9]{36}\b/g,
    secret: true,
  },
  {
    category: RiskCategory.Credentials,
    severity: "high",
    confidence: 0.7,
    reason: "Looks like a password or secret in the open",
    pattern: /\b(?:password|passwd|pwd|api[_-]?key|secret|token)\s*[:=]\s*\S{6,}/gi,
    secret: true,
  },
  // --- pii (the user's OWN info) -----------------------------------------
  {
    category: RiskCategory.PII,
    severity: "high",
    confidence: 0.95,
    reason: "Social Security number",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    secret: true,
  },
  {
    category: RiskCategory.PII,
    severity: "high",
    confidence: 0.6,
    reason: "Possible payment-card number",
    pattern: /\b(?:\d[ -]?){13,16}\b/g,
    secret: true,
  },
  {
    category: RiskCategory.PII,
    severity: "medium",
    confidence: 0.85,
    reason: "Email address",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    category: RiskCategory.PII,
    severity: "medium",
    confidence: 0.55,
    reason: "Phone number",
    pattern: /(?:\+?\d{1,2}[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}\b/g,
  },
  {
    category: RiskCategory.PII,
    severity: "medium",
    confidence: 0.6,
    reason: "Street address",
    pattern:
      /\b\d{1,5}\s+(?:[A-Za-z0-9.'-]+\s){1,4}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Terrace|Ter|Place|Pl)\b\.?/gi,
  },
  // --- doxxing (someone ELSE's info) -------------------------------------
  {
    category: RiskCategory.Doxxing,
    severity: "high",
    confidence: 0.5,
    reason: "Exposes where someone can be found",
    pattern:
      /\b(?:lives at|his address is|her address is|their address is|you can find (?:him|her|them) at|home address|real name is)\b/gi,
  },
  // --- nsfw (text only in v1) --------------------------------------------
  {
    category: RiskCategory.Nsfw,
    severity: "medium",
    confidence: 0.5,
    reason: "Sexual content",
    pattern: /\b(?:nude|nudes|naked|porn|horny|nsfw|sext|dick\s?pic)\w*/gi,
  },
  // --- violence ----------------------------------------------------------
  {
    category: RiskCategory.Violence,
    severity: "high",
    confidence: 0.7,
    reason: "Violent threat",
    pattern:
      /\b(?:i(?:'|’)?ll kill you|kill you|going to kill|gonna kill|shoot you|i(?:'|’)?ll hurt you|beat you up|murder you|i(?:'|’)?ll find you)\b/gi,
  },
  // --- hate speech / harassment (minimal placeholder lexicon) ------------
  {
    category: RiskCategory.HateSpeech,
    severity: "high",
    confidence: 0.5,
    reason: "Possible hate speech or harassment",
    pattern: /\b(?:kys|go kill yourself|subhuman|retard(?:ed)?|you people)\w*/gi,
  },
  // --- profanity ---------------------------------------------------------
  {
    category: RiskCategory.Profanity,
    severity: "low",
    confidence: 0.6,
    reason: "Profanity",
    pattern: /\b(?:fuck|shit|bitch|asshole|bastard|dick|piss)\w*/gi,
  },
  // --- substances --------------------------------------------------------
  {
    category: RiskCategory.Substances,
    severity: "low",
    confidence: 0.5,
    reason: "Drug or alcohol reference",
    pattern:
      /\b(?:cocaine|coke|heroin|meth|weed|marijuana|cannabis|molly|mdma|xanax|adderall|drunk|wasted|vodka|whiskey|tequila|blunt)\w*/gi,
  },
];

/** Mask a sensitive value, keeping a short recognizable prefix. */
function maskValue(raw: string): string {
  const v = raw.trim();
  if (v.length <= 4) return "•".repeat(Math.max(v.length, 3));
  return v.slice(0, 4) + "•".repeat(Math.min(8, v.length - 4));
}

export type DetectionResult = {
  flags: Flag[];
  /** Original text with secrets masked in place. Safe to persist. */
  redactedText: string;
};

/**
 * Run all enabled detectors over a tweet's text.
 *
 * Returns the flags found plus a redacted copy of the text (secrets masked in
 * place). Caps flags per category so a pathological tweet can't flood the UI.
 */
export function detect(
  text: string,
  enabled: RiskCategory[],
): DetectionResult {
  const enabledSet = new Set(enabled);
  const flags: Flag[] = [];
  const perCategory = new Map<RiskCategory, number>();
  const MAX_PER_CATEGORY = 5;

  // Spans to mask out of the stored text (start/end into the ORIGINAL string).
  const maskSpans: Array<{ start: number; end: number }> = [];

  for (const m of MATCHERS) {
    if (!enabledSet.has(m.category)) continue;
    m.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = m.pattern.exec(text)) !== null) {
      // Guard against zero-width matches looping forever.
      if (match[0].length === 0) {
        m.pattern.lastIndex++;
        continue;
      }
      const count = perCategory.get(m.category) ?? 0;
      const start = match.index;
      const end = start + match[0].length;
      if (m.secret) maskSpans.push({ start, end });

      if (count >= MAX_PER_CATEGORY) continue;
      perCategory.set(m.category, count + 1);
      flags.push({
        category: m.category,
        severity: m.severity,
        confidence: m.confidence,
        reason: m.reason,
        detector: DETECTOR,
        evidence: {
          textStart: start,
          textEnd: end,
          redactedSample: maskValue(match[0]),
        },
      });
    }
  }

  return { flags, redactedText: redact(text, maskSpans) };
}

/** Replace the given spans (in original-text coordinates) with masked values. */
function redact(
  text: string,
  spans: Array<{ start: number; end: number }>,
): string {
  if (spans.length === 0) return text;
  // Apply right-to-left so earlier offsets stay valid.
  const ordered = [...spans].sort((a, b) => b.start - a.start);
  let out = text;
  let lastStart = Infinity;
  for (const { start, end } of ordered) {
    if (end > lastStart) continue; // skip overlaps already covered
    out = out.slice(0, start) + maskValue(text.slice(start, end)) + out.slice(end);
    lastStart = start;
  }
  return out;
}
