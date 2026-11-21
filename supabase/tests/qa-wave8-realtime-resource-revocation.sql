-- QA wave 8 W8-INT-D5 follow-up: losing access to ONE team or plan conversation ends that
-- person's Realtime access to it (their open socket stops receiving and they cannot rejoin) without
-- rotating the organization key and without touching their other resources. Everything rolls back.
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/qa-wave8-realtime-resource-revocation.sql
begin;

create temporary table rv_fx (k text primary key, id uuid) on commit drop;
grant select on rv_fx to authenticated, anon;
insert into rv_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('band', 'cccccccc-0000-4000-8000-000000000001'),
  ('prod', 'cccccccc-0000-4000-8000-000000000002'),
  ('sam', '33333333-3333-4333-8333-333333333333'),
  ('owner', '11111111-1111-4111-8111-111111111111'),
  ('riley', '44444444-4444-4444-8444-444444444444'),
  ('morgan', '55555555-5555-4555-8555-555555555555'),
  ('band_chat', gen_random_uuid()), ('prod_chat', gen_random_uuid()),
  ('plan_a', gen_random_uuid()), ('plan_b', gen_random_uuid()),
  ('plan_a_chat', gen_random_uuid()), ('plan_b_chat', gen_random_uuid());

create function pg_temp.id_for(p text) returns uuid language sql stable as $$ select id from rv_fx where k = p $$;
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'W8-INT-D5 resource: %', label; end if;
end $$;
create function pg_temp.person_of(p_user uuid) returns uuid language sql stable as $$
  select id from public.people where organization_id = pg_temp.id_for('org') and profile_id = p_user $$;
create function pg_temp.org_key() returns text language sql stable security definer as $$
  select key from private.org_realtime_keys where organization_id = pg_temp.id_for('org') $$;
create function pg_temp.conv_key(p_conv uuid) returns text language sql stable security definer as $$
  select key from private.conversation_realtime_keys where conversation_id = p_conv $$;
-- The topic the API would hand this user (null when they hold no access).
create function pg_temp.topic_for(p_user uuid, p_kind text, p_id uuid) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  select t.topic into v from public.realtime_resource_topics(pg_temp.id_for('org'), p_kind, array[p_id]) t;
  perform set_config('request.jwt.claim.sub', '', true);
  return v;
end $$;
create function pg_temp.readable(p_topic text) returns boolean language plpgsql as $$
begin
  perform set_config('realtime.topic', p_topic, true);
  return exists (select 1 from realtime.messages where topic = p_topic);
end $$;
create function pg_temp.probe(p_topic text) returns void language sql as $$
  select realtime.send('{}'::jsonb, 'probe', p_topic, true) $$;
create function pg_temp.messages_on(p_topic text) returns bigint language sql stable as $$
  select count(*) from realtime.messages where topic = p_topic $$;
-- Production rotates at most once per transaction; let the test rotate repeatedly.
create function pg_temp.reset_rotation() returns void language sql security definer as $$
  update private.conversation_realtime_keys set rotated_at = rotated_at - interval '1 minute';
  update private.org_realtime_keys set rotated_at = rotated_at - interval '1 minute' $$;
-- Topics held before an access loss, so the test can speak about the old socket.
create temporary table rv_topics (k text primary key, topic text) on commit drop;
grant select on rv_topics to authenticated;
create function pg_temp.hold(p_k text, p_topic text) returns void language sql as $$
  insert into rv_topics values (p_k, p_topic) on conflict (k) do update set topic = excluded.topic $$;
create function pg_temp.held(p_k text) returns text language sql stable as $$
  select topic from rv_topics where k = p_k $$;
grant execute on function pg_temp.held(text) to authenticated;

-- ---------------------------------------------------------------- fixtures ---
delete from public.conversations where team_id in (pg_temp.id_for('band'), pg_temp.id_for('prod'));
insert into public.conversations (id, organization_id, kind, team_id) values
  (pg_temp.id_for('band_chat'), pg_temp.id_for('org'), 'team', pg_temp.id_for('band')),
  (pg_temp.id_for('prod_chat'), pg_temp.id_for('org'), 'team', pg_temp.id_for('prod'));
