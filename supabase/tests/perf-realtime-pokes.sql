-- Run with psql -v ON_ERROR_STOP=1 against an isolated, seeded local project.
begin;

create temporary table poke_fixture (name text primary key, id uuid) on commit drop;
grant select on poke_fixture to authenticated, anon;
insert into poke_fixture values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('band', 'cccccccc-0000-4000-8000-000000000001'),
  ('sam', '33333333-3333-4333-8333-333333333333'),
  ('other_org', gen_random_uuid()), ('other_team', gen_random_uuid()),
  ('chat', gen_random_uuid()), ('other_chat', gen_random_uuid()), ('message', gen_random_uuid()),
  ('plan', gen_random_uuid()), ('other_plan', gen_random_uuid()), ('time', gen_random_uuid()),
  ('run', gen_random_uuid()), ('other_run', gen_random_uuid());

create function pg_temp.id_for(p_name text) returns uuid language sql stable as $$
  select id from poke_fixture where name = p_name;
$$;
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'PERF-008: %', label; end if;
end;
$$;
-- Topics carry the organization's realtime key (captured once, before any rotation).
create temporary table poke_key on commit drop as
  select key from private.org_realtime_keys where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001';
grant select on poke_key to authenticated, anon;
-- A conversation topic also carries the conversation's own key (created when a member is first
-- issued the topic; see qa-wave8-realtime-resource-revocation.sql).
create function pg_temp.t(p_kind text, p_id uuid) returns text language sql stable security definer as $$
  select p_kind || ':' || p_id || ':' || (select key from poke_key)
    || case when p_kind = 'conversation'
         then ':' || coalesce((select k.key from private.conversation_realtime_keys k where k.conversation_id = p_id), repeat('0', 64))
         else '' end;
$$;
grant execute on function pg_temp.t(text, uuid) to authenticated, anon;
create function pg_temp.topic_is_readable(p_topic text) returns boolean language plpgsql as $$
begin
  perform set_config('realtime.topic', p_topic, true);
  return exists (select 1 from realtime.messages where topic = p_topic);
end;
$$;

insert into public.organizations (id, name, slug)
  values (pg_temp.id_for('other_org'), 'Poke test', 'perf-008-test');
insert into public.teams (id, organization_id, name)
  values (pg_temp.id_for('other_team'), pg_temp.id_for('other_org'), 'Private');
delete from public.conversations where team_id = pg_temp.id_for('band');
insert into public.conversations (id, organization_id, kind, team_id)
  values (pg_temp.id_for('chat'), pg_temp.id_for('org'), 'team', pg_temp.id_for('band')),
         (pg_temp.id_for('other_chat'), pg_temp.id_for('other_org'), 'team', pg_temp.id_for('other_team'));
insert into private.conversation_realtime_keys (conversation_id) values (pg_temp.id_for('chat'));
insert into public.conversation_messages (id, organization_id, conversation_id, author_id, body)
  values (pg_temp.id_for('message'), pg_temp.id_for('org'), pg_temp.id_for('chat'), pg_temp.id_for('sam'), 'private text'),
         (gen_random_uuid(), pg_temp.id_for('other_org'), pg_temp.id_for('other_chat'), pg_temp.id_for('sam'), 'other private text');
update public.conversation_messages set body = 'edited', edited_at = now() where id = pg_temp.id_for('message');
update public.conversation_messages set body = '', hidden_at = now() where id = pg_temp.id_for('message');
update public.conversation_messages set hidden_at = null, deleted_at = now() where id = pg_temp.id_for('message');
delete from public.conversation_messages where id = pg_temp.id_for('message');

insert into public.plans (id, organization_id, title, service_date, status)
  values (pg_temp.id_for('plan'), pg_temp.id_for('org'), 'Local plan', now(), 'published'),
         (pg_temp.id_for('other_plan'), pg_temp.id_for('other_org'), 'Other plan', now(), 'published');
insert into public.plan_times (id, plan_id, kind, starts_at, ends_at)
  values (pg_temp.id_for('time'), pg_temp.id_for('plan'), 'service', now(), now() + interval '1 hour');
insert into public.live_runs (id, organization_id, plan_id, plan_time_id, time_starts_at, time_ends_at, snapshot, snapshot_revision, idempotency_key)
  values (pg_temp.id_for('run'), pg_temp.id_for('org'), pg_temp.id_for('plan'), pg_temp.id_for('time'), now(), now() + interval '1 hour', '[]', 1, 'run'),
         (pg_temp.id_for('other_run'), pg_temp.id_for('other_org'), pg_temp.id_for('other_plan'), null, now(), now(), '[]', 1, 'run');
