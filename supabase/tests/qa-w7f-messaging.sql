-- QA wave 7 follow-up, messaging privacy. Uses the seed org/people of
-- supabase/tests/f09-notes-messages-chat.sql. Everything rolls back.
--   A. W7-MSG-D6  a message recipient cannot read the sender-side audit row
--                 (base table) but reads the recipient-safe columns through
--                 my_received_messages; sender and admin keep the full row.
--   B. W7-MSG-D4  a conversation notification's snippet is not served after
--                 the message is deleted or hidden, nor after the recipient
--                 loses access to the conversation; mark-read, delete-own and
--                 the retention prune keep working.
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/qa-w7f-messaging.sql
begin;

create temporary table w7f_fx (k text primary key, id uuid) on commit drop;
grant select, insert, update, delete on w7f_fx to authenticated, service_role;

insert into w7f_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('sunday', 'bbbbbbbb-0000-4000-8000-000000000001'),
  ('band', 'cccccccc-0000-4000-8000-000000000001'),
  ('owner', '11111111-1111-4111-8111-111111111111'),
  ('jordan', '22222222-2222-4222-8222-222222222222'),
  ('sam_u', '33333333-3333-4333-8333-333333333333'),
  ('riley_u', '44444444-4444-4444-8444-444444444444'),
  ('morgan_u', '55555555-5555-4555-8555-555555555555'),
  ('sam', (select id from public.people where profile_id = '33333333-3333-4333-8333-333333333333')),
  ('riley', (select id from public.people where profile_id = '44444444-4444-4444-8444-444444444444')),
  ('plan', gen_random_uuid()), ('conv_msg_del', gen_random_uuid()), ('conv_msg_hide', gen_random_uuid()),
  ('conv_msg_keep', gen_random_uuid());

create or replace function pg_temp.fx(p text) returns uuid language sql stable as
  $$ select id from w7f_fx where k = p $$;
create or replace function pg_temp.check(ok boolean, message text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'W7F check failed: %', message; end if;
end $$;
create or replace function pg_temp.act_as(p text) returns void language sql as
  $$ select set_config('request.jwt.claims', json_build_object('sub', pg_temp.fx(p), 'role', 'authenticated')::text, true) $$;

insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by)
values (pg_temp.fx('plan'), pg_temp.fx('org'), pg_temp.fx('sunday'), 'W7F plan', now() + interval '600 days', 'published', pg_temp.fx('jordan'));
insert into public.assignments (plan_id, person_id, user_id, team_id, position_id, status, created_by, visibility, released_at, attendance_mode)
values
  (pg_temp.fx('plan'), pg_temp.fx('sam'), pg_temp.fx('sam_u'), pg_temp.fx('band'), 'dddddddd-0000-4000-8000-000000000003', 'confirmed', pg_temp.fx('jordan'), 'released', now(), 'all'),
  (pg_temp.fx('plan'), pg_temp.fx('riley'), pg_temp.fx('riley_u'), pg_temp.fx('band'), 'dddddddd-0000-4000-8000-000000000005', 'confirmed', pg_temp.fx('jordan'), 'released', now(), 'all');

-- ================================================================ Pass A ===
set local role authenticated;
select pg_temp.act_as('jordan');
create temporary table w7f_sent on commit drop as
select * from public.send_operational_message(pg_temp.fx('org'),
  jsonb_build_object('plan_id', pg_temp.fx('plan'), 'include', jsonb_build_array('scheduled_confirmed')),
  'Parking for {{plan_title}}', 'Hi {{first_name}}, lot B.', null, null,
  (select public.preview_operational_message(pg_temp.fx('org'),
     jsonb_build_object('plan_id', pg_temp.fx('plan'), 'include', jsonb_build_array('scheduled_confirmed')))->>'audience_hash'),
  'w7f-message-key-1');
grant select on w7f_sent to authenticated, service_role;

select pg_temp.check((select count(*) from public.operational_messages where id = (select message_id from w7f_sent)) = 1,
  'the sender still reads the full row');
select pg_temp.check((select count(*) from public.my_received_messages(pg_temp.fx('org'))) = 0,
  'the sender is not a recipient');