insert into public.plans (id, organization_id, title, service_date, status) values
  (pg_temp.id_for('plan_a'), pg_temp.id_for('org'), 'Resource plan A', now(), 'published'),
  (pg_temp.id_for('plan_b'), pg_temp.id_for('org'), 'Resource plan B', now(), 'published');
insert into public.conversations (id, organization_id, kind, plan_id) values
  (pg_temp.id_for('plan_a_chat'), pg_temp.id_for('org'), 'plan', pg_temp.id_for('plan_a')),
  (pg_temp.id_for('plan_b_chat'), pg_temp.id_for('org'), 'plan', pg_temp.id_for('plan_b'))
  on conflict do nothing;
-- Seed rosters: the band holds Sam, Riley, Morgan and the owner (some with several positions);
-- production holds Riley and a scheduler. Make Morgan a non-participant of the band and Riley a
-- non-member of production, and put Sam on production.
delete from public.team_memberships
 where (team_id = pg_temp.id_for('band') and person_id = pg_temp.person_of(pg_temp.id_for('morgan')))
    or (team_id = pg_temp.id_for('prod') and person_id = pg_temp.person_of(pg_temp.id_for('riley')));
insert into public.team_memberships (team_id, person_id) values
  (pg_temp.id_for('prod'), pg_temp.person_of(pg_temp.id_for('sam')))
  on conflict do nothing;
-- Sam and Riley are released onto both plans.
insert into public.assignments (plan_id, team_id, person_id) values
  (pg_temp.id_for('plan_a'), pg_temp.id_for('band'), pg_temp.person_of(pg_temp.id_for('sam'))),
  (pg_temp.id_for('plan_a'), pg_temp.id_for('band'), pg_temp.person_of(pg_temp.id_for('riley'))),
  (pg_temp.id_for('plan_b'), pg_temp.id_for('band'), pg_temp.person_of(pg_temp.id_for('sam')));

-- ===================================================== issuing topics ===
-- Fixture conversation ids are the ones created above, except plan chats that already existed.
create temporary table rv_plan_chat on commit drop as
  select c.plan_id, c.id from public.conversations c
   where c.plan_id in (pg_temp.id_for('plan_a'), pg_temp.id_for('plan_b'));
grant select on rv_plan_chat to authenticated;
create function pg_temp.plan_chat(p_plan text) returns uuid language sql stable as $$
  select id from rv_plan_chat where plan_id = pg_temp.id_for(p_plan) $$;
grant execute on function pg_temp.plan_chat(text) to authenticated;

select pg_temp.check(pg_temp.conv_key(pg_temp.id_for('band_chat')) is null, 'no key row exists until a topic is issued');
-- Nothing is poked while nobody holds a topic (no key row, nobody subscribed).
select private.send_resource_poke('conversation', pg_temp.id_for('band_chat'));
select pg_temp.check(not exists (select 1 from realtime.messages where topic like 'conversation:' || pg_temp.id_for('band_chat') || ':%'),
  'no poke is sent for a conversation nobody was issued a topic for');

select pg_temp.hold('sam_band', pg_temp.topic_for(pg_temp.id_for('sam'), 'conversation', pg_temp.id_for('band_chat')));
select pg_temp.hold('riley_band', pg_temp.topic_for(pg_temp.id_for('riley'), 'conversation', pg_temp.id_for('band_chat')));
select pg_temp.hold('sam_prod', pg_temp.topic_for(pg_temp.id_for('sam'), 'conversation', pg_temp.id_for('prod_chat')));
select pg_temp.hold('sam_plan_a', pg_temp.topic_for(pg_temp.id_for('sam'), 'conversation', pg_temp.plan_chat('plan_a')));
select pg_temp.hold('riley_plan_a', pg_temp.topic_for(pg_temp.id_for('riley'), 'conversation', pg_temp.plan_chat('plan_a')));
select pg_temp.hold('sam_plan_b', pg_temp.topic_for(pg_temp.id_for('sam'), 'conversation', pg_temp.plan_chat('plan_b')));
select pg_temp.hold('sam_live_plan', pg_temp.topic_for(pg_temp.id_for('sam'), 'live_plan', pg_temp.id_for('plan_a')));
select pg_temp.check(pg_temp.held('sam_band') ~ '^conversation:[0-9a-f-]{36}:[0-9a-f]{64}:[0-9a-f]{64}$', 'conversation topic carries both keys');
select pg_temp.check(pg_temp.held('sam_band') = pg_temp.held('riley_band'), 'teammates are issued the same topic');
select pg_temp.check(pg_temp.held('sam_band') = pg_temp.topic_for(pg_temp.id_for('sam'), 'conversation', pg_temp.id_for('band_chat')),
  'issuing again returns the same topic');
