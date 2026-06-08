/**
 * Domain types for the social-media audit tool.
 *
 * These mirror the database schema in
 * `supabase/migrations/<ts>_init_audit_schema.sql`. Pure types, no runtime deps.
 *
 * v1 is TEXT-ONLY: there is no media/image handling. Image-based detection and
 * media storage are deferred to a later version. The `nsfw` and `violence`
 * categories below classify *text* content only.
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
 * Which kinds of timeline content an audit pulls. An audit can combine several:
 * the user's own posts, posts they've liked, and posts they've reposted.
 */
export type AuditSource = "posts" | "likes" | "reposts";

/** All audit sources, in display order. */
export const ALL_AUDIT_SOURCES: AuditSource[] = ["posts", "likes", "reposts"];

/** Human-readable labels for the audit sources. */
export const AUDIT_SOURCE_LABELS: Record<AuditSource, string> = {
  posts: "Your posts",
  likes: "Liked posts",
  reposts: "Reposts",
};

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
export type Detector = "regex" | "llm";

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
  flags: Flag[];
  decision: PostDecision;
  /** When the decision was last set (ISO 8601). */
  decidedAt?: string;
  /** When we created this row (ISO 8601). */
  createdAt: string;
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
  age: number;
  gender: string;
  race?: string;
  sexualOrientation?: string;
  country?: string;
  /** ISO 8601 timestamps. */
  createdAt: string;
  updatedAt: string;
};
