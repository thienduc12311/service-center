-- P0 (QA wave 2 follow-up): `public.people_directory` is a simple, therefore
-- auto-updatable, view owned by postgres without security_invoker. Supabase's
-- default privileges had granted `authenticated` INSERT/UPDATE/DELETE (and
-- TRUNCATE/TRIGGER/REFERENCES) on it, so any member could edit or delete any
-- Person in their organization through PATCH/DELETE /rest/v1/people_directory,
-- bypassing the owner-only People policies (the view's writes run with the
-- owner's rights).
--
-- The directory is a read-only projection; nothing writes through it. An
-- audit of every view in `public` (pg_views x role_table_grants, updatable
-- per pg_relation_is_updatable) found no other view with write grants.
--
-- Note for future views: Supabase's default privileges grant ALL on new
-- relations in `public` to anon/authenticated/service_role. Every new view
-- must revoke writes explicitly (supabase/tests/qa-wave2-fixes.sql checks
-- that no public view grants writes to API roles).

revoke insert, update, delete, truncate, trigger, references
  on public.people_directory from authenticated, anon, public, service_role;
grant select on public.people_directory to authenticated, service_role;
