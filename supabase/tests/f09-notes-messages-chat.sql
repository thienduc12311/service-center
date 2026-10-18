-- F09: audience-scoped notes, item discussion, targeted messages and
-- conversations, exercised under caller roles. Everything rolls back.
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/f09-notes-messages-chat.sql
begin;

create temporary table f09_fx (k text primary key, id uuid) on commit drop;
grant select, insert, update, delete on f09_fx to authenticated, service_role;

insert into f09_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('sunday', 'bbbbbbbb-0000-4000-8000-000000000001'),
  ('midweek', 'bbbbbbbb-0000-4000-8000-000000000002'),
  ('band', 'cccccccc-0000-4000-8000-000000000001'),
  ('production', 'cccccccc-0000-4000-8000-000000000002'),
  ('hospitality', 'cccccccc-0000-4000-8000-000000000003'),
  ('electric', 'dddddddd-0000-4000-8000-000000000003'),
  ('drums', 'dddddddd-0000-4000-8000-000000000005'),
  ('lyrics', 'dddddddd-0000-4000-8000-000000000008'),
  ('keys', 'dddddddd-0000-4000-8000-000000000006'),
  ('owner', '11111111-1111-4111-8111-111111111111'),
  ('jordan', '22222222-2222-4222-8222-222222222222'),
  ('sam_u', '33333333-3333-4333-8333-333333333333'),
  ('riley_u', '44444444-4444-4444-8444-444444444444'),
  ('morgan_u', '55555555-5555-4555-8555-555555555555'),
  ('sam', (select id from public.people where profile_id = '33333333-3333-4333-8333-333333333333')),
  ('riley', (select id from public.people where profile_id = '44444444-4444-4444-8444-444444444444')),
  ('morgan', (select id from public.people where profile_id = '55555555-5555-4555-8555-555555555555')),
  ('plan', gen_random_uuid()), ('item', gen_random_uuid()), ('other_plan', gen_random_uuid()),
  ('other_item', gen_random_uuid()), ('guest', gen_random_uuid()),
  ('midweek_category', gen_random_uuid());

create or replace function pg_temp.fx(p text) returns uuid language sql stable as
  $$ select id from f09_fx where k = p $$;

create or replace function pg_temp.check(ok boolean, message text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'F09 check failed: %', message; end if;
end $$;

insert into public.people (id, organization_id, first_name, last_name)
values (pg_temp.fx('guest'), pg_temp.fx('org'), 'Gale', 'Guest');

insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by, notes)
values
  (pg_temp.fx('plan'), pg_temp.fx('org'), pg_temp.fx('sunday'), 'F09 plan', now() + interval '500 days', 'published', pg_temp.fx('jordan'), 'Doors open at 9.'),
  (pg_temp.fx('other_plan'), pg_temp.fx('org'), pg_temp.fx('sunday'), 'F09 other', now() + interval '501 days', 'published', pg_temp.fx('jordan'), null);
insert into public.plan_items (id, plan_id, item_type, title, sort_order)
values (pg_temp.fx('item'), pg_temp.fx('plan'), 'item', 'Welcome', 0),
       (pg_temp.fx('other_item'), pg_temp.fx('other_plan'), 'item', 'Other welcome', 0);

-- Sam confirmed on Band, Riley pending on Production, Morgan only prepared
-- (never released) on Band, the no-login guest pending on Band.
insert into public.assignments (plan_id, person_id, user_id, team_id, position_id, status, created_by, visibility, released_at, attendance_mode)
values
  (pg_temp.fx('plan'), pg_temp.fx('sam'), pg_temp.fx('sam_u'), pg_temp.fx('band'), pg_temp.fx('electric'), 'confirmed', pg_temp.fx('jordan'), 'released', now(), 'all'),
  (pg_temp.fx('plan'), pg_temp.fx('riley'), pg_temp.fx('riley_u'), pg_temp.fx('production'), pg_temp.fx('lyrics'), 'unconfirmed', pg_temp.fx('jordan'), 'released', now(), 'all'),
  (pg_temp.fx('plan'), pg_temp.fx('guest'), null, pg_temp.fx('band'), pg_temp.fx('drums'), 'unconfirmed', pg_temp.fx('jordan'), 'released', now(), 'all');
