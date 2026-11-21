-- QA wave 9 database fixes. Everything rolls back.
--   W9-RT-D1  the Realtime join policy refuses a signed-out session even with valid topic keys.
--   W9-API-D1 duplicate_plan / import_plan_contents compare a request hash with the idempotency key:
--             same key + same body replays, same key + another body is PT409 idempotency_key_reused.
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/qa-wave9-db-fixes.sql
begin;

create temporary table w9_fx (k text primary key, id uuid) on commit drop;
grant select on w9_fx to authenticated, anon;
insert into w9_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('sam', '33333333-3333-4333-8333-333333333333'),
  ('owner', '11111111-1111-4111-8111-111111111111'),
  ('plan', gen_random_uuid()), ('time', gen_random_uuid()), ('run', gen_random_uuid()),
  ('live_session', gen_random_uuid()), ('ended_session', gen_random_uuid()),
  ('expired_session', gen_random_uuid());

create function pg_temp.id_for(p text) returns uuid language sql stable as $$ select id from w9_fx where k = p $$;
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'W9 db fixes: %', label; end if;
end $$;
create function pg_temp.key_of(p_org uuid) returns text language sql stable security definer as $$
  select key from private.org_realtime_keys where organization_id = p_org $$;
grant execute on function pg_temp.key_of(uuid) to authenticated;
create function pg_temp.t(p_kind text, p_id uuid, p_key text) returns text language sql immutable as $$
  select p_kind || ':' || p_id || ':' || p_key $$;
create function pg_temp.readable(p_topic text) returns boolean language plpgsql as $$
begin
  perform set_config('realtime.topic', p_topic, true);
  return exists (select 1 from realtime.messages where topic = p_topic);