select pg_temp.act_as('owner');
select pg_temp.check((select count(*) from public.operational_messages where id = (select message_id from w7f_sent)) = 1,
  'an organization admin still reads the full row');

select pg_temp.act_as('sam_u');
select pg_temp.check((select count(*) from public.operational_messages) = 0,
  'a recipient cannot read operational_messages at all (audit columns included)');
select pg_temp.check((select count(*) from public.operational_messages where id = (select message_id from w7f_sent)) = 0,
  'a recipient cannot read the row by id');
select pg_temp.check((select count(*) from public.my_received_messages(pg_temp.fx('org'))
                       where id = (select message_id from w7f_sent)) = 1,
  'a recipient reads the message through my_received_messages');
select pg_temp.check((select count(*) from public.my_received_messages(pg_temp.fx('org')) m
                       where to_jsonb(m) ?| array['audience', 'audience_hash', 'request_hash', 'recipient_count',
                                                  'excluded_count', 'idempotency_key', 'template_id', 'template_revision']) = 0,
  'the recipient view carries no sender-side audit column');
select pg_temp.check((select subject from public.my_received_messages(pg_temp.fx('org'))) = 'Parking for {{plan_title}}',
  'the recipient view carries the subject');
select pg_temp.check((select count(*) from public.my_received_messages('00000000-0000-4000-8000-00000000dead')) = 0,
  'another organization id yields nothing');

-- Someone who is neither sender, admin nor recipient sees nothing.
select pg_temp.act_as('morgan_u');
select pg_temp.check((select count(*) from public.my_received_messages(pg_temp.fx('org'))) = 0, 'a non-recipient gets no rows');
select pg_temp.check((select count(*) from public.operational_messages) = 0, 'a non-recipient reads no base rows');

-- Anonymous callers cannot call the function.
reset role;
set local role anon;
do $$ begin
  perform * from public.my_received_messages('aaaaaaaa-0000-4000-8000-000000000001');
  raise exception 'anon executed my_received_messages';
exception when insufficient_privilege then null; end $$;
reset role;

-- A recipient who left the organization loses the view.
update public.organization_members set status = 'inactive'
 where user_id = pg_temp.fx('sam_u') and organization_id = pg_temp.fx('org');
set local role authenticated;
select pg_temp.act_as('sam_u');
select pg_temp.check((select count(*) from public.my_received_messages(pg_temp.fx('org'))) = 0,
  'an inactive member no longer reads received messages');
reset role;
update public.organization_members set status = 'active'
 where user_id = pg_temp.fx('sam_u') and organization_id = pg_temp.fx('org');

-- ================================================================ Pass B ===
set local role authenticated;
select pg_temp.act_as('sam_u');
insert into w7f_fx select 'band_chat', (public.open_conversation('team', pg_temp.fx('band'))).id;
select public.post_conversation_message(pg_temp.fx('conv_msg_del'), pg_temp.fx('band_chat'), 'SECRET-DELETE text', null, null);
select public.post_conversation_message(pg_temp.fx('conv_msg_hide'), pg_temp.fx('band_chat'), 'SECRET-HIDE text', null, null);
select public.post_conversation_message(pg_temp.fx('conv_msg_keep'), pg_temp.fx('band_chat'), 'SECRET-KEEP text', null, null);

-- The dispatcher writes these with the service role; mirror it for Riley.
reset role;
insert into public.notifications (organization_id, user_id, type, title, body, conversation_id, created_by, dedupe_key)
select pg_temp.fx('org'), pg_temp.fx('riley_u'), 'conversation_message', 'Sam in Band chat', n.snippet,
       pg_temp.fx('band_chat'), pg_temp.fx('sam_u'), e.id::text || ':' || pg_temp.fx('riley')::text
  from (values ('conv_msg_del', 'SECRET-DELETE text'), ('conv_msg_hide', 'SECRET-HIDE text'), ('conv_msg_keep', 'SECRET-KEEP text')) n(msg, snippet)
  join public.delivery_effects e on e.conversation_message_id = pg_temp.fx(n.msg);