insert into public.assignments (plan_id, person_id, user_id, team_id, position_id, status, created_by, visibility, attendance_mode)
values (pg_temp.fx('plan'), pg_temp.fx('morgan'), pg_temp.fx('morgan_u'), pg_temp.fx('band'), pg_temp.fx('keys'), 'unconfirmed', pg_temp.fx('jordan'), 'prepared', 'all');

insert into public.note_categories (id, organization_id, service_type_id, name)
values (pg_temp.fx('midweek_category'), pg_temp.fx('org'), pg_temp.fx('midweek'), 'Midweek cues');

-- ================================================================ Pass A ===

-- The simple notes string became the legacy note, and stays in step.
select pg_temp.check((select body from public.plan_notes where plan_id = pg_temp.fx('plan') and is_legacy) = 'Doors open at 9.',
  'plan insert created the legacy note');
update public.plans set notes = 'Doors open at 8:30.' where id = pg_temp.fx('plan');
select pg_temp.check((select body from public.plan_notes where plan_id = pg_temp.fx('plan') and is_legacy) = 'Doors open at 8:30.',
  'plans.notes update rewrote the legacy note');

set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

-- Editing the legacy note through the new API rewrites plans.notes.
insert into f09_fx select 'legacy', id from public.plan_notes where plan_id = pg_temp.fx('plan') and is_legacy;
select public.save_plan_note(pg_temp.fx('plan'), pg_temp.fx('legacy'), null, null, 'organization', null, 'Doors open at 8.',
  (select revision from public.plan_notes where id = pg_temp.fx('legacy')));
select pg_temp.check((select notes from public.plans where id = pg_temp.fx('plan')) = 'Doors open at 8.',
  'legacy note edit mirrored into plans.notes');

insert into f09_fx select 'note_scheduled', (public.save_plan_note(pg_temp.fx('plan'), null, null, null, 'scheduled', null, 'SCHEDULED-ONLY parking code 4471', null)).id;
insert into f09_fx select 'note_teams', (public.save_plan_note(pg_temp.fx('plan'), null, null, null, 'teams', array[pg_temp.fx('production')], 'PRODUCTION-ONLY stream key', null)).id;
insert into f09_fx select 'note_leaders', (public.save_plan_note(pg_temp.fx('plan'), null, pg_temp.fx('item'), null, 'leaders', null, 'LEADERS-ONLY pastoral care detail', null)).id;

-- Stale revision, empty team audience, foreign category and foreign item.
do $$ begin
  perform public.save_plan_note(pg_temp.fx('plan'), pg_temp.fx('note_scheduled'), null, null, 'scheduled', null, 'x', 99);
  raise exception 'stale note revision was accepted';
exception when sqlstate 'PT409' then null; end $$;
do $$ begin
  perform public.save_plan_note(pg_temp.fx('plan'), null, null, null, 'teams', '{}', 'x', null);
  raise exception 'team note without teams was accepted';
exception when sqlstate '22023' then null; end $$;
do $$ begin
  perform public.save_plan_note(pg_temp.fx('plan'), null, null, pg_temp.fx('midweek_category'), 'organization', null, 'x', null);
  raise exception 'another service type''s category was accepted';
exception when sqlstate '22023' then null; end $$;
do $$ begin
  perform public.save_plan_note(pg_temp.fx('plan'), null, pg_temp.fx('other_item'), null, 'organization', null, 'x', null);
  raise exception 'another plan''s item was accepted';
exception when foreign_key_violation then null; end $$;
select pg_temp.check((select count(*) from public.plan_notes where plan_id = pg_temp.fx('plan')) = 4, 'leader reads every note');

-- Sam: scheduled on Band. Organization + scheduled only.
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
select pg_temp.check((select count(*) from public.plan_notes where plan_id = pg_temp.fx('plan')) = 2, 'Sam reads two notes');
select pg_temp.check(not exists (select 1 from public.plan_notes where body like '%ONLY stream%' or body like '%LEADERS%'), 'Sam cannot read team/leader notes');
select pg_temp.check((select count(*) from public.plan_note_teams) = 0, 'Sam cannot read the team list of a hidden note');
select pg_temp.check((select count(*) from public.plans p join public.plan_notes n on n.plan_id = p.id where p.id = pg_temp.fx('plan')) = 2,
  'joined counts follow the same audience');
