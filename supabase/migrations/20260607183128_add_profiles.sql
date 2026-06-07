-- Reusable per-user demographic profile ("qualifying information").
-- Captured at intake, used to contextualize the audit and to prefill the intake
-- form on return. One row per user. This is sensitive (special-category) data,
-- so it is owner-only via RLS, same pattern as the init migration.

create table public.profiles (
  user_id             uuid primary key references auth.users (id) on delete cascade,
  age                 int not null check (age between 13 and 120),
  gender              text not null,
  race                text,
  sexual_orientation  text,
  country             text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();  -- defined in init migration

alter table public.profiles enable row level security;
create policy "profiles_owner" on public.profiles
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
grant select, insert, update, delete on public.profiles to authenticated;
grant all on public.profiles to service_role;
