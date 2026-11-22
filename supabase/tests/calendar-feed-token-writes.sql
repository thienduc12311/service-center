-- W10-FGH-D7 / W10-FGH-D8 regression suite (20261201000100_calendar_feed_token_writes).
-- Fails on the schema before that migration:
--   A. a member cannot insert, overwrite token_hash, un-revoke or delete their
--      own calendar_feed_tokens row through PostgREST, nor read token_hash.
--   B. rotate_calendar_feed_token issues a database-generated token whose
--      SHA-256 hex is stored, and revokes the previous one.
--   C. revoke_calendar_feed_token revokes without a replacement (idempotent);
--      a later rotate issues a fresh token.
--   D. a non-member cannot rotate or revoke in that church; anon cannot call either.
-- Self-contained fixtures; everything rolls back.
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/calendar-feed-token-writes.sql
begin;

create temporary table cft_fx (k text primary key, id uuid) on commit drop;
grant select on cft_fx to authenticated, anon;
create temporary table cft_tokens (k text primary key, token text) on commit drop;
grant select, insert on cft_tokens to authenticated;

insert into cft_fx values
  ('org', gen_random_uuid()),
  ('member', gen_random_uuid()),
  ('outsider', gen_random_uuid());

create or replace function pg_temp.fx(p text) returns uuid language sql stable as
  $$ select id from cft_fx where k = p $$;

create or replace function pg_temp.expect_error(p_sql text, p_state text, p_label text)
returns void language plpgsql as $$
declare v_state text;
begin
  execute p_sql;
  raise exception '%: expected % but it succeeded', p_label, p_state;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate;
  if v_state <> p_state then
    raise exception '%: expected % but got % (%)', p_label, p_state, v_state, sqlerrm;
  end if;
end $$;

create or replace function pg_temp.act_as(p text) returns void language sql as
  $$ select set_config('request.jwt.claims', json_build_object('sub', pg_temp.fx(p), 'role', 'authenticated')::text, true) $$;

-- ------------------------------------------------------------- fixtures ---
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.fx(k), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'cft.' || k || '@example.test', 'x', now(), '{"provider":"email","providers":["email"]}',
       json_build_object('full_name', 'Cft ' || initcap(k))::jsonb, now(), now()
  from unnest(array['member', 'outsider']) k;

insert into public.organizations (id, name, slug, timezone) values
  (pg_temp.fx('org'), 'Cft Church', 'cft-church-' || left(pg_temp.fx('org')::text, 8), 'America/Toronto');
insert into public.organization_members (organization_id, user_id, role, status) values
  (pg_temp.fx('org'), pg_temp.fx('member'), 'member', 'active');

-- A revoked token of the member's (the one QA revived) and a live one.
insert into public.calendar_feed_tokens (organization_id, user_id, token_hash, revoked_at) values
  (pg_temp.fx('org'), pg_temp.fx('member'), 'cft-revoked-hash', now() - interval '1 day'),
  (pg_temp.fx('org'), pg_temp.fx('member'), 'cft-live-hash', null);

-- ============================================ A. no direct writes
set local role authenticated;
select pg_temp.act_as('member');
select pg_temp.expect_error(format(
  'update public.calendar_feed_tokens set token_hash = ''attacker-chosen'' where organization_id = %L and user_id = %L',
  pg_temp.fx('org'), pg_temp.fx('member')), '42501', 'A1 member overwrites own token_hash');
select pg_temp.expect_error(format(
  'update public.calendar_feed_tokens set revoked_at = null where organization_id = %L and user_id = %L and revoked_at is not null',
  pg_temp.fx('org'), pg_temp.fx('member')), '42501', 'A2 member un-revokes a revoked token');
select pg_temp.expect_error(format(
  'insert into public.calendar_feed_tokens (organization_id, user_id, token_hash) values (%L, %L, ''attacker-chosen'')',
  pg_temp.fx('org'), pg_temp.fx('member')), '42501', 'A3 member inserts a token with a chosen hash');
select pg_temp.expect_error(format(
  'delete from public.calendar_feed_tokens where user_id = %L', pg_temp.fx('member')), '42501', 'A4 member deletes token rows');
select pg_temp.expect_error(format(
  'select token_hash from public.calendar_feed_tokens where user_id = %L', pg_temp.fx('member')), '42501', 'A5 member reads token_hash');

