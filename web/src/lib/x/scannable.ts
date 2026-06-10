import { ALL_AUDIT_SOURCES, type AuditSource } from "@/lib/audit/types";

/**
 * Coerce the stored `enabled_sources` column into a valid source list.
 * Maps legacy "posts" values to "own_text" for backwards compatibility with
 * rows created before the source-model split in 20260609120000_add_quote_billing.
 */
export function parseSources(raw: unknown): AuditSource[] {
  const valid = new Set<string>(ALL_AUDIT_SOURCES);
  const list = Array.isArray(raw)
    ? raw
        .map((s) => (s === "posts" ? "own_text" : s)) // legacy migration
        .filter((s): s is AuditSource => valid.has(s as string))
    : [];
  return list.length > 0 ? list : ["own_text"];
}