do $$ begin
  insert into public.plan_notes (organization_id, plan_id, audience, body) values (pg_temp.fx('org'), pg_temp.fx('plan'), 'organization', 'forged');
  raise exception 'a member inserted a note';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform public.save_plan_note(pg_temp.fx('plan'), null, null, null, 'organization', null, 'x', null);
  raise exception 'a member saved a note';
exception when sqlstate 'P0002' then null; end $$;
update public.plan_notes set body = 'tampered' where id = pg_temp.fx('note_scheduled');
select pg_temp.check((select body from public.plan_notes where id = pg_temp.fx('note_scheduled')) like 'SCHEDULED%', 'member update is a no-op');

-- Riley: pending on Production and on the Production team.
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
select pg_temp.check((select count(*) from public.plan_notes where plan_id = pg_temp.fx('plan')) = 3, 'Riley reads org, scheduled and Production notes');
select pg_temp.check(not exists (select 1 from public.plan_notes where body like '%LEADERS%'), 'Riley cannot read the leader note');

-- Morgan: prepared only. A prepared request is not "scheduled".
set local request.jwt.claim.sub = '55555555-5555-4555-8555-555555555555';
select pg_temp.check((select count(*) from public.plan_notes where plan_id = pg_temp.fx('plan')) = 1, 'Morgan reads only the organization note');
select pg_temp.check((select notes from public.plans where id = pg_temp.fx('plan')) = 'Doors open at 8.', 'plans.notes never carries private text');

-- -------------------------------------------------------- item comments ----
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
insert into f09_fx values ('comment', gen_random_uuid());
create temporary table f09_post on commit drop as
select * from public.post_item_comment(pg_temp.fx('comment'), pg_temp.fx('item'), 'Can we start 5 minutes early?',
  array[pg_temp.fx('riley'), pg_temp.fx('morgan'), pg_temp.fx('guest')]);
select pg_temp.check((select not replayed from f09_post), 'first post is new');
select pg_temp.check((select replayed from public.post_item_comment(pg_temp.fx('comment'), pg_temp.fx('item'), 'Can we start 5 minutes early?', null)),
  'retry with the same id replays');
select pg_temp.check((select count(*) from public.plan_item_comments where plan_item_id = pg_temp.fx('item')) = 1, 'one logical comment');

reset role;
select pg_temp.check((select resolution from public.plan_item_comment_mentions where comment_id = pg_temp.fx('comment') and person_id = pg_temp.fx('riley')) = 'notified', 'Riley mention notified');
select pg_temp.check((select resolution from public.plan_item_comment_mentions where comment_id = pg_temp.fx('comment') and person_id = pg_temp.fx('morgan')) = 'no_access', 'mention does not grant Morgan access');
select pg_temp.check((select resolution from public.plan_item_comment_mentions where comment_id = pg_temp.fx('comment') and person_id = pg_temp.fx('guest')) = 'no_login', 'guest mention recorded as no login');
select pg_temp.check((select count(*) from public.deliveries d join public.delivery_effects e on e.id = d.effect_id
  where e.comment_id = pg_temp.fx('comment')) = 2, 'only Riley gets deliveries (feed + push)');
select pg_temp.check(not exists (select 1 from public.deliveries d join public.delivery_effects e on e.id = d.effect_id
  where e.comment_id = pg_temp.fx('comment') and d.recipient_person_id = pg_temp.fx('morgan')), 'nothing is sent to Morgan');
select pg_temp.check((select count(*) from public.delivery_effects where comment_id = pg_temp.fx('comment')) = 1, 'one effect for the comment');
set local role authenticated;

set local request.jwt.claim.sub = '55555555-5555-4555-8555-555555555555';
select pg_temp.check((select count(*) from public.plan_item_comments) = 0, 'Morgan cannot read the thread');
select pg_temp.check((select count(*) from public.plan_item_comment_mentions) = 0, 'Morgan cannot read mentions');
do $$ begin
  perform public.post_item_comment(gen_random_uuid(), pg_temp.fx('item'), 'hi', null);
  raise exception 'Morgan posted into a thread she cannot read';
