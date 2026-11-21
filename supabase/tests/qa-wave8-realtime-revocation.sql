-- QA wave 8 W8-INT-D5: Realtime topics carry a per-organization key that rotates when a member
-- is deactivated, demoted, removed or loses a session, so a removed member's open socket stops
-- receiving and cannot rejoin. Everything rolls back.
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/qa-wave8-realtime-revocation.sql
begin;

create temporary table rr_fx (k text primary key, id uuid) on commit drop;
grant select on rr_fx to authenticated, anon;
insert into rr_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('band', 'cccccccc-0000-4000-8000-000000000001'),
  ('sam', '33333333-3333-4333-8333-333333333333'),
  ('owner', '11111111-1111-4111-8111-111111111111'),
  ('chat', gen_random_uuid()), ('plan', gen_random_uuid()), ('time', gen_random_uuid()),
  ('run', gen_random_uuid()), ('new_org', gen_random_uuid()), ('session', gen_random_uuid());

create function pg_temp.id_for(p text) returns uuid language sql stable as $$ select id from rr_fx where k = p $$;
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'W8-INT-D5: %', label; end if;
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
-- Allow another rotation inside this transaction (production rotates once per transaction).
create function pg_temp.reset_rotation() returns void language sql as $$
  update private.org_realtime_keys set rotated_at = rotated_at - interval '1 minute' $$;

delete from public.conversations where team_id = pg_temp.id_for('band');
insert into public.conversations (id, organization_id, kind, team_id)
  values (pg_temp.id_for('chat'), pg_temp.id_for('org'), 'team', pg_temp.id_for('band'));
insert into public.plans (id, organization_id, title, service_date, status)
  values (pg_temp.id_for('plan'), pg_temp.id_for('org'), 'Realtime plan', now(), 'published');
insert into public.plan_times (id, plan_id, kind, starts_at, ends_at)
  values (pg_temp.id_for('time'), pg_temp.id_for('plan'), 'service', now(), now() + interval '1 hour');
insert into public.live_runs (id, organization_id, plan_id, plan_time_id, time_starts_at, time_ends_at, snapshot, snapshot_revision, idempotency_key)
  values (pg_temp.id_for('run'), pg_temp.id_for('org'), pg_temp.id_for('plan'), pg_temp.id_for('time'), now(), now() + interval '1 hour', '[]', 1, 'rr-run');
select pg_temp.reset_rotation();

-- Every organization has a well-formed key, and a new one gets one.
select pg_temp.check(not exists (select 1 from public.organizations o
  where not exists (select 1 from private.org_realtime_keys k where k.organization_id = o.id and k.key ~ '^[0-9a-f]{64}$')),
  'every organization has a 64 hex character key');
insert into public.organizations (id, name, slug) values (pg_temp.id_for('new_org'), 'Key test', 'w8-int-d5-key-test');
select pg_temp.check(pg_temp.key_of(pg_temp.id_for('new_org')) ~ '^[0-9a-f]{64}$', 'new organization gets a key');

create temporary table rr_keys on commit drop as select pg_temp.key_of(pg_temp.id_for('org')) as k1;
grant select on rr_keys to authenticated, anon;

-- The select policy only shows rows that exist, so give every topic under test a probe row.
create function pg_temp.probe(p_kind text, p_id uuid, p_key text) returns void language sql as $$
  select realtime.send('{}'::jsonb, 'probe', pg_temp.t(p_kind, p_id, p_key), true) $$;
select pg_temp.probe('org', pg_temp.id_for('org'), (select k1 from rr_keys)),
       pg_temp.probe('org', pg_temp.id_for('new_org'), pg_temp.key_of(pg_temp.id_for('new_org'))),
       pg_temp.probe('live_plan', pg_temp.id_for('plan'), (select k1 from rr_keys)),
       pg_temp.probe('conversation', pg_temp.id_for('chat'), (select k1 from rr_keys));

-- Pokes go to the keyed topic only, with id and event only.
update public.live_runs set revision = revision + 1 where id = pg_temp.id_for('run');
select pg_temp.check(exists (select 1 from realtime.messages
  where topic = pg_temp.t('live_run', pg_temp.id_for('run'), (select k1 from rr_keys))), 'poke sent to the keyed topic');
select pg_temp.check(not exists (select 1 from realtime.messages where topic = 'live_run:' || pg_temp.id_for('run')),
  'no poke on the unkeyed topic');

