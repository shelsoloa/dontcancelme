-- User-level scan-credit system.
--
-- Design:
--   free_used: lifetime posts consumed from the 500-post free allowance.
--   balance:   purchased scan credits, drawn down per-job after free is exhausted.
-- All writes are service-role only (security definer functions + admin client)
-- so a tampered client can never inflate its own balance.

-- ---------------------------------------------------------------------------
-- user_credits: one row per user; lazily created on first scan.
-- ---------------------------------------------------------------------------
create table public.user_credits (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  free_used  int not null default 0 check (free_used >= 0),
  balance    int not null default 0 check (balance   >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger user_credits_set_updated_at
  before update on public.user_credits
  for each row execute function public.set_updated_at();

alter table public.user_credits enable row level security;
create policy "user_credits_select_own" on public.user_credits
  for select to authenticated
  using (auth.uid() = user_id);
revoke all on public.user_credits from anon, authenticated;
grant select on public.user_credits to authenticated;
grant all    on public.user_credits to service_role;

-- ---------------------------------------------------------------------------
-- job_charges: one row per job that consumed credits (idempotency marker).
-- Re-running the same job never double-charges.
-- ---------------------------------------------------------------------------
create table public.job_charges (
  job_id       uuid primary key references public.audit_jobs (job_id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  posts        int not null,
  from_free    int not null,
  from_balance int not null,
  created_at   timestamptz not null default now()
);

create index job_charges_user_idx on public.job_charges (user_id);

alter table public.job_charges enable row level security;
create policy "job_charges_select_own" on public.job_charges
  for select to authenticated
  using (auth.uid() = user_id);
revoke all on public.job_charges from anon, authenticated;
grant select on public.job_charges to authenticated;
grant all    on public.job_charges to service_role;

-- ---------------------------------------------------------------------------
-- credit_purchases: ledger for top-up Stripe checkout sessions.
-- ---------------------------------------------------------------------------
create table public.credit_purchases (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  credits               int not null,
  blocks                int not null,
  status                text not null default 'pending'
                          check (status in ('pending', 'paid', 'canceled')),
  stripe_session_id     text unique,
  stripe_payment_intent text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index credit_purchases_user_idx on public.credit_purchases (user_id);

create trigger credit_purchases_set_updated_at
  before update on public.credit_purchases
  for each row execute function public.set_updated_at();

alter table public.credit_purchases enable row level security;
create policy "credit_purchases_select_own" on public.credit_purchases
  for select to authenticated
  using (auth.uid() = user_id);
revoke all on public.credit_purchases from anon, authenticated;
grant select on public.credit_purchases to authenticated;
grant all    on public.credit_purchases to service_role;

-- ---------------------------------------------------------------------------
-- charge_job_credits: atomic debit on the user's credit pool.
--
-- Returns 0 on success, positive integer = shortfall (scan was NOT charged).
-- Idempotent: a job_id that already has a job_charges row returns 0 immediately.
-- 500 mirrors FREE_TWEET_LIMIT in web/src/lib/billing.ts.
-- ---------------------------------------------------------------------------
create or replace function public.charge_job_credits(
  p_job_id  uuid,
  p_user_id uuid,
  p_posts   int
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_free_limit  constant int := 500;  -- mirrors FREE_TWEET_LIMIT in billing.ts
  v_free_used   int;
  v_balance     int;
  v_free_avail  int;
  v_from_free   int;
  v_from_bal    int;
begin
  -- Idempotency: already charged for this job → no-op.
  if exists (select 1 from job_charges where job_id = p_job_id) then
    return 0;
  end if;

  -- Lazily initialise the credits row; concurrent inserts are resolved via conflict.
  insert into user_credits (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  -- Lock the row for the duration of this transaction.
  select free_used, balance
  into   v_free_used, v_balance
  from   user_credits
  where  user_id = p_user_id
  for update;

  v_free_avail := greatest(0, v_free_limit - v_free_used);
  v_from_free  := least(p_posts, v_free_avail);
  v_from_bal   := p_posts - v_from_free;

  -- Not enough balance → return the shortfall without charging anything.
  if v_from_bal > v_balance then
    return v_from_bal - v_balance;
  end if;

  -- Deduct credits.
  update user_credits
  set free_used  = free_used  + v_from_free,
      balance    = balance    - v_from_bal,
      updated_at = now()
  where user_id = p_user_id;

  -- Record the charge for idempotency on re-runs.
  insert into job_charges (job_id, user_id, posts, from_free, from_balance)
  values (p_job_id, p_user_id, p_posts, v_from_free, v_from_bal);

  return 0;
end;
$$;

revoke execute on function public.charge_job_credits(uuid, uuid, int)
  from anon, authenticated;
grant  execute on function public.charge_job_credits(uuid, uuid, int)
  to   service_role;

-- ---------------------------------------------------------------------------
-- apply_credit_purchase: flip a credit_purchase pending → paid and credit the
-- user's balance. Idempotent: a repeated Stripe event is a no-op.
-- ---------------------------------------------------------------------------
create or replace function public.apply_credit_purchase(
  p_session_id     text,
  p_payment_intent text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_credits int;
  v_rows    int;
begin
  -- Flip pending → paid; the where-clause is the idempotency guard.
  update credit_purchases
  set status                = 'paid',
      stripe_payment_intent = p_payment_intent,
      updated_at            = now()
  where stripe_session_id = p_session_id
    and status = 'pending'
  returning user_id, credits into v_user_id, v_credits;

  get diagnostics v_rows = row_count;

  -- Only credit the balance if a row actually transitioned.
  if v_rows > 0 then
    insert into user_credits (user_id, balance)
    values (v_user_id, v_credits)
    on conflict (user_id)
    do update set balance    = user_credits.balance + excluded.balance,
                  updated_at = now();
  end if;
end;
$$;

revoke execute on function public.apply_credit_purchase(text, text)
  from anon, authenticated;
grant  execute on function public.apply_credit_purchase(text, text)
  to   service_role;