select pg_temp.check(pg_temp.held('sam_live_plan') = 'live_plan:' || pg_temp.id_for('plan_a') || ':' || pg_temp.org_key(),
  'live_plan topic stays organization-keyed');
-- A member who is neither on the team nor a scheduler gets no topic.
select pg_temp.check(pg_temp.topic_for(pg_temp.id_for('morgan'), 'conversation', pg_temp.id_for('band_chat')) is null,
  'a non-participant is not issued the conversation topic');
select pg_temp.check(pg_temp.topic_for(pg_temp.id_for('morgan'), 'conversation', pg_temp.plan_chat('plan_a')) is null,
  'an unassigned member is not issued the plan conversation topic');

select pg_temp.probe(pg_temp.held('sam_band')), pg_temp.probe(pg_temp.held('sam_prod')),
       pg_temp.probe(pg_temp.held('sam_plan_a')), pg_temp.probe(pg_temp.held('sam_plan_b')),
       pg_temp.probe(pg_temp.held('sam_live_plan'));

set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
select pg_temp.check(pg_temp.readable(pg_temp.held('sam_band')), 'team member joins the team topic');
select pg_temp.check(pg_temp.readable(pg_temp.held('sam_plan_a')), 'assignee joins the plan conversation topic');
select pg_temp.check(not pg_temp.readable(substr(pg_temp.held('sam_band'), 1, length(pg_temp.held('sam_band')) - 64) || repeat('0', 64)),
  'a wrong conversation key is refused');
select pg_temp.check(not pg_temp.readable(regexp_replace(pg_temp.held('sam_band'), ':[0-9a-f]{64}$', '')),
  'the old organization-keyed conversation topic is refused');
select pg_temp.check(not has_table_privilege('private.conversation_realtime_keys', 'select'), 'clients cannot read the conversation key table');
select pg_temp.check(not has_function_privilege('private.rotate_conversation_realtime_key(uuid)', 'execute'), 'clients cannot rotate');
reset role;

-- ================================================ team member removed ===
select pg_temp.reset_rotation();
create temporary table rv_org_before on commit drop as select pg_temp.org_key() as k;
create temporary table rv_prod_before on commit drop as select pg_temp.conv_key(pg_temp.id_for('prod_chat')) as k;
delete from public.team_memberships
 where team_id = pg_temp.id_for('band') and person_id = pg_temp.person_of(pg_temp.id_for('sam'));

select pg_temp.check(pg_temp.conv_key(pg_temp.id_for('band_chat')) is distinct from split_part(pg_temp.held('sam_band'), ':', 4),
  'removing a team member rotates the team conversation key');
select pg_temp.check(pg_temp.org_key() = (select k from rv_org_before), 'the organization key is not rotated');
select pg_temp.check(pg_temp.conv_key(pg_temp.id_for('prod_chat')) = (select k from rv_prod_before), 'another team conversation is not rotated');
select pg_temp.check((select count(*) = 1 from realtime.messages
  where topic = pg_temp.held('sam_band') and event = 'changed'
    and (payload - 'id') = jsonb_build_object('event', 'rekey') and private),
  'one id-free rekey poke on the old team topic');
select pg_temp.hold('riley_band_new', pg_temp.topic_for(pg_temp.id_for('riley'), 'conversation', pg_temp.id_for('band_chat')));
select pg_temp.check(pg_temp.held('riley_band_new') <> pg_temp.held('riley_band'), 'a remaining teammate is issued the new topic');
select pg_temp.check(pg_temp.topic_for(pg_temp.id_for('sam'), 'conversation', pg_temp.id_for('band_chat')) is null,
  'the removed member is refused a topic for the team conversation');