-- ============================================================ member access ===
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
select pg_temp.check(public.realtime_topic_key(pg_temp.id_for('org')) = (select k1 from rr_keys), 'active member is served the key');
select pg_temp.check(public.realtime_topic_key(pg_temp.id_for('new_org')) is null, 'non-member gets no key');
select pg_temp.check(pg_temp.readable(pg_temp.t('org', pg_temp.id_for('org'), (select k1 from rr_keys))), 'control topic readable');
select pg_temp.check(pg_temp.readable(pg_temp.t('live_plan', pg_temp.id_for('plan'), (select k1 from rr_keys))), 'plan topic readable');
select pg_temp.check(pg_temp.readable(pg_temp.t('live_run', pg_temp.id_for('run'), (select k1 from rr_keys))), 'run topic readable');
select pg_temp.check(not pg_temp.readable(pg_temp.t('live_run', pg_temp.id_for('run'), repeat('0', 64))), 'wrong key denied');
select pg_temp.check(not pg_temp.readable('live_run:' || pg_temp.id_for('run')), 'unkeyed topic denied');
select pg_temp.check(not pg_temp.readable(pg_temp.t('org', pg_temp.id_for('new_org'), pg_temp.key_of(pg_temp.id_for('new_org')))),
  'foreign organization control topic denied');
select pg_temp.check(not has_table_privilege('private.org_realtime_keys', 'select'), 'clients cannot read the key table');
select pg_temp.check(not has_function_privilege('private.rotate_org_realtime_key(uuid)', 'execute'), 'clients cannot rotate');
set local role anon;
select pg_temp.check(not pg_temp.readable(pg_temp.t('org', pg_temp.id_for('org'), (select k1 from rr_keys))), 'anonymous denied');
reset role;

-- ================================================== deactivation revokes at once ===
update public.organization_members set status = 'inactive'
 where organization_id = pg_temp.id_for('org') and user_id = pg_temp.id_for('sam');
create temporary table rr_keys2 on commit drop as select pg_temp.key_of(pg_temp.id_for('org')) as k2;
grant select on rr_keys2 to authenticated;
select pg_temp.check((select k2 from rr_keys2) <> (select k1 from rr_keys), 'deactivation rotates the key');
select pg_temp.check((select count(*) = 1 from realtime.messages
  where topic = pg_temp.t('org', pg_temp.id_for('org'), (select k1 from rr_keys)) and event = 'changed'
    -- realtime.send adds the message's own random id to the payload.
    and (payload - 'id') = jsonb_build_object('event', 'rekey') and private), 'one id-free rekey poke on the old control topic');

select pg_temp.probe('org', pg_temp.id_for('org'), (select k2 from rr_keys2)),
       pg_temp.probe('live_plan', pg_temp.id_for('plan'), (select k2 from rr_keys2)),
       pg_temp.probe('conversation', pg_temp.id_for('chat'), (select k2 from rr_keys2));
-- Later changes are poked to the new topic and never to the old one the removed socket holds.
select pg_temp.reset_rotation();
create temporary table rr_old_count on commit drop as
  select count(*) as n from realtime.messages
   where topic = pg_temp.t('live_run', pg_temp.id_for('run'), (select k1 from rr_keys));
update public.live_runs set revision = revision + 1 where id = pg_temp.id_for('run');
select pg_temp.check(exists (select 1 from realtime.messages
  where topic = pg_temp.t('live_run', pg_temp.id_for('run'), (select k2 from rr_keys2))), 'later poke uses the new key');
select pg_temp.check((select count(*) from realtime.messages
  where topic = pg_temp.t('live_run', pg_temp.id_for('run'), (select k1 from rr_keys))) = (select n from rr_old_count),
  'later poke is not sent to the old key');

