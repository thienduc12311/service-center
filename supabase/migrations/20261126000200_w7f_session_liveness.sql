-- W7-JRN-D3: after a global sign-out the old access JWT kept reading
-- PostgREST and Storage until `exp` (the Express API already rejected it).
-- See docs/adr/0005-session-liveness-and-token-lifetime.md for the options,
-- measurements and the residual window.
--
-- Decision: check that the JWT's `session_id` still exists in auth.sessions
--   1. once per PostgREST request, in a `db-pre-request` hook (covers every
--      table, view and RPC without touching 266 policies / 100+ functions);
--   2. once per Storage statement, via one RESTRICTIVE policy on
--      storage.objects using an initplan `(select ...)`.
-- Realtime has no hook; it is bounded by the shorter `jwt_expiry`.
--
-- A token without a `session_id` claim (service role, anon, the Express
-- backend's admin client, SQL tests) is not session-bound and passes.

create or replace function private.session_live()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with claim as (
    select nullif(auth.jwt() ->> 'session_id', '')::uuid as session_id
  )
  select claim.session_id is null
      or exists (
        select 1 from auth.sessions s
         where s.id = claim.session_id
           and (s.not_after is null or s.not_after > now())
      )
    from claim;
$$;

revoke execute on function private.session_live() from public, anon;
grant execute on function private.session_live() to authenticated, service_role;

-- PostgREST pre-request hook. Lives in public because anon requests run it
-- too and anon has no USAGE on `private`. It exposes nothing: it only raises
-- 401 for a signed-out session and is a no-op otherwise.
create or replace function public.api_pre_request()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.session_live() then
    raise sqlstate 'PT401' using message = 'This session has ended. Sign in again.';
  end if;
end;
$$;

revoke execute on function public.api_pre_request() from public;
grant execute on function public.api_pre_request() to anon, authenticated, service_role;

alter role authenticator set pgrst.db_pre_request = 'public.api_pre_request';
notify pgrst, 'reload config';

-- Storage: one restrictive policy gates every command for signed-in users on
-- top of the existing permissive ones; evaluated once per statement.
drop policy if exists "session must be live" on storage.objects;
create policy "session must be live" on storage.objects
  as restrictive
  for all
  to authenticated
  using ((select private.session_live()))
  with check ((select private.session_live()));
