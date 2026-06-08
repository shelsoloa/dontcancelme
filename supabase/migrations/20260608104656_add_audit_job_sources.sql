-- Which timeline content an audit pulls: the user's own posts, posts they've
-- liked, and/or posts they've reposted. Existing jobs default to own-posts-only,
-- preserving prior behavior. Column add on an existing table needs no new grants.
alter table public.audit_jobs
  add column enabled_sources text[] not null default '{posts}';
