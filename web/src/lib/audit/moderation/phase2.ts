import "server-only";

import type { ModerationLabel } from "@/lib/audit/types";

const OPENAI_MODERATION_URL = "https://api.openai.com/v1/moderations";
const REQUEST_TIMEOUT_MS = 5_000;

/** Minimum category score to consider a category "flagged". */
export const MIN_CONFIDENCE = 0.5;

/** Map OpenAI `omni-moderation-latest` categories to our `ModerationLabel`s. */
export const CATEGORY_TO_LABEL: Record<string, ModerationLabel> = {
  hate: "hate",
  "hate/threatening": "hate",
  harassment: "hate",
  "harassment/threatening": "violent",
  "self-harm": "violent",
  "self-harm/intent": "violent",
  "self-harm/instructions": "violent",
  sexual: "nsfw_sexual",
  "sexual/minors": "nsfw_sexual",
  violence: "violent",
  "violence/graphic": "violent",
  "illicit/violent": "violent",
  // "illicit" (plain) — unmapped; raw signal recorded in phase2 jsonb.
};

/** Per-item shape stored in `ModerationResult.phase2`. */
export type Phase2PerItem = {
  status: string;
  flagged: boolean;
  /** Raw OpenAI categories that fired (map keys where value was true). */
  categories: string[];
  /** All category scores from the API response. */
  scores: Record<string, number>;
};

/**
 * Map a raw Phase 2 result into our `ModerationLabel`s, respecting the
 * minimum-confidence threshold.
 */
export function labelsFromPhase2(result: Phase2PerItem): ModerationLabel[] {
  const labels = new Set<ModerationLabel>();
  for (const cat of result.categories) {
    if ((result.scores[cat] ?? 0) < MIN_CONFIDENCE) continue;
    const label = CATEGORY_TO_LABEL[cat];
    if (label) labels.add(label);
  }
  return [...labels];
}

/**
 * Call OpenAI `omni-moderation-latest` for a batch of texts.
 *
 * Returns per-item results (same length as `items`), or `null` on any failure
 * (missing key, network error, timeout, non-2xx, malformed response).
 */
export async function moderateOpenAI(
  items: { id: string; text: string }[],
): Promise<Phase2PerItem[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  if (items.length === 0) return [];

  let res: Response;
  try {
    res = await fetch(OPENAI_MODERATION_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "omni-moderation-latest",
        input: items.map((i) => i.text),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  let data: {
    results: Array<{
      flagged: boolean;
      categories: Record<string, boolean>;
      category_scores: Record<string, number>;
    }>;
  };
  try {
    data = await res.json();
  } catch {
    return null;
  }

  if (!data?.results || !Array.isArray(data.results)) return null;

  return data.results.map((r) => ({
    status: "ok",
    flagged: r.flagged,
    categories: Object.keys(r.categories).filter((k) => r.categories[k]),
    scores: r.category_scores ?? {},
  }));
}
