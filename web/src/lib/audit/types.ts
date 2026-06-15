/**
 * Domain types for the social-media audit tool.
 *
 * These mirror the database schema in
 * `supabase/migrations/<ts>_init_audit_schema.sql`. Pure types, no runtime deps.
 *
 * Images are now *displayed* on post cards when present (resolved from the X API
 * media expansion). Detection remains TEXT-ONLY — `nsfw` and `violence` categories
 * classify *text* content only; no image analysis occurs.
 *
 * Secrets: OAuth tokens are intentionally NOT represented here. They live in a
 * server-only `connection_secrets` table that only the `service_role` can read,
 * encrypted app-side, and are never sent to the client.
 */

/** Platforms we can audit. Single-value for now; widen as we add platforms. */
export type Platform = "x";

/**
 * Risky-content categories. Values are short, stable machine codes — persist
 * these, never the human label (see {@link RISK_LABELS} for display strings).
 */
export enum RiskCategory {
  /** The user's OWN personal info (address, phone, email, etc.). */
  PII = "pii",
  /** Someone ELSE's personal info exposed. */
  Doxxing = "doxxing",
  /** Secrets: API keys, passwords, tokens. */
  Credentials = "credentials",
  /** Sexual content / nudity expressed in text (image NSFW deferred to v2). */
  Nsfw = "nsfw",
  /** Threats / graphic violence expressed in text. */
  Violence = "violence",
  /** Slurs, harassment, discriminatory content. */
  HateSpeech = "hate_speech",
  /** Offensive language. */
  Profanity = "profanity",
  /** Drug / alcohol references. */
  Substances = "substances",
}

/**
 * Which kinds of timeline content an audit pulls.
 *
 * own_text   — the user's own text-only posts (no photo attachments).
 * own_images — the user's own posts that carry photos (billed at 4× text rate).
 *              Videos are NOT supported and are excluded from both buckets.
 * reposts    — the user's reposts (billed at text rate).
 * likes      — posts the user has liked (indeterministic; drained from balance).
 */
export type AuditSource = "own_text" | "own_images" | "likes" | "reposts";

/** All audit sources, in display order. */
export const ALL_AUDIT_SOURCES: AuditSource[] = [
  "own_text",
  "own_images",
  "likes",
  "reposts",
];

/** Human-readable labels for the audit sources. */
export const AUDIT_SOURCE_LABELS: Record<AuditSource, string> = {
  own_text:   "Your text posts",
  own_images: "Your image posts",
  reposts:    "Reposts",
  likes:      "Liked posts",
};

/** Credit weight per tweet type. Image tweets cost 4× a text/repost tweet. */
export const IMAGE_TWEET_WEIGHT = 4;

/** Sources that can be quoted exactly up-front (own account content). */
export const DETERMINISTIC_SOURCES: AuditSource[] = [
  "own_text",
  "own_images",
  "reposts",
];

/** Returns true for sources we can produce a firm quote for. */
export function isDeterministic(s: AuditSource): boolean {
  return DETERMINISTIC_SOURCES.includes(s);
}

/** Human-readable labels for display. Keep in sync with {@link RiskCategory}. */
export const RISK_LABELS: Record<RiskCategory, string> = {
  [RiskCategory.PII]: "Personally identifiable information",
  [RiskCategory.Doxxing]: "Doxxing (others’ personal info)",
  [RiskCategory.Credentials]: "Credentials & secrets",
  [RiskCategory.Nsfw]: "NSFW / sexual content",
  [RiskCategory.Violence]: "Violence & threats",
  [RiskCategory.HateSpeech]: "Hate speech & harassment",
  [RiskCategory.Profanity]: "Profanity",
  [RiskCategory.Substances]: "Drugs & alcohol",
};

/** How bad the flag is if correct (distinct from {@link Flag.confidence}). */
export type Severity = "low" | "medium" | "high" | "critical";

/** Which detector produced a flag (provenance / trust / tuning). */
export type Detector = "regex" | "llm" | "gate";

// ─── Moderation pipeline types ───────────────────────────────────────────────

/** Fine-grained label produced by the moderation pipeline. */
export type ModerationLabel =
  | "curse"
  | "strong_curse"
  | "nsfw_sexual"
  | "violent"
  | "hate";

/** A single match from the Phase-1 regex gate. */
export type GateHit = {
  term: string;
  start: number;
  end: number;
  severity: number | null;
  severityDesc: string | null;
  categories: string[];
};

