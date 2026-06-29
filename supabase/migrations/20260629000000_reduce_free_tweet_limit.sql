-- Reduce the lifetime free-post allowance from 500 to 100.
-- Updates charge_job_credits and charge_deterministic in-place to keep
-- the DB functions in sync with billing.ts (FREE_TWEET_LIMIT).

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
  v_free_limit  constant int := 100;  -- mirrors FREE_TWEET_LIMIT in billing.ts
  v_free_used   int;
  v_balance     int;
  v_free_avail  int;
  v_from_free   int;
  v_from_bal    int;
begin
  if exists (select 1 from job_charges where job_id = p_job_id) then
    return 0;
  end if;

  insert into user_credits (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select free_used, balance
  into   v_free_used, v_balance
  from   user_credits
  where  user_id = p_user_id
  for update;

  v_free_avail := greatest(0, v_free_limit - v_free_used);
  v_from_free  := least(p_posts, v_free_avail);
  v_from_bal   := p_posts - v_from_free;

  if v_from_bal > v_balance then
    return v_from_bal - v_balance;
  end if;

  update user_credits
  set free_used  = free_used  + v_from_free,
      balance    = balance    - v_from_bal,
      updated_at = now()
  where user_id = p_user_id;

  insert into job_charges (job_id, user_id, posts, from_free, from_balance)
  values (p_job_id, p_user_id, p_posts, v_from_free, v_from_bal);

  return 0;
end;
$$;

create or replace function public.charge_deterministic(
  p_job_id       uuid,
  p_user_id      uuid,
  p_text_items   int,
  p_image_items  int
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_free_limit  constant int := 100;   -- mirrors FREE_TWEET_LIMIT in billing.ts
  v_image_wt    constant int := 4;     -- mirrors IMAGE_TWEET_WEIGHT in types.ts
  v_free_used   int;
  v_balance     int;
  v_free_avail  int;
  v_from_free_text  int;
  v_from_free_image int;
  v_charged_text    int;
  v_charged_image   int;
  v_charged_units   int;
  v_total_items     int;
begin
  if exists (select 1 from job_charges where job_id = p_job_id) then
    return 0;
  end if;

  v_total_items := p_text_items + p_image_items;

  insert into user_credits (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select free_used, balance
  into   v_free_used, v_balance
  from   user_credits
  where  user_id = p_user_id
  for update;

  v_free_avail := greatest(0, v_free_limit - v_free_used);

  v_from_free_text  := least(p_text_items, v_free_avail);
  v_from_free_image := least(p_image_items, greatest(0, v_free_avail - v_from_free_text));

  v_charged_text  := p_text_items  - v_from_free_text;
  v_charged_image := p_image_items - v_from_free_image;
  v_charged_units := v_charged_text * 1 + v_charged_image * v_image_wt;

  if v_charged_units > v_balance then
    return v_charged_units - v_balance;
  end if;

  update user_credits
  set free_used  = free_used + v_from_free_text + v_from_free_image,
      balance    = balance   - v_charged_units,
      updated_at = now()
  where user_id = p_user_id;

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
