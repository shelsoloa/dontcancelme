-- Pay-per-scan billing for audits over the free tweet limit.
--
-- One row per job that required payment. The owner can SELECT their own rows
-- (to see status); all WRITES happen via the service_role (Stripe checkout +
-- webhook), never the browser — so a tampered client can't mark itself paid.

create table public.audit_payments (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  job_id                uuid not null unique
                          references public.audit_jobs (job_id) on delete cascade,
  scanned_count         int not null,      -- tweets we will scan (<= ~3200 cap)
  billable_blocks       int not null,      -- ceil((scanned - 500) / 500)
  status                text not null default 'pending'
                          check (status in ('pending', 'paid', 'canceled')),
  stripe_session_id     text unique,
  stripe_payment_intent text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index audit_payments_user_idx on public.audit_payments (user_id);

create trigger audit_payments_set_updated_at
  before update on public.audit_payments
  for each row execute function public.set_updated_at();

alter table public.audit_payments enable row level security;
-- Owner may read their own payment rows; no write policies (service_role only).
create policy "audit_payments_select_own" on public.audit_payments
  for select to authenticated
  using (auth.uid() = user_id);
-- Local Supabase still auto-grants new public tables to anon/authenticated, so
-- revoke and re-grant only SELECT — writes stay service_role-only at the grant
-- layer too (RLS already denies them). Mirrors connection_secrets.
revoke all on public.audit_payments from anon, authenticated;
grant select on public.audit_payments to authenticated;
grant all on public.audit_payments to service_role;
