-- W7-JRN-D3: a JWT whose session no longer exists is refused.
--   A. private.session_live(): live session, ended session, expired session,
--      token without a session_id claim (service role / anon / tests).
--   B. public.api_pre_request() (PostgREST hook): no-op for a live session or
--      a session-less token, 401 (PT401) for an ended session.
--   C. storage.objects: the restrictive "session must be live" policy hides
--      even a publicly readable object from an ended session; a live session
--      and the service role still read it.
-- Everything rolls back.
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/qa-w7f-sessions.sql
begin;

create temporary table sx (k text primary key, id uuid) on commit drop;
grant select on sx to authenticated, service_role, anon;
insert into sx values
  ('user', gen_random_uuid()), ('live', gen_random_uuid()), ('ended', gen_random_uuid()),
  ('expired', gen_random_uuid()), ('object', gen_random_uuid());

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'w7fsess-' || id || '@test.local', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  from sx where k = 'user';

insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
select l.id, u.id, now(), now(), null from sx l, sx u where l.k = 'live' and u.k = 'user';
insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
select l.id, u.id, now(), now(), now() - interval '1 minute' from sx l, sx u where l.k = 'expired' and u.k = 'user';
-- 'ended' has no auth.sessions row: that is what a global sign-out leaves.

insert into storage.objects (bucket_id, name, owner_id) values ('organization-logos', (select id from sx where k = 'object') || '/logo.png', null);

create or replace function pg_temp.claims_for(p_session text) returns text language sql stable as $$
  select json_strip_nulls(json_build_object(
    'sub', (select id from sx where k = 'user'), 'role', 'authenticated',
    'session_id', (select id from sx where k = p_session)))::text $$;

create or replace function pg_temp.as_session(p text) returns void language sql as
  $$ select set_config('request.jwt.claims', pg_temp.claims_for(p), true) $$;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not p_ok then raise exception 'FAILED: %', p_label; end if;
  raise notice 'ok: %', p_label;
end $$;

-- A ---------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_session('live');
select pg_temp.check(private.session_live(), 'A1 live session is live');
select pg_temp.as_session('ended');
select pg_temp.check(not private.session_live(), 'A2 ended session is not live');
select pg_temp.as_session('expired');
select pg_temp.check(not private.session_live(), 'A3 expired session is not live');
select set_config('request.jwt.claims', json_build_object('sub', (select id from sx where k = 'user'), 'role', 'authenticated')::text, true);
select pg_temp.check(private.session_live(), 'A4 token without session_id is not session-bound');

-- B ---------------------------------------------------------------------
select pg_temp.as_session('live');
select public.api_pre_request();
select pg_temp.as_session('ended');
do $$ begin
  perform public.api_pre_request();
  raise exception 'FAILED: B2 ended session passed the pre-request hook';
exception when sqlstate 'PT401' then
  raise notice 'ok: B2 ended session -> PT401';
end $$;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
reset role;
set local role anon;
select public.api_pre_request();
select pg_temp.check(true, 'B3 anon passes the hook');

-- C ---------------------------------------------------------------------
reset role;
set local role authenticated;
select pg_temp.as_session('live');
select pg_temp.check((select count(*) from storage.objects where bucket_id = 'organization-logos') >= 1, 'C1 live session reads the public logo object');
select pg_temp.as_session('ended');
select pg_temp.check((select count(*) from storage.objects where bucket_id = 'organization-logos') = 0, 'C2 ended session reads no storage object');
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select pg_temp.check((select count(*) from storage.objects where bucket_id = 'organization-logos') >= 1, 'C3 service role is unaffected');

rollback;