select pg_temp.check((select count(*) from public.notifications where user_id = pg_temp.fx('riley_u') and conversation_id = pg_temp.fx('band_chat')) = 3,
  'three notifications written for Riley');

set local role authenticated;
select pg_temp.act_as('riley_u');
select pg_temp.check((select count(*) from public.notifications where body like 'SECRET-%') = 3, 'Riley initially reads all three snippets');

-- Repro B: the author deletes a message.
select pg_temp.act_as('sam_u');
select public.delete_conversation_message(pg_temp.fx('conv_msg_del'));
select pg_temp.act_as('riley_u');
select pg_temp.check(not exists (select 1 from public.notifications where body like '%SECRET-DELETE%'),
  'a deleted message leaves no snippet in the notification');
select pg_temp.check((select count(*) from public.notifications where title = 'Sam in Band chat') = 3,
  'the notification row itself is kept (title only)');

-- Repro C: a moderator hides a reported message.
insert into w7f_fx select 'report', (public.report_conversation_message(pg_temp.fx('conv_msg_hide'), 'spam', null)).id;
select pg_temp.act_as('jordan');
select public.resolve_conversation_report(pg_temp.fx('report'), 'hide', 'off topic');
select pg_temp.act_as('riley_u');
select pg_temp.check(not exists (select 1 from public.notifications where body like '%SECRET-HIDE%'),
  'a hidden message leaves no snippet in the notification');
select pg_temp.check((select count(*) from public.notifications where body = 'SECRET-KEEP text') = 1,
  'an untouched message keeps its snippet');

-- Repro A: Riley leaves the Band roster.
reset role;
create temporary table w7f_roster on commit drop as
select * from public.team_memberships where team_id = pg_temp.fx('band') and person_id = pg_temp.fx('riley');
delete from public.team_memberships where team_id = pg_temp.fx('band') and person_id = pg_temp.fx('riley');
-- Riley is still scheduled on a Band position of an unrelated plan role only
-- through the plan; the conversation here is the team one.
set local role authenticated;
select pg_temp.act_as('riley_u');
select pg_temp.check(not exists (select 1 from public.conversations where id = pg_temp.fx('band_chat')), 'Riley cannot open the conversation');
select pg_temp.check(not exists (select 1 from public.notifications where conversation_id = pg_temp.fx('band_chat')),
  'once access is lost the conversation notifications are not served');
select pg_temp.check(not exists (select 1 from public.notifications where body like 'SECRET-%'), 'no snippet readable after access loss');

-- Access regained: the (still valid) snippet is served again.
reset role;
insert into public.team_memberships select * from w7f_roster;
set local role authenticated;
select pg_temp.act_as('riley_u');
select pg_temp.check((select count(*) from public.notifications where body = 'SECRET-KEEP text') = 1,
  'regained access serves the surviving snippet again');

-- Mark-read and delete-own still work on visible rows.
update public.notifications set read_at = now() where conversation_id = pg_temp.fx('band_chat') and body = 'SECRET-KEEP text';
select pg_temp.check((select read_at is not null from public.notifications where body = 'SECRET-KEEP text'), 'mark-read still works');
delete from public.notifications where body = 'SECRET-KEEP text';
select pg_temp.check(not exists (select 1 from public.notifications where body = 'SECRET-KEEP text'), 'delete-own still works');

-- Retention prune (service role) still runs over redacted and hidden rows.
reset role;
update public.notifications set created_at = now() - interval '400 days' where conversation_id = pg_temp.fx('band_chat');
select pg_temp.check(public.prune_notifications(30, 90, 100) >= 2, 'retention prune removes redacted rows');
select pg_temp.check(not exists (select 1 from public.notifications where conversation_id = pg_temp.fx('band_chat')), 'pruned');

-- Hard delete of a message also clears snippets (no orphan text).
set local role authenticated;
select pg_temp.act_as('sam_u');
select public.post_conversation_message(gen_random_uuid(), pg_temp.fx('band_chat'), 'SECRET-HARD text', null, null);
reset role;
insert into public.notifications (organization_id, user_id, type, title, body, conversation_id, created_by, dedupe_key)
select pg_temp.fx('org'), pg_temp.fx('riley_u'), 'conversation_message', 'Sam in Band chat', 'SECRET-HARD text',
       pg_temp.fx('band_chat'), pg_temp.fx('sam_u'), e.id::text || ':' || pg_temp.fx('riley')::text
  from public.conversation_messages m join public.delivery_effects e on e.conversation_message_id = m.id
 where m.body = 'SECRET-HARD text';
