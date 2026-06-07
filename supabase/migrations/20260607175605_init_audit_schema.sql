-- Social-media audit tool — initial schema.
--
-- Design notes:
--  * Server-side processing, MINIMAL persistence: we store audit results +
--    decisions, never raw secrets, and treat uploaded archives as transient.
--  * v1 is TEXT-ONLY (no media/images). No media columns or media buckets.
--  * Ingestion can combine OAuth (recent + delete) and an uploaded X archive
--    (`tweets.js`, text only), so `source` lives on the post, not the job.
--  * Small fixed value-sets use text + CHECK (not PG enums) so the taxonomy can
--    evolve without migrations.
--  * As of 2026-05-30 new public tables are NOT auto-exposed to the Data API
--    roles, so every table needs explicit GRANTs in addition to RLS:
--      - `authenticated` for the browser client (RLS-scoped to the owner),
--      - `service_role` for the server worker (bypasses RLS).

-- Postgres 17 has gen_random_uuid() in core; no extension needed.

-- Keep updated_at fresh.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- connections: one row per linked platform account. No tokens here.
-- ---------------------------------------------------------------------------
create table public.connections (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  platform          text not null default 'x' check (platform in ('x')),
  handle            text not null,
  platform_user_id  text not null,
  scopes            text[] not null default '{}',
  status            text not null default 'active'
                      check (status in ('active', 'revoked', 'expired')),
  token_expires_at  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  revoked_at        timestamptz,
  unique (user_id, platform, platform_user_id)
);

create trigger connections_set_updated_at
  before update on public.connections
  for each row execute function public.set_updated_at();

alter table public.connections enable row level security;
create policy "connections_owner" on public.connections
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
grant select, insert, update, delete on public.connections to authenticated;
grant all on public.connections to service_role;

-- ---------------------------------------------------------------------------
-- connection_secrets: server-only OAuth token store.
-- Tokens are encrypted app-side (AES-GCM) before insert. A single encrypted
-- blob holds the token set with ONE nonce (avoids GCM nonce reuse). RLS is on
-- with NO policies and NO grant to `authenticated`, so only `service_role`
-- (which bypasses RLS) can read/write it.
-- ---------------------------------------------------------------------------
create table public.connection_secrets (
  connection_id  uuid primary key
                   references public.connections (id) on delete cascade,
  secret_enc     bytea not null,   -- AES-GCM ciphertext of {access, refresh, ...}
  secret_nonce   bytea not null,   -- 96-bit GCM nonce, unique per write
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger connection_secrets_set_updated_at
  before update on public.connection_secrets
  for each row execute function public.set_updated_at();

alter table public.connection_secrets enable row level security;
-- Intentionally no policies (RLS default-denies authenticated/anon). Local
-- Supabase still auto-grants new public tables to anon/authenticated (the cloud
-- default flipped to no-auto-grant on 2026-05-30), so revoke explicitly to keep
-- this server-only at the grant layer too, in every environment.
revoke all on public.connection_secrets from anon, authenticated;
grant all on public.connection_secrets to service_role;

-- ---------------------------------------------------------------------------
-- audit_jobs: one audit run.
-- ---------------------------------------------------------------------------
create table public.audit_jobs (
  job_id              uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  connection_id       uuid references public.connections (id) on delete set null,
  platform            text not null default 'x' check (platform in ('x')),
  enabled_categories  text[] not null,   -- defines what "unflagged" means
  status              text not null default 'queued'
                        check (status in ('queued', 'running', 'completed',
                                          'failed', 'canceled')),
  progress            jsonb not null
                        default '{"total":0,"processed":0,"flagged":0}'::jsonb,
  stats               jsonb,             -- per-category flagged counts
  archive_input_ref   text,              -- Storage path of uploaded tweets.js
  error               text,
  created_at          timestamptz not null default now(),
  started_at          timestamptz,
  finished_at         timestamptz,
  updated_at          timestamptz not null default now(),
  expires_at          timestamptz        -- retention / auto-purge
);

create index audit_jobs_user_created_idx
  on public.audit_jobs (user_id, created_at desc);
create index audit_jobs_status_idx on public.audit_jobs (status);

create trigger audit_jobs_set_updated_at
  before update on public.audit_jobs
  for each row execute function public.set_updated_at();

alter table public.audit_jobs enable row level security;
create policy "audit_jobs_owner" on public.audit_jobs
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
grant select, insert, update, delete on public.audit_jobs to authenticated;
grant all on public.audit_jobs to service_role;

-- ---------------------------------------------------------------------------
-- audited_posts: one row per scanned post.
-- `text` is stored with any detected secret masked in place. `user_id` is
-- denormalized for simple RLS + indexing. Deduped per job by platform_post_id.
-- ---------------------------------------------------------------------------
create table public.audited_posts (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references public.audit_jobs (job_id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  platform          text not null default 'x' check (platform in ('x')),
  platform_post_id  text not null,     -- tweet id; string (64-bit overflows number)
  url               text not null,
  author_handle     text not null,
  text              text not null,     -- redacted: secrets masked in place
  posted_at         timestamptz not null,
  source            text not null check (source in ('api', 'archive_upload')),
  flags             jsonb not null default '[]'::jsonb,
  decision          text not null default 'pending'
                      check (decision in ('pending', 'keep', 'delete',
                                          'deleted', 'failed')),
  decided_at        timestamptz,
  created_at        timestamptz not null default now(),
  unique (job_id, platform_post_id)
);

create index audited_posts_job_idx on public.audited_posts (job_id);
create index audited_posts_user_idx on public.audited_posts (user_id);
create index audited_posts_job_decision_idx
  on public.audited_posts (job_id, decision);
create index audited_posts_flags_idx
  on public.audited_posts using gin (flags jsonb_path_ops);

alter table public.audited_posts enable row level security;
create policy "audited_posts_owner" on public.audited_posts
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
grant select, insert, update, delete on public.audited_posts to authenticated;
grant all on public.audited_posts to service_role;

-- ---------------------------------------------------------------------------
-- deletion_log: immutable record of every delete performed on the user's
-- behalf. Client can read + insert, but not update/delete (no such policies).
-- ---------------------------------------------------------------------------
create table public.deletion_log (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  job_id            uuid references public.audit_jobs (job_id) on delete set null,
  post_id           uuid references public.audited_posts (id) on delete set null,
  platform_post_id  text not null,
  success           boolean not null,
  error             text,
  deleted_at        timestamptz not null default now()
);

create index deletion_log_user_deleted_idx
  on public.deletion_log (user_id, deleted_at desc);

alter table public.deletion_log enable row level security;
create policy "deletion_log_select_own" on public.deletion_log
  for select to authenticated
  using (auth.uid() = user_id);
create policy "deletion_log_insert_own" on public.deletion_log
  for insert to authenticated
  with check (auth.uid() = user_id);
grant select, insert on public.deletion_log to authenticated;
grant all on public.deletion_log to service_role;

-- ---------------------------------------------------------------------------
-- Storage: private bucket for the uploaded archive (text `tweets.js` only).
-- Objects are namespaced per user as `<auth.uid()>/<...>`.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('archives', 'archives', false, 52428800)  -- 50 MiB
on conflict (id) do nothing;

create policy "archives_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'archives'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "archives_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'archives'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "archives_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'archives'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
