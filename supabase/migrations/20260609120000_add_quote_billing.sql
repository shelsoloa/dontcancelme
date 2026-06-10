-- Quote-based billing rework.
--
-- New model:
--   1. A quote is computed via X counts/all before checkout.
--   2. Deterministic work (own posts) is charged exactly at runner start.
--   3. Likes are drained per-item from the prepaid balance, resumable via cursor.
--
-- All writes are service-role only (security definer + admin client).
-- Pattern: revoke all from anon/authenticated, grant select to authenticated,
-- grant all to service_role — mirrors 20260608160000_add_user_credits.sql.

-- ---------------------------------------------------------------------------
-- audit_jobs: new columns for quote, likes-cap, and cursor-based resumption.
-- ---------------------------------------------------------------------------
alter table public.audit_jobs
  add column likes_cap       integer check (likes_cap > 0),
  add column likes_cursor    text,
  add column likes_processed integer not null default 0,
  add column quote           jsonb;

-- Update default source to match new enum member (own_text replaces posts).
alter table public.audit_jobs
  alter column enabled_sources set default '{own_text}';

-- Migrate existing rows: 'posts' → 'own_text' for back-compat.
update public.audit_jobs
  set enabled_sources = array_replace(enabled_sources, 'posts', 'own_text')
  where 'posts' = any(enabled_sources);