set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
select pg_temp.check(public.realtime_topic_key(pg_temp.id_for('org')) is null, 'deactivated member is no longer served a key');
select pg_temp.check(not pg_temp.readable(pg_temp.t('org', pg_temp.id_for('org'), (select k2 from rr_keys2))), 'deactivated member cannot join control with the new key');
select pg_temp.check(not pg_temp.readable(pg_temp.t('live_plan', pg_temp.id_for('plan'), (select k2 from rr_keys2))), 'deactivated member cannot join plan topic');
select pg_temp.check(not pg_temp.readable(pg_temp.t('live_run', pg_temp.id_for('run'), (select k2 from rr_keys2))), 'deactivated member cannot join run topic');
select pg_temp.check(not pg_temp.readable(pg_temp.t('conversation', pg_temp.id_for('chat'), (select k2 from rr_keys2))), 'deactivated member cannot join chat topic');
select pg_temp.check(not pg_temp.readable(pg_temp.t('live_run', pg_temp.id_for('run'), (select k1 from rr_keys))), 'deactivated member cannot rejoin the old topic');
-- A still-active member keeps access with the new key.
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
select pg_temp.check(public.realtime_topic_key(pg_temp.id_for('org')) = (select k2 from rr_keys2), 'active member is served the new key');
select pg_temp.check(pg_temp.readable(pg_temp.t('live_run', pg_temp.id_for('run'), (select k2 from rr_keys2))), 'active member joins the new run topic');
select pg_temp.check(not pg_temp.readable(pg_temp.t('live_run', pg_temp.id_for('run'), (select k1 from rr_keys))), 'old key no longer joins');
reset role;

-- Reactivating does not restore the old key.
select pg_temp.reset_rotation();
update public.organization_members set status = 'active'
 where organization_id = pg_temp.id_for('org') and user_id = pg_temp.id_for('sam');
select pg_temp.check(pg_temp.key_of(pg_temp.id_for('org')) = (select k2 from rr_keys2), 'inactive to active does not rotate');

-- ======================================================= other revocation paths ===
select pg_temp.reset_rotation();
create temporary table rr_k as select pg_temp.key_of(pg_temp.id_for('org')) as k;
update public.organization_members set role = 'scheduler'
 where organization_id = pg_temp.id_for('org') and user_id = pg_temp.id_for('sam');
select pg_temp.check(pg_temp.key_of(pg_temp.id_for('org')) <> (select k from rr_k), 'role change rotates');

select pg_temp.reset_rotation();
update rr_k set k = pg_temp.key_of(pg_temp.id_for('org'));
delete from public.organization_members
 where organization_id = pg_temp.id_for('org') and user_id = pg_temp.id_for('sam');
select pg_temp.check(pg_temp.key_of(pg_temp.id_for('org')) <> (select k from rr_k), 'removing an active member rotates');

-- Deleting an auth session rotates the key of the user's organizations.
select pg_temp.reset_rotation();
update rr_k set k = pg_temp.key_of(pg_temp.id_for('org'));
insert into auth.sessions (id, user_id) values (pg_temp.id_for('session'), pg_temp.id_for('owner'));
delete from auth.sessions where id = pg_temp.id_for('session');
select pg_temp.check(pg_temp.key_of(pg_temp.id_for('org')) <> (select k from rr_k), 'deleting a session rotates');

-- A member who is not active does not rotate anything when removed.
select pg_temp.reset_rotation();
update rr_k set k = pg_temp.key_of(pg_temp.id_for('org'));
insert into public.organization_members (organization_id, user_id, role, status)
  select pg_temp.id_for('org'), p.id, 'member', 'invited' from public.profiles p
   where p.id not in (select user_id from public.organization_members where organization_id = pg_temp.id_for('org')) limit 1;
delete from public.organization_members where organization_id = pg_temp.id_for('org') and status = 'invited';
select pg_temp.check(pg_temp.key_of(pg_temp.id_for('org')) = (select k from rr_k), 'removing an invited member does not rotate');

-- Deleting an organization (its active members cascade) must not fail on key rotation.
reset role;
insert into public.organizations (id, name, slug) values (pg_temp.id_for('new_org') , 'Doomed org', 'w8-rr-doomed-' || left(pg_temp.id_for('new_org')::text, 8))
  on conflict (id) do nothing;
insert into public.organization_members (organization_id, user_id, role, status)
  values (pg_temp.id_for('new_org'), pg_temp.id_for('owner'), 'owner', 'active')
  on conflict do nothing;
delete from public.organizations where id = pg_temp.id_for('new_org');
select pg_temp.check(not exists (select 1 from public.organizations where id = pg_temp.id_for('new_org')), 'an organization with active members can be deleted');
select pg_temp.check(not exists (select 1 from private.org_realtime_keys where organization_id = pg_temp.id_for('new_org')), 'a deleted organization keeps no key');

rollback;