exception when sqlstate 'P0002' then null; end $$;

set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
do $$ begin
  perform public.post_item_comment(pg_temp.fx('comment'), pg_temp.fx('item'), 'hijack', null);
  raise exception 'another author reused a comment id';
exception when sqlstate 'PT409' then null; end $$;
insert into f09_fx values ('reply', gen_random_uuid());
select public.post_item_comment(pg_temp.fx('reply'), pg_temp.fx('item'), 'Yes, works for production.', null);
do $$ begin
  perform public.edit_item_comment(pg_temp.fx('comment'), 'edited by someone else');
  raise exception 'Riley edited Sam''s comment';
exception when insufficient_privilege then null; end $$;

reset role;
select pg_temp.check(exists (select 1 from public.deliveries d join public.delivery_effects e on e.id = d.effect_id
  where e.comment_id = pg_temp.fx('reply') and d.recipient_person_id = pg_temp.fx('sam') and d.channel = 'in_app'),
  'earlier participant Sam gets the reply in the feed');
set local role authenticated;

set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
select public.edit_item_comment(pg_temp.fx('comment'), 'Can we start 10 minutes early?');
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
select public.delete_item_comment(pg_temp.fx('comment'), 'moderated');
select public.delete_item_comment(pg_temp.fx('comment'), 'moderated');
select pg_temp.check((select body = '' and deleted_at is not null from public.plan_item_comments where id = pg_temp.fx('comment')), 'deleted placeholder');
select pg_temp.check((select count(*) from public.discussion_audit_events) = 0, 'a scheduler cannot read the audit trail');
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
select pg_temp.check((select count(*) from public.discussion_audit_events where subject_id = pg_temp.fx('comment')) = 2,
  'edit + delete audited once each');
select pg_temp.check((select previous_body from public.discussion_audit_events where subject_id = pg_temp.fx('comment') and action = 'deleted')
  = 'Can we start 10 minutes early?', 'administrators keep the deleted text');

-- ================================================================ Pass B ===
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$ begin
  perform public.preview_operational_message(pg_temp.fx('org'), jsonb_build_object('plan_id', pg_temp.fx('plan'), 'include', jsonb_build_array('scheduled_confirmed')));
  raise exception 'a member previewed a message audience';
exception when insufficient_privilege then null; end $$;

set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
create temporary table f09_preview on commit drop as
select public.preview_operational_message(pg_temp.fx('org'), jsonb_build_object(
  'plan_id', pg_temp.fx('plan'), 'team_ids', jsonb_build_array(pg_temp.fx('band'), pg_temp.fx('production')),
  'include', jsonb_build_array('scheduled_confirmed', 'scheduled_pending', 'team_members'))) as p;
-- Band: owner, Sam, Riley, Morgan; Production: Jordan, Riley; scheduled:
-- Sam, Riley, guest. Six distinct Persons.
select pg_temp.check((select jsonb_array_length(p->'recipients') from f09_preview) = 6,
  'audience merges duplicates (Sam is a member and scheduled)');
select pg_temp.check((select r->'reasons' from f09_preview, jsonb_array_elements(p->'recipients') r where r->>'person_id' = pg_temp.fx('sam')::text)
  = '["scheduled_confirmed", "team_member"]'::jsonb, 'Sam carries both reasons');
select pg_temp.check((select (r->>'reachable')::boolean from f09_preview, jsonb_array_elements(p->'recipients') r where r->>'person_id' = pg_temp.fx('guest')::text) = false,
  'no-address guest is listed as unreachable');
select pg_temp.check(not exists (select 1 from f09_preview, jsonb_array_elements(p->'recipients') r where r ? 'email'), 'preview carries no addresses');

-- Prepared requests never put someone in a "scheduled" audience.
select pg_temp.check(not exists (
  select 1 from jsonb_array_elements((public.preview_operational_message(pg_temp.fx('org'), jsonb_build_object(
    'plan_id', pg_temp.fx('plan'), 'include', jsonb_build_array('scheduled_pending'))))->'recipients') r
   where r->>'person_id' = pg_temp.fx('morgan')::text), 'prepared request is not in the pending audience');