select pg_temp.check(pg_temp.topic_for(pg_temp.id_for('sam'), 'conversation', pg_temp.id_for('prod_chat')) = pg_temp.held('sam_prod'),
  'the removed member keeps the topic of another team they are on');

-- Later messages go to the new topic only, never the old one the removed socket holds.
select pg_temp.probe(pg_temp.held('riley_band_new'));
create temporary table rv_old_n on commit drop as select pg_temp.messages_on(pg_temp.held('sam_band')) as n;
select private.send_resource_poke('conversation', pg_temp.id_for('band_chat'));
select pg_temp.check(pg_temp.messages_on(pg_temp.held('riley_band_new')) = 2, 'the next poke is sent to the new topic');
select pg_temp.check(pg_temp.messages_on(pg_temp.held('sam_band')) = (select n from rv_old_n), 'the next poke is not sent to the old topic');

set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
select pg_temp.check(not pg_temp.readable(pg_temp.held('sam_band')), 'the removed member cannot rejoin the old team topic');
select pg_temp.check(not pg_temp.readable(pg_temp.held('riley_band_new')), 'the removed member cannot join the new team topic');
select pg_temp.check(pg_temp.readable(pg_temp.held('sam_prod')), 'the removed member still joins the other team topic');
select pg_temp.check(pg_temp.readable(pg_temp.held('sam_plan_a')), 'the removed member still joins an assigned plan conversation');
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
select pg_temp.check(pg_temp.readable(pg_temp.held('riley_band_new')), 'the remaining teammate joins the new team topic');
select pg_temp.check(not pg_temp.readable(pg_temp.held('riley_band')), 'the old team topic no longer joins');
reset role;

-- ======================================== assignment removed / declined / un-released ===
-- Declined.
select pg_temp.reset_rotation();
create temporary table rv_org_before2 on commit drop as select pg_temp.org_key() as k;
create temporary table rv_plan_b_before on commit drop as select pg_temp.conv_key(pg_temp.plan_chat('plan_b')) as k;
update public.assignments set status = 'declined'
 where plan_id = pg_temp.id_for('plan_a') and person_id = pg_temp.person_of(pg_temp.id_for('sam'));
select pg_temp.check(pg_temp.conv_key(pg_temp.plan_chat('plan_a')) is distinct from split_part(pg_temp.held('sam_plan_a'), ':', 4),
  'declining rotates the plan conversation key');
select pg_temp.check(pg_temp.org_key() = (select k from rv_org_before2), 'declining does not rotate the organization key');
select pg_temp.check(pg_temp.conv_key(pg_temp.plan_chat('plan_b')) = (select k from rv_plan_b_before), 'another plan conversation is not rotated');
select pg_temp.check((select count(*) = 1 from realtime.messages
  where topic = pg_temp.held('sam_plan_a') and (payload - 'id') = jsonb_build_object('event', 'rekey')),
  'one id-free rekey poke on the old plan conversation topic');
select pg_temp.check(pg_temp.topic_for(pg_temp.id_for('sam'), 'conversation', pg_temp.plan_chat('plan_a')) is null,
  'a declined assignee is refused the plan conversation topic');
select pg_temp.hold('riley_plan_a_new', pg_temp.topic_for(pg_temp.id_for('riley'), 'conversation', pg_temp.plan_chat('plan_a')));
select pg_temp.check(pg_temp.held('riley_plan_a_new') is not null and pg_temp.held('riley_plan_a_new') <> pg_temp.held('riley_plan_a'),
  'the remaining assignee is issued the new topic');
select pg_temp.check(pg_temp.topic_for(pg_temp.id_for('sam'), 'conversation', pg_temp.plan_chat('plan_b')) = pg_temp.held('sam_plan_b'),
  'the same person keeps the topic of their other plan');
-- live_plan and live_run are readable by every member, so they stay available (and unrotated).
select pg_temp.check(pg_temp.topic_for(pg_temp.id_for('sam'), 'live_plan', pg_temp.id_for('plan_a')) = pg_temp.held('sam_live_plan'),
  'live_plan topic is unchanged: plan reads are organization-wide');