do $$
declare n integer;
begin
  -- The API's "is a feed live?" read still works with the caller's client.
  select count(*) into n from public.calendar_feed_tokens
   where organization_id = pg_temp.fx('org') and user_id = pg_temp.fx('member') and revoked_at is null;
  if n <> 1 then raise exception 'A6 member cannot see their live token (% rows)', n; end if;
end $$;

reset role;
do $$ begin
  if not exists (select 1 from public.calendar_feed_tokens where token_hash = 'cft-revoked-hash' and revoked_at is not null) then
    raise exception 'A7 the revoked token was revived';
  end if;
end $$;

-- ============================================ B. rotate
set local role authenticated;
select pg_temp.act_as('member');
insert into cft_tokens values ('first', public.rotate_calendar_feed_token(pg_temp.fx('org')));
insert into cft_tokens values ('second', public.rotate_calendar_feed_token(pg_temp.fx('org')));

reset role;
do $$
declare
  v_first text := (select token from cft_tokens where k = 'first');
  v_second text := (select token from cft_tokens where k = 'second');
  v_live integer;
begin
  if v_first !~ '^[A-Za-z0-9_-]{43}$' or v_second !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'B1 rotate returned a token that is not 32 bytes of base64url (%)', v_first;
  end if;
  if v_first = v_second then raise exception 'B2 rotate returned the same token twice'; end if;
  if not exists (select 1 from public.calendar_feed_tokens
                  where token_hash = encode(sha256(convert_to(v_second, 'UTF8')), 'hex') and revoked_at is null) then
    raise exception 'B3 the live row does not hold the SHA-256 hex of the returned token';
  end if;
  if not exists (select 1 from public.calendar_feed_tokens
                  where token_hash = encode(sha256(convert_to(v_first, 'UTF8')), 'hex') and revoked_at is not null) then
    raise exception 'B4 rotating did not revoke the previous token';
  end if;
  if exists (select 1 from public.calendar_feed_tokens where token_hash = 'cft-live-hash' and revoked_at is null) then
    raise exception 'B5 the pre-existing live token survived a rotation';
  end if;
  select count(*) into v_live from public.calendar_feed_tokens
   where organization_id = pg_temp.fx('org') and user_id = pg_temp.fx('member') and revoked_at is null;
  if v_live <> 1 then raise exception 'B6 expected one live token, found %', v_live; end if;
end $$;

-- ============================================ C. revoke without replacement
set local role authenticated;
select pg_temp.act_as('member');
do $$ begin
  if not public.revoke_calendar_feed_token(pg_temp.fx('org')) then
    raise exception 'C1 revoke reported nothing to revoke';
  end if;
  if public.revoke_calendar_feed_token(pg_temp.fx('org')) then
    raise exception 'C2 a second revoke found a live token';
  end if;
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.calendar_feed_tokens
              where organization_id = pg_temp.fx('org') and user_id = pg_temp.fx('member') and revoked_at is null) then
    raise exception 'C3 a live token remains after revoke';
  end if;
end $$;
set local role authenticated;
select pg_temp.act_as('member');
insert into cft_tokens values ('third', public.rotate_calendar_feed_token(pg_temp.fx('org')));
reset role;
do $$ begin
  if not exists (select 1 from public.calendar_feed_tokens
                  where token_hash = encode(sha256(convert_to((select token from cft_tokens where k = 'third'), 'UTF8')), 'hex')
                    and revoked_at is null) then
    raise exception 'C4 rotate after revoke did not issue a fresh live token';
  end if;
end $$;

-- ============================================ D. members only
set local role authenticated;
select pg_temp.act_as('outsider');
select pg_temp.expect_error(format('select public.rotate_calendar_feed_token(%L)', pg_temp.fx('org')), 'P0002', 'D1 outsider rotates');
select pg_temp.expect_error(format('select public.revoke_calendar_feed_token(%L)', pg_temp.fx('org')), 'P0002', 'D2 outsider revokes');
reset role;
set local role anon;
select pg_temp.expect_error(format('select public.rotate_calendar_feed_token(%L)', pg_temp.fx('org')), '42501', 'D3 anon rotates');
reset role;

select 'calendar-feed-token-writes: all sections passed' as result;
rollback;
