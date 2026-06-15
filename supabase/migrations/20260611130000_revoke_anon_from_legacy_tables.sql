-- Revoke anon/authenticated from tables that pre-date the explicit-revoke
-- convention (established for connection_secrets in the init migration).
-- Local Supabase auto-grants new public tables to anon + authenticated, but
-- hosted Supabase (since 2026-05-30) does not. This migration makes the grant
-- surface identical in all environments.
--
-- Each table keeps its existing RLS policies; this only tightens the explicit
-- GRANT layer to match the pattern used by every later migration.

-- connections (init migration, no revoke before grant)
revoke all on public.connections from anon, authenticated;
grant select, insert, update, delete on public.connections to authenticated;
grant all on public.connections to service_role;

-- audit_jobs (init migration, no revoke before grant)
revoke all on public.audit_jobs from anon, authenticated;
grant select, insert, update, delete on public.audit_jobs to authenticated;
grant all on public.audit_jobs to service_role;

-- audited_posts (init migration, no revoke before grant)
revoke all on public.audited_posts from anon, authenticated;
grant select, insert, update, delete on public.audited_posts to authenticated;
grant all on public.audited_posts to service_role;

-- deletion_log (init migration, no revoke before grant)
revoke all on public.deletion_log from anon, authenticated;
grant select, insert on public.deletion_log to authenticated;
grant all on public.deletion_log to service_role;

-- profiles (20260607183128, no revoke before grant)
revoke all on public.profiles from anon, authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant all on public.profiles to service_role;