select pg_temp.probe(pg_temp.held('riley_plan_a_new'));
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
select pg_temp.check(not pg_temp.readable(pg_temp.held('sam_plan_a')), 'the declined assignee cannot rejoin the old plan topic');
select pg_temp.check(not pg_temp.readable(pg_temp.held('riley_plan_a_new')), 'the declined assignee cannot join the new plan topic');
select pg_temp.check(pg_temp.readable(pg_temp.held('sam_plan_b')), 'the other plan conversation still joins');
select pg_temp.check(pg_temp.readable(pg_temp.held('sam_live_plan')), 'the plan live topic still joins');
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
select pg_temp.check(pg_temp.readable(pg_temp.held('riley_plan_a_new')), 'the remaining assignee joins the new plan topic');
reset role;

-- Un-releasing (back to prepared) is a loss; deleting is a loss; confirming and inserting are not.
select pg_temp.reset_rotation();
create temporary table rv_k on commit drop as select pg_temp.conv_key(pg_temp.plan_chat('plan_b')) as k;
update public.assignments set status = 'confirmed'
 where plan_id = pg_temp.id_for('plan_b') and person_id = pg_temp.person_of(pg_temp.id_for('sam'));
select pg_temp.check(pg_temp.conv_key(pg_temp.plan_chat('plan_b')) = (select k from rv_k), 'confirming an assignment does not rotate');
insert into public.assignments (plan_id, team_id, person_id)
  values (pg_temp.id_for('plan_b'), pg_temp.id_for('band'), pg_temp.person_of(pg_temp.id_for('riley')));
select pg_temp.check(pg_temp.conv_key(pg_temp.plan_chat('plan_b')) = (select k from rv_k), 'granting access does not rotate');
update public.assignments set visibility = 'prepared', released_at = null, released_by = null
 where plan_id = pg_temp.id_for('plan_b') and person_id = pg_temp.person_of(pg_temp.id_for('sam'));
select pg_temp.check(pg_temp.conv_key(pg_temp.plan_chat('plan_b')) <> (select k from rv_k), 'un-releasing rotates');
select pg_temp.check(pg_temp.topic_for(pg_temp.id_for('sam'), 'conversation', pg_temp.plan_chat('plan_b')) is null,
  'an un-released assignee is refused the plan conversation topic');

select pg_temp.reset_rotation();
update rv_k set k = pg_temp.conv_key(pg_temp.plan_chat('plan_b'));
delete from public.assignments where plan_id = pg_temp.id_for('plan_b') and person_id = pg_temp.person_of(pg_temp.id_for('riley'));
select pg_temp.check(pg_temp.conv_key(pg_temp.plan_chat('plan_b')) <> (select k from rv_k), 'deleting an assignment rotates');

-- Bulk removal rotates once per conversation per transaction: one rekey poke, one new key.
select pg_temp.reset_rotation();
select pg_temp.hold('bulk_old', pg_temp.topic_for(pg_temp.id_for('riley'), 'conversation', pg_temp.plan_chat('plan_a')));
insert into public.assignments (plan_id, team_id, person_id)
  select pg_temp.id_for('plan_b'), pg_temp.id_for('band'), pg_temp.person_of(u)
    from (values (pg_temp.id_for('riley')), (pg_temp.id_for('owner'))) v(u);
select pg_temp.hold('bulk_b', pg_temp.topic_for(pg_temp.id_for('riley'), 'conversation', pg_temp.plan_chat('plan_b')));
select pg_temp.reset_rotation();
delete from public.assignments where plan_id = pg_temp.id_for('plan_b');
select pg_temp.check((select count(*) = 1 from realtime.messages
  where topic = pg_temp.held('bulk_b') and (payload - 'id') = jsonb_build_object('event', 'rekey')),
  'bulk removal sends one rekey poke per conversation');

-- =========================================== person-level and grant-level losses ===
-- Archiving a person ends access everywhere they were on a team or assigned.
select pg_temp.reset_rotation();
select pg_temp.hold('riley_before_archive', pg_temp.topic_for(pg_temp.id_for('riley'), 'conversation', pg_temp.id_for('band_chat')));
select pg_temp.reset_rotation();
create temporary table rv_org_before3 on commit drop as select pg_temp.org_key() as k;
update public.people set archived_at = now(), archived_by = pg_temp.id_for('owner')
 where id = pg_temp.person_of(pg_temp.id_for('riley'));