-- ---------------------------------------------------------------------------
-- like_charges: cumulative per-job likes billing ledger.
-- One row per job (upserted); tracks total units spent and items processed.
-- ---------------------------------------------------------------------------
create table public.like_charges (
  job_id          uuid primary key references public.audit_jobs (job_id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  units_spent     integer not null default 0,
  likes_processed integer not null default 0,
  updated_at      timestamptz not null default now()
);

create trigger like_charges_set_updated_at
  before update on public.like_charges
  for each row execute function public.set_updated_at();

create index like_charges_user_idx on public.like_charges (user_id);

alter table public.like_charges enable row level security;
create policy "like_charges_select_own" on public.like_charges
  for select to authenticated
  using (auth.uid() = user_id);
revoke all on public.like_charges from anon, authenticated;
grant select on public.like_charges to authenticated;
grant all    on public.like_charges to service_role;

-- ---------------------------------------------------------------------------
-- quote_rate_limits: per-user token bucket for the /api/quote endpoint.
-- Each call to counts/all costs money (app-level rate limit); protect it.
-- ---------------------------------------------------------------------------
create table public.quote_rate_limits (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  window_start timestamptz not null default now(),
  count        integer not null default 0
);

-- Service-role only: no user-visible reads needed.
revoke all on public.quote_rate_limits from anon, authenticated;
grant all  on public.quote_rate_limits to service_role;

-- ---------------------------------------------------------------------------
-- charge_deterministic: atomic debit for the quoted deterministic amount.
--
-- Unlike charge_job_credits (which accepts raw post count and applies free
-- internally), this function accepts raw item counts and IMAGE_WEIGHT=4 so
-- the SQL re-derives the free-tier allocation under lock — preventing races
-- between quote time and charge time.
--
-- Returns 0 on success, positive = shortfall (nothing was charged).
-- Idempotent per job_id (via job_charges).
-- Image weight hardcoded at 4 — mirrors IMAGE_TWEET_WEIGHT in audit/types.ts.
-- ---------------------------------------------------------------------------
create or replace function public.charge_deterministic(
  p_job_id       uuid,
  p_user_id      uuid,
  p_text_items   int,   -- own text posts + reposts (each = 1 unit)
  p_image_items  int    -- own image posts (each = 4 units)
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_free_limit  constant int := 500;   -- mirrors FREE_TWEET_LIMIT in billing.ts
  v_image_wt    constant int := 4;     -- mirrors IMAGE_TWEET_WEIGHT in types.ts
  v_free_used   int;
  v_balance     int;
  v_free_avail  int;
  -- free tier applies to items, cheapest bucket first (text then images)
  v_from_free_text  int;
  v_from_free_image int;
  v_charged_text    int;
  v_charged_image   int;
  v_charged_units   int;
  v_total_items     int;
begin
  -- Idempotency: already charged → no-op.
  if exists (select 1 from job_charges where job_id = p_job_id) then
    return 0;
  end if;

  v_total_items := p_text_items + p_image_items;

  -- Lazily initialise the credits row.
  insert into user_credits (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  -- Lock for the duration of this transaction.
  select free_used, balance
  into   v_free_used, v_balance
  from   user_credits
  where  user_id = p_user_id
  for update;

  v_free_avail := greatest(0, v_free_limit - v_free_used);

  -- Apply free tier to text items first, then images.
  v_from_free_text  := least(p_text_items, v_free_avail);
  v_from_free_image := least(p_image_items, greatest(0, v_free_avail - v_from_free_text));

  v_charged_text  := p_text_items  - v_from_free_text;
  v_charged_image := p_image_items - v_from_free_image;
  v_charged_units := v_charged_text * 1 + v_charged_image * v_image_wt;

  -- Not enough balance → return shortfall without charging.
  if v_charged_units > v_balance then
    return v_charged_units - v_balance;
  end if;

  -- Deduct credits.
  update user_credits
  set free_used  = free_used + v_from_free_text + v_from_free_image,
      balance    = balance   - v_charged_units,
      updated_at = now()
  where user_id = p_user_id;

  -- Record for idempotency; posts = total items (free + paid).
  insert into job_charges (job_id, user_id, posts, from_free, from_balance)
  values (
    p_job_id,
    p_user_id,
    v_total_items,
    v_from_free_text + v_from_free_image,
    v_charged_units
  );

  return 0;
end;
$$;

revoke execute on function public.charge_deterministic(uuid, uuid, int, int)
  from anon, authenticated;
grant  execute on function public.charge_deterministic(uuid, uuid, int, int)
  to   service_role;

-- ---------------------------------------------------------------------------
-- charge_like: per-like balance debit. NOT idempotent per call.
-- The caller's cursor (advanced only after successful charge) is the dedupe guard.
-- Draws from balance only — likes never use the free tier.
-- Returns 0 on success, positive = shortfall (nothing charged).
-- ---------------------------------------------------------------------------
create or replace function public.charge_like(
  p_job_id  uuid,
  p_user_id uuid,
  p_units   int   -- 1 (text like) or 4 (image like)
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance int;
begin
  -- Lazily initialise.
  insert into user_credits (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select balance into v_balance
  from   user_credits
  where  user_id = p_user_id
  for update;

  if p_units > v_balance then
    return p_units - v_balance;
  end if;

  update user_credits
  set balance    = balance - p_units,
      updated_at = now()
  where user_id = p_user_id;

  -- Upsert the per-job likes ledger.
  insert into like_charges (job_id, user_id, units_spent, likes_processed)
  values (p_job_id, p_user_id, p_units, 1)
  on conflict (job_id) do update
    set units_spent     = like_charges.units_spent     + p_units,
        likes_processed = like_charges.likes_processed + 1,
        updated_at      = now();

  return 0;
end;
$$;

revoke execute on function public.charge_like(uuid, uuid, int)
  from anon, authenticated;
grant  execute on function public.charge_like(uuid, uuid, int)
  to   service_role;

-- ---------------------------------------------------------------------------
-- take_quote_token: sliding-window rate limiter for /api/quote.
-- Returns true if the token is granted (within the window limit).
-- ---------------------------------------------------------------------------
create or replace function public.take_quote_token(
  p_user_id     uuid,
  p_max         int,  -- max calls allowed per window
  p_window_secs int   -- window length in seconds
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into quote_rate_limits (user_id, window_start, count)
  values (p_user_id, now(), 1)
  on conflict (user_id) do update
    set window_start = case
          when quote_rate_limits.window_start
               < now() - (p_window_secs || ' seconds')::interval
          then now()
          else quote_rate_limits.window_start
        end,
        count = case
          when quote_rate_limits.window_start
               < now() - (p_window_secs || ' seconds')::interval
          then 1
          else quote_rate_limits.count + 1
        end
  returning count into v_count;

  return v_count <= p_max;
end;
$$;

revoke execute on function public.take_quote_token(uuid, int, int)
  from anon, authenticated;
grant  execute on function public.take_quote_token(uuid, int, int)
  to   service_role;
