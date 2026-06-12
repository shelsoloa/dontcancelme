-- Phase-1 moderation audit table.
-- Stores per-item pipeline results keyed by SHA-256 hash of the input text
-- (never raw text — the "no tweets stored server-side" constraint is upheld).
-- All writes are service-role only (admin client). Pattern mirrors
-- 20260609120000_add_quote_billing.sql.

create table public.moderation_checks (
  id           uuid        primary key default gen_random_uuid(),
  job_id       uuid        references public.audit_jobs (job_id) on delete cascade,
  user_id      uuid        not null references auth.users (id) on delete cascade,
  input_hash   text        not null,
  input_length integer     not null,
  phase1       jsonb       not null,
  phase2       jsonb,
  labels       text[]      not null default '{}',
  severity     text        check (severity in ('mild', 'strong', 'severe')),
  decision     text        not null check (decision in ('clean', 'flagged')),
  degraded     boolean     not null default false,
  created_at   timestamptz not null default now()
);

create index moderation_checks_job_idx  on public.moderation_checks (job_id);
create index moderation_checks_user_idx on public.moderation_checks (user_id);
create index moderation_checks_hash_idx on public.moderation_checks (input_hash);

alter table public.moderation_checks enable row level security;

create policy "moderation_checks_select_own"
  on public.moderation_checks
  for select
  to authenticated
  using (auth.uid() = user_id);

revoke all on public.moderation_checks from anon, authenticated;
grant select on public.moderation_checks to authenticated;
grant all    on public.moderation_checks to service_role;