select pg_temp.check(pg_temp.conv_key(pg_temp.id_for('band_chat')) <> split_part(pg_temp.held('riley_before_archive'), ':', 4),
  'archiving a person rotates their team conversation');
select pg_temp.check(pg_temp.conv_key(pg_temp.plan_chat('plan_a')) <> split_part(pg_temp.held('riley_plan_a_new'), ':', 4),
  'archiving a person rotates their plan conversation');
select pg_temp.check(pg_temp.conv_key(pg_temp.id_for('prod_chat')) = split_part(pg_temp.held('sam_prod'), ':', 4),
  'archiving a person leaves conversations they were not in alone');
select pg_temp.check(pg_temp.org_key() = (select k from rv_org_before3), 'archiving a person does not rotate the organization key');
select pg_temp.check(pg_temp.topic_for(pg_temp.id_for('riley'), 'conversation', pg_temp.id_for('band_chat')) is null,
  'an archived person is refused the topic');

-- A team-scoped scheduling grant: removing it rotates that team's conversation only.
select pg_temp.reset_rotation();
insert into public.access_grants (organization_id, user_id, capability, scope_type, team_id, created_by)
  values (pg_temp.id_for('org'), pg_temp.id_for('morgan'), 'scheduling.manage', 'team', pg_temp.id_for('prod'), pg_temp.id_for('owner'));
select pg_temp.hold('morgan_prod', pg_temp.topic_for(pg_temp.id_for('morgan'), 'conversation', pg_temp.id_for('prod_chat')));
select pg_temp.check(pg_temp.held('morgan_prod') is not null, 'a team scheduler is issued the team conversation topic');
select pg_temp.reset_rotation();
create temporary table rv_band_k on commit drop as select pg_temp.conv_key(pg_temp.id_for('band_chat')) as k;
create temporary table rv_org_before4 on commit drop as select pg_temp.org_key() as k;
delete from public.access_grants where user_id = pg_temp.id_for('morgan') and capability = 'scheduling.manage';
select pg_temp.check(pg_temp.conv_key(pg_temp.id_for('prod_chat')) <> split_part(pg_temp.held('morgan_prod'), ':', 4),
  'removing a team grant rotates that team conversation');
select pg_temp.check(pg_temp.conv_key(pg_temp.id_for('band_chat')) = (select k from rv_band_k), 'removing a team grant leaves other teams alone');
select pg_temp.check(pg_temp.org_key() = (select k from rv_org_before4), 'removing a team grant does not rotate the organization key');
select pg_temp.check(pg_temp.topic_for(pg_temp.id_for('morgan'), 'conversation', pg_temp.id_for('prod_chat')) is null,
  'the former scheduler is refused the topic');

-- An organization-wide grant is a rare action: it rotates the organization key.
select pg_temp.reset_rotation();
insert into public.access_grants (organization_id, user_id, capability, scope_type, created_by)
  values (pg_temp.id_for('org'), pg_temp.id_for('morgan'), 'plans.edit', 'organization', pg_temp.id_for('owner'));
select pg_temp.reset_rotation();
update rv_org_before4 set k = pg_temp.org_key();
delete from public.access_grants where user_id = pg_temp.id_for('morgan') and capability = 'plans.edit';
select pg_temp.check(pg_temp.org_key() <> (select k from rv_org_before4), 'removing an organization-wide grant rotates the organization key');

-- Unrelated grant capabilities do not rotate anything.
select pg_temp.reset_rotation();
update rv_org_before4 set k = pg_temp.org_key();
insert into public.access_grants (organization_id, user_id, capability, scope_type, created_by)
  values (pg_temp.id_for('org'), pg_temp.id_for('morgan'), 'scheduling.override_conflicts', 'organization', pg_temp.id_for('owner'));
delete from public.access_grants where user_id = pg_temp.id_for('morgan') and capability = 'scheduling.override_conflicts';
select pg_temp.check(pg_temp.org_key() = (select k from rv_org_before4), 'an unrelated capability does not rotate');

-- A deleted conversation takes its key with it.
delete from public.conversations where id = pg_temp.id_for('prod_chat');
select pg_temp.check(pg_temp.conv_key(pg_temp.id_for('prod_chat')) is null, 'a deleted conversation keeps no key');

rollback;