update public.live_runs set status = 'live', current_index = 0, current_started_at = now(), started_at = now(),
   revision = revision + 1 where id = pg_temp.id_for('run');
update public.live_runs set revision = revision + 1 where id = pg_temp.id_for('run');

select pg_temp.check((select count(*) = 5 from realtime.messages where topic = pg_temp.t('conversation', pg_temp.id_for('chat'))),
  'create, edit, hide, soft delete and hard delete each notify');
select pg_temp.check((select count(*) = 3 from realtime.messages where topic = pg_temp.t('live_run', pg_temp.id_for('run'))),
  'creation and state revisions notify the run');
select pg_temp.check((select count(*) = 3 from realtime.messages where topic = pg_temp.t('live_plan', pg_temp.id_for('plan'))),
  'service time creation, run creation and status changes notify discovery; other run revisions do not');

update public.plans set content_revision = content_revision + 1 where id = pg_temp.id_for('plan');
update public.plan_times set ends_at = ends_at + interval '10 minutes' where id = pg_temp.id_for('time');
select pg_temp.check((select count(*) = 5 from realtime.messages where topic = pg_temp.t('live_run', pg_temp.id_for('run'))),
  'a plan revision and an actual time change notify the open run');
select pg_temp.check((select count(*) = 5 from realtime.messages where topic = pg_temp.t('live_plan', pg_temp.id_for('plan'))),
  'a plan revision and an actual time change notify discovery');
select pg_temp.check(not exists (
  select 1 from realtime.messages
  where topic in (pg_temp.t('conversation', pg_temp.id_for('chat')), pg_temp.t('live_plan', pg_temp.id_for('plan')), pg_temp.t('live_run', pg_temp.id_for('run')))
    and (private is distinct from true or extension <> 'broadcast' or event <> 'changed'
      or payload is distinct from jsonb_build_object('id', split_part(topic, ':', 2), 'event', 'changed'))
), 'all broadcasts are private and carry only the resource id and event');

set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
select pg_temp.check(pg_temp.topic_is_readable(pg_temp.t('conversation', pg_temp.id_for('chat'))), 'participant may receive');
select pg_temp.check(pg_temp.topic_is_readable(pg_temp.t('live_plan', pg_temp.id_for('plan'))), 'member may discover runs');
select pg_temp.check(pg_temp.topic_is_readable(pg_temp.t('live_run', pg_temp.id_for('run'))), 'member may follow runs');
select pg_temp.check(not pg_temp.topic_is_readable(pg_temp.t('conversation', pg_temp.id_for('other_chat'))), 'foreign chat denied');
select pg_temp.check(not pg_temp.topic_is_readable(pg_temp.t('live_plan', pg_temp.id_for('other_plan'))), 'foreign plan denied');
select pg_temp.check(not pg_temp.topic_is_readable(pg_temp.t('live_run', pg_temp.id_for('other_run'))), 'foreign run denied');
select pg_temp.check(not private.can_receive_resource_poke('conversation:malformed'), 'invalid ids are denied safely');
select pg_temp.check(not private.can_receive_resource_poke(pg_temp.t('conversation', pg_temp.id_for('chat')) || ':extra'), 'extra topic segments are denied');
select pg_temp.check(not has_function_privilege('private.send_resource_poke(text,uuid,uuid)', 'execute'), 'clients cannot call the broadcaster');

reset role;
delete from public.team_memberships where team_id = pg_temp.id_for('band') and user_id = '55555555-5555-4555-8555-555555555555';
set local role authenticated;
set local request.jwt.claim.sub = '55555555-5555-4555-8555-555555555555';
select pg_temp.check(not pg_temp.topic_is_readable(pg_temp.t('conversation', pg_temp.id_for('chat'))), 'same-org nonparticipant denied');
set local role anon;
select pg_temp.check(not pg_temp.topic_is_readable(pg_temp.t('conversation', pg_temp.id_for('chat'))), 'anonymous subscription denied');

reset role;
delete from public.organization_members where organization_id = pg_temp.id_for('org') and user_id = pg_temp.id_for('sam');
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
select pg_temp.check(not pg_temp.topic_is_readable(pg_temp.t('conversation', pg_temp.id_for('chat'))), 'removed member cannot rejoin chat');
select pg_temp.check(not pg_temp.topic_is_readable(pg_temp.t('live_run', pg_temp.id_for('run'))), 'removed member cannot rejoin live run');
select pg_temp.check(not pg_temp.topic_is_readable(pg_temp.t('live_plan', pg_temp.id_for('plan'))), 'removed member cannot rejoin plan discovery');
select pg_temp.check(public.live_run_state(pg_temp.id_for('run')) is null, 'canonical run read also denies removed member');

rollback;