/** Per-item result from the moderation pipeline. */
export type ModerationResult = {
  /** Caller-supplied item id (tweet id, etc.). */
  id: string;
  decision: "clean" | "flagged";
  labels: ModerationLabel[];
  severity: "mild" | "strong" | "severe" | null;
  degraded: boolean;
  phase1: { ms: number; hits: GateHit[] };
  phase2: {
    status: string;
    categories: string[];
    scores: Record<string, number>;
  } | null;
};

/** Where in the post the flag was found. Never contains a raw secret. */
export type FlagEvidence = {
  /** Inclusive start offset into the post text. */
  textStart?: number;
  /** Exclusive end offset into the post text. */
  textEnd?: number;
  /** Masked sample for display, e.g. "AKIA••••••••". Never the raw value. */
  redactedSample?: string;
};

export type Flag = {
  category: RiskCategory;
  severity: Severity;
  /** Detector confidence, 0–1. Separate from {@link Flag.severity}. */
  confidence: number;
  /** Short human explanation of why this was flagged. */
  reason: string;
  detector: Detector;
  evidence?: FlagEvidence;
};

/** Origin of an audited post within a job (one audit may combine sources). */
export type PostSource = "api" | "archive_upload";

/** The user's triage decision for a post. */
export type PostDecision = "pending" | "keep" | "delete" | "deleted" | "failed";

export type AuditedPost = {
  /** Our internal id. */
  id: string;
  jobId: string;
  userId: string;
  platform: Platform;
  /** Platform's post id (e.g. tweet id). String — 64-bit, overflows number. */
  platformPostId: string;
  /** Permalink, for in-context review. */
  url: string;
  authorHandle: string;
  /** Post text as stored — any detected secret is masked in place. */
  text: string;
  /** When the post was published (ISO 8601). */
  postedAt: string;
  source: PostSource;
  /**
   * Resolved image URLs for any media on this post (photos native URL;
   * videos/GIFs static preview frame). Absent when the post has no media
   * or was produced from sample data.
   */
  mediaUrls?: string[];
  /** Author's profile image URL. Absent for sample data. */
  authorAvatarUrl?: string;
  flags: Flag[];
  decision: PostDecision;
  /** When the decision was last set (ISO 8601). */
  decidedAt?: string;
  /** When we created this row (ISO 8601). */
  createdAt: string;
  /** Which audit source this post came from (absent for sample data). */
  auditSource?: AuditSource;
};

export type AuditJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "canceled";

export type AuditJobProgress = {
  total: number;
  processed: number;
  flagged: number;
};

export type AuditJobRecord = {
  jobId: string;
  userId: string;
  /** The connection this audit used, if it pulled live posts. */
  connectionId?: string;
  platform: Platform;
  /**
   * Categories enabled for this audit. Defines what "unflagged" means and lets
   * a later re-run scan only the delta.
   */
  enabledCategories: RiskCategory[];
  /** Which timeline content this audit pulls (own posts / likes / reposts). */
  enabledSources: AuditSource[];
  status: AuditJobStatus;
  progress: AuditJobProgress;
  /** Per-category flagged counts for the results summary. */
  stats?: Partial<Record<RiskCategory, number>>;
  /** Storage path of the uploaded `tweets.js`, if an archive was used (transient). */
  archiveInputRef?: string;
  error?: string;
  /** ISO 8601 timestamps. */
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  updatedAt: string;
  /** Retention / auto-purge time (ISO 8601). */
  expiresAt?: string;
};

export type ConnectionStatus = "active" | "revoked" | "expired";

/** A linked platform account. Tokens are NOT here (server-only, see file header). */
export type PlatformConnection = {
  id: string;
  userId: string;
  platform: Platform;
  handle: string;
  /** The platform's stable user id. */
  platformUserId: string;
  scopes: string[];
  status: ConnectionStatus;
  /** When the access token expires (ISO 8601). */
  tokenExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
};

/** Immutable record of a delete we performed on the user's behalf. */
export type DeletionLogEntry = {
  id: string;
  userId: string;
  jobId?: string;
  postId?: string;
  platformPostId: string;
  success: boolean;
  error?: string;
  /** ISO 8601. */
  deletedAt: string;
};

/**
 * Reusable per-user demographic profile ("qualifying information") collected at
 * intake. One row per user; mirrors the `profiles` table.
 */
export type Profile = {
  userId: string;
  age?: number;
  gender?: string;
  race?: string;
  sexualOrientation?: string;
  country?: string;
  /** ISO 8601 timestamps. */
  createdAt: string;
  updatedAt: string;
};