delete from public.conversation_messages where body = 'SECRET-HARD text';
select pg_temp.check((select body from public.notifications where title = 'Sam in Band chat') is null, 'hard-deleted message clears the snippet');
delete from public.notifications where conversation_id = pg_temp.fx('band_chat');

-- Review follow-up: an edit that changes the excerpted text clears it; an
-- edit past the excerpt keeps it.
set local role authenticated;
select pg_temp.act_as('sam_u');
insert into w7f_fx values ('conv_msg_edit', gen_random_uuid()), ('conv_msg_tail', gen_random_uuid()),
  ('conv_msg_race', gen_random_uuid());
select public.post_conversation_message(pg_temp.fx('conv_msg_edit'), pg_temp.fx('band_chat'), 'SECRET-PHONE 555-0100', null, null);
select public.post_conversation_message(pg_temp.fx('conv_msg_tail'), pg_temp.fx('band_chat'), 'SECRET-TAIL   start of a long message', null, null);
select public.post_conversation_message(pg_temp.fx('conv_msg_race'), pg_temp.fx('band_chat'), 'SECRET-RACE text', null, null);
reset role;
insert into public.notifications (organization_id, user_id, type, title, body, conversation_id, created_by, dedupe_key)
select pg_temp.fx('org'), pg_temp.fx('riley_u'), 'conversation_message', 'Sam in Band chat', n.snippet,
       pg_temp.fx('band_chat'), pg_temp.fx('sam_u'), e.id::text || ':' || pg_temp.fx('riley')::text
  from (values ('conv_msg_edit', 'SECRET-PHONE 555-0100'), ('conv_msg_tail', 'SECRET-TAIL start of a…')) n(msg, snippet)
  join public.delivery_effects e on e.conversation_message_id = pg_temp.fx(n.msg);
select pg_temp.check((select count(*) from public.notifications where body like 'SECRET-%') = 2,
  'excerpts matching the message (whitespace collapsed, cut with …) are kept on insert');
set local role authenticated;
select pg_temp.act_as('sam_u');
select public.edit_conversation_message(pg_temp.fx('conv_msg_edit'), 'SECRET-PHONE removed');
select public.edit_conversation_message(pg_temp.fx('conv_msg_tail'), 'SECRET-TAIL start of a different ending');
reset role;
select pg_temp.check(not exists (select 1 from public.notifications where body like '%555-0100%'),
  'an edit that changes the excerpted text clears the excerpt');
select pg_temp.check(exists (select 1 from public.notifications where body = 'SECRET-TAIL start of a…'),
  'an edit past the excerpt keeps it');

-- Review follow-up: the worker read the message, then it was deleted before
-- the notification insert; the late insert carries no excerpt.
set local role authenticated;
select pg_temp.act_as('sam_u');
select public.delete_conversation_message(pg_temp.fx('conv_msg_race'));
reset role;
insert into public.notifications (organization_id, user_id, type, title, body, conversation_id, created_by, dedupe_key)
select pg_temp.fx('org'), pg_temp.fx('riley_u'), 'conversation_message', 'Sam in Band chat', 'SECRET-RACE text',
       pg_temp.fx('band_chat'), pg_temp.fx('sam_u'), e.id::text || ':' || pg_temp.fx('riley')::text
  from public.delivery_effects e where e.conversation_message_id = pg_temp.fx('conv_msg_race');
select pg_temp.check(exists (select 1 from public.notifications n join public.delivery_effects e
                               on n.dedupe_key = e.id::text || ':' || pg_temp.fx('riley')::text
                              where e.conversation_message_id = pg_temp.fx('conv_msg_race') and n.body is null),
  'a notification inserted after the message was deleted has no excerpt');

select 'qa-w7f-messaging: ok' as result;
rollback;