do $$ begin
  perform public.send_operational_message(pg_temp.fx('org'), jsonb_build_object('plan_id', pg_temp.fx('plan'), 'include', jsonb_build_array('scheduled_confirmed')),
    'Hi {{password}}', 'Body', null, null, 'whatever', 'f09-unknown-variable');
  raise exception 'an unknown variable was accepted';
exception when sqlstate '22023' then null; end $$;
do $$ begin
  perform public.send_operational_message(pg_temp.fx('org'), jsonb_build_object('plan_id', pg_temp.fx('plan'), 'include', jsonb_build_array('scheduled_confirmed', 'scheduled_pending')),
    'Parking', 'Hi {{first_name}}', null, null, md5('stale'), 'f09-stale-audience');
  raise exception 'a stale audience was sent';
exception when sqlstate 'PT409' then null; end $$;

insert into f09_fx values ('audience_hash', null);
create temporary table f09_audience on commit drop as
select jsonb_build_object('plan_id', pg_temp.fx('plan'), 'include', jsonb_build_array('scheduled_confirmed', 'scheduled_pending')) as a;
create temporary table f09_sent on commit drop as
select * from public.send_operational_message(pg_temp.fx('org'), (select a from f09_audience),
  'Parking for {{plan_title}}', 'Hi {{first_name}}, park in lot B.', null, null,
  (select public.preview_operational_message(pg_temp.fx('org'), (select a from f09_audience))->>'audience_hash'),
  'f09-message-key-1');
select pg_temp.check((select not replayed from f09_sent), 'first send is new');
select pg_temp.check((select replayed and message_id = (select message_id from f09_sent)
  from public.send_operational_message(pg_temp.fx('org'), (select a from f09_audience),
    'Parking for {{plan_title}}', 'Hi {{first_name}}, park in lot B.', null, null, md5('ignored on replay'), 'f09-message-key-1')),
  'same key replays the first send');
do $$ begin
  perform public.send_operational_message(pg_temp.fx('org'), (select a from f09_audience),
    'Parking', 'Different body', null, null, md5('x'), 'f09-message-key-1');
  raise exception 'the same key sent different content';
exception when sqlstate 'PT409' then null; end $$;

reset role;
select pg_temp.check((select status from public.operational_message_recipients where message_id = (select message_id from f09_sent) and person_id = pg_temp.fx('guest'))
  = 'excluded_no_address', 'guest snapshot excluded, no address');
select pg_temp.check((select array_agg(channel::text order by channel::text) from public.deliveries
  where effect_id = (select effect_id from f09_sent) and recipient_person_id = pg_temp.fx('sam')) = array['email', 'in_app', 'push'],
  'Sam gets one delivery per channel');
select pg_temp.check(not exists (select 1 from public.deliveries where effect_id = (select effect_id from f09_sent) and recipient_person_id = pg_temp.fx('guest')),
  'nothing queued for the unreachable guest');
select pg_temp.check((select count(*) from public.operational_messages where idempotency_key = 'f09-message-key-1') = 1, 'one message for the key');
select pg_temp.check(public.operational_message_recipient_current((select message_id from f09_sent), pg_temp.fx('sam')), 'Sam is current');
set local role authenticated;

set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
select pg_temp.check((select count(*) from public.operational_messages where id = (select message_id from f09_sent)) = 1, 'recipient reads the message');
select pg_temp.check((select count(*) from public.operational_message_recipients where message_id = (select message_id from f09_sent)) = 1,
  'recipient sees only their own snapshot row');
do $$ begin
  perform * from public.operational_message_outcomes((select message_id from f09_sent));
  raise exception 'a recipient read delivery outcomes';
exception when sqlstate 'P0002' then null; end $$;
set local request.jwt.claim.sub = '55555555-5555-4555-8555-555555555555';
select pg_temp.check((select count(*) from public.operational_messages) = 0, 'a non-recipient cannot read the message');

-- Sam declines afterwards: future delivery stops, the snapshot stays.
reset role;
update public.assignments set status = 'declined' where plan_id = pg_temp.fx('plan') and person_id = pg_temp.fx('sam');
select pg_temp.check(not public.operational_message_recipient_current((select message_id from f09_sent), pg_temp.fx('sam')), 'Sam is no longer current');
select pg_temp.check(exists (select 1 from public.operational_message_recipients where message_id = (select message_id from f09_sent)
  and person_id = pg_temp.fx('sam') and status = 'included'), 'historical recipient row is not rewritten');