end $$;
-- Claims as a user's access token carries them; a null session means "not session-bound".
create function pg_temp.as_user(p_user text, p_session text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', '', true);
  select set_config('request.jwt.claims', json_strip_nulls(json_build_object(
           'sub', pg_temp.id_for(p_user), 'role', 'authenticated',
           'session_id', pg_temp.id_for(p_session)))::text, true) $$;

-- ==================================================================== W9-RT-D1 ===
insert into public.plans (id, organization_id, title, service_date, status)
  values (pg_temp.id_for('plan'), pg_temp.id_for('org'), 'W9 source plan', now(), 'published');
insert into public.plan_times (id, plan_id, kind, starts_at, ends_at)
  values (pg_temp.id_for('time'), pg_temp.id_for('plan'), 'service', now(), now() + interval '1 hour');
insert into public.live_runs (id, organization_id, plan_id, plan_time_id, time_starts_at, time_ends_at, snapshot, snapshot_revision, idempotency_key)
  values (pg_temp.id_for('run'), pg_temp.id_for('org'), pg_temp.id_for('plan'), pg_temp.id_for('time'),
          now(), now() + interval '1 hour', '[]', 1, 'w9-run');

-- A live and an expired session for sam; 'ended_session' has no row, which is what sign-out leaves.
insert into auth.sessions (id, user_id, created_at, updated_at, not_after) values
  (pg_temp.id_for('live_session'), pg_temp.id_for('sam'), now(), now(), null),
  (pg_temp.id_for('expired_session'), pg_temp.id_for('sam'), now(), now(), now() - interval '1 minute');

-- Valid, current topics for the org control channel, the plan and the run.
create temporary table w9_topics on commit drop as
  select k, pg_temp.t(k, case k when 'org' then pg_temp.id_for('org')
                                when 'live_plan' then pg_temp.id_for('plan')
                                else pg_temp.id_for('run') end,
                      pg_temp.key_of(pg_temp.id_for('org'))) as topic
    from unnest(array['org', 'live_plan', 'live_run']) as k;
grant select on w9_topics to authenticated;
-- The select policy only shows rows that exist, so give every topic a probe row.
select realtime.send('{}'::jsonb, 'probe', topic, true) from w9_topics;

set local role authenticated;

select pg_temp.as_user('sam', 'live_session');
select pg_temp.check(private.session_live(), 'live session is live');
select pg_temp.check(pg_temp.readable(topic), 'live session joins ' || k) from w9_topics;

select pg_temp.as_user('sam', 'ended_session');
select pg_temp.check(not private.session_live(), 'signed-out session is dead');
select pg_temp.check(not private.can_receive_resource_poke(topic), 'signed-out session refused by the function on ' || k) from w9_topics;
select pg_temp.check(not pg_temp.readable(topic), 'signed-out session cannot join ' || k) from w9_topics;

select pg_temp.as_user('sam', 'expired_session');
select pg_temp.check(not pg_temp.readable(topic), 'expired session cannot join ' || k) from w9_topics;

-- A token without session_id (not session-bound) behaves as before.
select pg_temp.as_user('sam', null);
select pg_temp.check(pg_temp.readable(topic), 'token without session_id joins ' || k) from w9_topics;

reset role;

-- =================================================================== W9-API-D1 ===
create temporary table w9_copy (k text primary key, id uuid, rev bigint) on commit drop;
grant select, insert on w9_copy to authenticated;

set local role authenticated;
select pg_temp.as_user('owner', null);

insert into w9_copy (k, id) select 'first',
  public.duplicate_plan(pg_temp.id_for('plan'), '2027-09-01T15:00:00Z', null, true, 'w9-dup-key-0001', null);
select pg_temp.check((select id from w9_copy where k = 'first') is not null, 'duplicate creates a plan');
select pg_temp.check((select request_hash from public.plan_copy_operations
                       where organization_id = pg_temp.id_for('org') and idempotency_key = 'w9-dup-key-0001') ~ '^[0-9a-f]{32}$',
  'duplicate stores a request hash');

-- Same key, same body: replay.
select pg_temp.check(public.duplicate_plan(pg_temp.id_for('plan'), '2027-09-01T15:00:00Z', null, true, 'w9-dup-key-0001', null)
  = (select id from w9_copy where k = 'first'), 'same key + same body replays the first copy');
-- The same instant in another offset, and a blank title, are the same request.
select pg_temp.check(public.duplicate_plan(pg_temp.id_for('plan'), '2027-09-01T17:00:00+02:00', '  ', true, 'w9-dup-key-0001', null)
  = (select id from w9_copy where k = 'first'), 'same instant + blank title replays');

-- Same key, different body: PT409 idempotency_key_reused.
do $$
declare v_hint text;
begin
  perform public.duplicate_plan(pg_temp.id_for('plan'), '2027-09-08T15:00:00Z', null, true, 'w9-dup-key-0001', null);
  raise exception 'W9 db fixes: same key + other service_date was not refused';
exception when sqlstate 'PT409' then
  get stacked diagnostics v_hint = pg_exception_hint;
  perform pg_temp.check(v_hint = 'idempotency_key_reused', 'duplicate mismatch hint is idempotency_key_reused');
end $$;
do $$
begin
  perform public.duplicate_plan(pg_temp.id_for('plan'), '2027-09-01T15:00:00Z', 'Other title', true, 'w9-dup-key-0001', null);
  raise exception 'W9 db fixes: same key + other title was not refused';
exception when sqlstate 'PT409' then null;
end $$;
do $$
begin
  perform public.duplicate_plan(pg_temp.id_for('plan'), '2027-09-01T15:00:00Z', null, false, 'w9-dup-key-0001', null);
  raise exception 'W9 db fixes: same key + other copy_assignments was not refused';
exception when sqlstate 'PT409' then null;
end $$;
select pg_temp.check((select count(*) from public.plans where organization_id = pg_temp.id_for('org')
                       and title = 'W9 source plan' and id <> pg_temp.id_for('plan')) = 1, 'exactly one copy exists');

-- A legacy row without a hash keeps replaying (no backfill).
reset role;
insert into public.plan_copy_operations (organization_id, idempotency_key, kind, source_plan_id, target_plan_id, created_by)
  values (pg_temp.id_for('org'), 'w9-dup-legacy-01', 'duplicate', pg_temp.id_for('plan'),
          (select id from w9_copy where k = 'first'), pg_temp.id_for('owner'));
set local role authenticated;
select pg_temp.as_user('owner', null);
select pg_temp.check(public.duplicate_plan(pg_temp.id_for('plan'), '2030-01-01T00:00:00Z', null, true, 'w9-dup-legacy-01', null)
  = (select id from w9_copy where k = 'first'), 'legacy unhashed key still replays');

-- import_plan_contents: same contract.
insert into w9_copy (k, rev) select 'import',
  public.import_plan_contents((select id from w9_copy where k = 'first'), pg_temp.id_for('plan'),
                              true, false, false, null, 'w9-imp-key-0001', null);
select pg_temp.check((select request_hash from public.plan_copy_operations
                       where organization_id = pg_temp.id_for('org') and idempotency_key = 'w9-imp-key-0001') ~ '^[0-9a-f]{32}$',
  'import stores a request hash');
select pg_temp.check(public.import_plan_contents((select id from w9_copy where k = 'first'), pg_temp.id_for('plan'),
                       true, false, false, (select rev from w9_copy where k = 'import'), 'w9-imp-key-0001', null)
  = (select rev from w9_copy where k = 'import'), 'import same key + same body replays');
do $$
declare v_hint text;
begin
  perform public.import_plan_contents((select id from w9_copy where k = 'first'), pg_temp.id_for('plan'),
                                      true, true, true, null, 'w9-imp-key-0001', null);
  raise exception 'W9 db fixes: import same key + other body was not refused';
exception when sqlstate 'PT409' then
  get stacked diagnostics v_hint = pg_exception_hint;
  perform pg_temp.check(v_hint = 'idempotency_key_reused', 'import mismatch hint is idempotency_key_reused');
end $$;

reset role;

-- claim_plan_copy_key grants are unchanged: no PUBLIC/anon execute, authenticated may.
select pg_temp.check(not has_function_privilege('anon', 'private.claim_plan_copy_key(uuid,text,text,uuid,uuid,text)', 'execute'),
  'anon cannot execute claim_plan_copy_key');
select pg_temp.check(has_function_privilege('authenticated', 'private.claim_plan_copy_key(uuid,text,text,uuid,uuid,text)', 'execute'),
  'authenticated can execute claim_plan_copy_key');

rollback;
