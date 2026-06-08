-- Per-job scan limit: maximum number of posts to fetch across all sources.
-- Nullable; null means no constraint (use the API maximum).
alter table public.audit_jobs
  add column scan_limit integer check (scan_limit > 0);