update public.assignments set status = 'confirmed' where plan_id = pg_temp.fx('plan') and person_id = pg_temp.fx('sam');

-- Retry touches only failed/uncertain deliveries, once.
update public.deliveries set status = 'failed', attempts = 5, last_error_code = 'provider_rejected', completed_at = now()
 where effect_id = (select effect_id from f09_sent) and recipient_person_id = pg_temp.fx('riley') and channel = 'email';
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
select pg_temp.check((select count(*) from public.operational_message_outcomes((select message_id from f09_sent))) >= 5, 'sender reads outcomes');
select pg_temp.check(public.retry_operational_message((select message_id from f09_sent), null) = 1, 'one failed delivery re-queued');
select pg_temp.check(public.retry_operational_message((select message_id from f09_sent), null) = 0, 'repeating the retry changes nothing');

-- Templates: personal ones are private; shared ones need organization scope.
insert into public.message_templates (organization_id, owner_id, name, subject, body, created_by)
values (pg_temp.fx('org'), pg_temp.fx('jordan'), 'My parking note', 'Parking', 'Hi {{first_name}}', pg_temp.fx('jordan'));
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
select pg_temp.check((select count(*) from public.message_templates) = 0, 'a member cannot see templates');
do $$ begin
  insert into public.message_templates (organization_id, owner_id, name, subject, body)
  values (pg_temp.fx('org'), null, 'Forged shared', 'x', 'y');
  raise exception 'a member created a shared template';
exception when insufficient_privilege then null; end $$;

-- ================================================================ Pass C ===
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
insert into f09_fx select 'band_chat', (public.open_conversation('team', pg_temp.fx('band'))).id;
select pg_temp.check((public.open_conversation('team', pg_temp.fx('band'))).id = pg_temp.fx('band_chat'), 'one conversation per team');
do $$ begin
  perform public.open_conversation('team', pg_temp.fx('hospitality'));
  raise exception 'Sam opened a team conversation he does not belong to';
exception when sqlstate 'P0002' then null; end $$;

insert into f09_fx values ('m1', gen_random_uuid());
select public.post_conversation_message(pg_temp.fx('m1'), pg_temp.fx('band_chat'), 'Rehearsal moved to 7pm', null, array[pg_temp.fx('riley')]);
select pg_temp.check((select replayed from public.post_conversation_message(pg_temp.fx('m1'), pg_temp.fx('band_chat'), 'Rehearsal moved to 7pm', null, null)),
  'resend after a lost acknowledgement replays');
select pg_temp.check((select count(*) from public.conversation_messages where conversation_id = pg_temp.fx('band_chat')) = 1, 'one message for one send id');

set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
select pg_temp.check((select unread_count from public.my_conversations(pg_temp.fx('org')) where id = pg_temp.fx('band_chat')) = 1, 'Riley has one unread');
select public.mark_conversation_read(pg_temp.fx('band_chat'), now());
select pg_temp.check((select unread_count from public.my_conversations(pg_temp.fx('org')) where id = pg_temp.fx('band_chat')) = 0, 'read clears unread');
select pg_temp.check((select count(*) from public.conversation_messages where search @@ plainto_tsquery('simple', 'rehearsal')) = 1, 'participant search finds it');
select public.set_conversation_muted(pg_temp.fx('band_chat'), true);
insert into f09_fx values ('m2', gen_random_uuid());
select public.post_conversation_message(pg_temp.fx('m2'), pg_temp.fx('band_chat'), 'Spam spam spam', pg_temp.fx('m1'), null);

set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
insert into f09_fx values ('m3', gen_random_uuid());
select public.post_conversation_message(pg_temp.fx('m3'), pg_temp.fx('band_chat'), '@Riley please confirm', null, array[pg_temp.fx('riley')]);
reset role;
select pg_temp.check((select resolution from public.conversation_message_mentions where message_id = pg_temp.fx('m1') and person_id = pg_temp.fx('riley')) = 'notified', 'first mention notified');
select pg_temp.check((select resolution from public.conversation_message_mentions where message_id = pg_temp.fx('m3') and person_id = pg_temp.fx('riley')) = 'muted', 'muted member is not notified');
select pg_temp.check(exists (select 1 from public.deliveries d join public.delivery_effects e on e.id = d.effect_id
  where e.conversation_message_id = pg_temp.fx('m2') and d.recipient_person_id = pg_temp.fx('sam')), 'reply notifies the replied-to author');
set local role authenticated;

-- Report and moderation.
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
insert into f09_fx select 'report', (public.report_conversation_message(pg_temp.fx('m2'), 'spam', 'not about band')).id;
select pg_temp.check((public.report_conversation_message(pg_temp.fx('m2'), 'spam', null)).id = pg_temp.fx('report'), 'reporting twice returns the first report');
do $$ begin
  perform public.resolve_conversation_report(pg_temp.fx('report'), 'hide', null);
  raise exception 'a participant moderated';
exception when sqlstate 'P0002' then null; end $$;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
select public.resolve_conversation_report(pg_temp.fx('report'), 'hide', 'off topic');
select pg_temp.check((select body = '' and hidden_at is not null from public.conversation_messages where id = pg_temp.fx('m2')), 'hidden message has no text');
select pg_temp.check((select status from public.conversation_message_reports where id = pg_temp.fx('report')) = 'actioned', 'report actioned');
select public.restore_conversation_message(pg_temp.fx('m2'));
select pg_temp.check((select body from public.conversation_messages where id = pg_temp.fx('m2')) = 'Spam spam spam', 'moderator restores from audit');

-- Revocation: Riley leaves the Band team. No more reads or posts.
reset role;
delete from public.team_memberships where team_id = pg_temp.fx('band') and person_id = pg_temp.fx('riley');
set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
select pg_temp.check((select count(*) from public.conversation_messages where conversation_id = pg_temp.fx('band_chat')) = 0, 'removed member reads nothing');
select pg_temp.check((select count(*) from public.conversations where id = pg_temp.fx('band_chat')) = 0, 'removed member cannot open the guessed id');
do $$ begin
  perform public.post_conversation_message(gen_random_uuid(), pg_temp.fx('band_chat'), 'still here?', null, null);
  raise exception 'a removed member posted';
exception when sqlstate 'P0002' then null; end $$;

-- Youth gate: a Person recorded as a child is not a participant.
reset role;
update public.people set person_type = 'child' where id = pg_temp.fx('morgan');
set local role authenticated;
set local request.jwt.claim.sub = '55555555-5555-4555-8555-555555555555';
select pg_temp.check((select count(*) from public.conversations) = 0, 'youth participant gated');
reset role;
update public.people set person_type = 'adult' where id = pg_temp.fx('morgan');
set local role authenticated;
select pg_temp.check((select count(*) from public.conversations where id = pg_temp.fx('band_chat')) = 1, 'adult Band member reads the chat');

-- Plan conversation: scheduled people and leaders; not prepared-only.
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
insert into f09_fx select 'plan_chat', (public.open_conversation('plan', pg_temp.fx('plan'))).id;
set local request.jwt.claim.sub = '55555555-5555-4555-8555-555555555555';
select pg_temp.check((select count(*) from public.conversations where id = pg_temp.fx('plan_chat')) = 0, 'prepared-only person cannot read the plan chat');

-- Rate limit.
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$
declare i int;
begin
  for i in 1..25 loop
    perform public.post_conversation_message(gen_random_uuid(), pg_temp.fx('plan_chat'), 'msg ' || i, null, null);
  end loop;
  raise exception 'rate limit never applied';
exception when sqlstate 'PT429' then null; end $$;

-- Retention purge (worker).
reset role;
update public.organizations set conversation_retention_days = 30 where id = pg_temp.fx('org');
update public.conversation_messages set created_at = now() - interval '40 days' where id = pg_temp.fx('m1');
select pg_temp.check(public.purge_expired_conversation_messages(100) >= 1, 'purge removed an expired message');
select pg_temp.check(not exists (select 1 from public.conversation_messages where id = pg_temp.fx('m1')), 'expired message gone');

select 'f09 checks passed' as result;
rollback;
