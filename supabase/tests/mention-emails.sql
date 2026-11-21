-- ADR-0007: mention emails are queued with a delay, collapsed per person per
-- thread while queued, never for no-login people or opted-out people, and
-- `mention_email_batch` reports what is still unread at send time.
-- Everything rolls back.
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/mention-emails.sql
begin;

create temporary table me_fx (k text primary key, id uuid) on commit drop;
grant select, insert, update, delete on me_fx to authenticated, service_role;

insert into me_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('sunday', 'bbbbbbbb-0000-4000-8000-000000000001'),
  ('band', 'cccccccc-0000-4000-8000-000000000001'),
  ('production', 'cccccccc-0000-4000-8000-000000000002'),
  ('electric', 'dddddddd-0000-4000-8000-000000000003'),
  ('drums', 'dddddddd-0000-4000-8000-000000000005'),
  ('lyrics', 'dddddddd-0000-4000-8000-000000000008'),
  ('jordan', '22222222-2222-4222-8222-222222222222'),
  ('sam_u', '33333333-3333-4333-8333-333333333333'),
  ('riley_u', '44444444-4444-4444-8444-444444444444'),
  ('sam', (select id from public.people where profile_id = '33333333-3333-4333-8333-333333333333')),
  ('riley', (select id from public.people where profile_id = '44444444-4444-4444-8444-444444444444')),
  ('plan', gen_random_uuid()), ('item', gen_random_uuid()), ('item2', gen_random_uuid()), ('guest', gen_random_uuid()),
  ('m1', gen_random_uuid()), ('m2', gen_random_uuid()), ('m3', gen_random_uuid()), ('m4', gen_random_uuid()),
  ('c1', gen_random_uuid()), ('c2', gen_random_uuid()), ('c3', gen_random_uuid());

create or replace function pg_temp.fx(p text) returns uuid language sql stable as
  $$ select id from me_fx where k = p $$;

create or replace function pg_temp.check(ok boolean, message text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'mention-emails check failed: %', message; end if;
end $$;

-- Email rows queued for one person on one effect source.
create or replace function pg_temp.chat_emails(p_message uuid, p_person uuid) returns setof public.deliveries
language sql stable as $$
  select d.* from public.deliveries d join public.delivery_effects e on e.id = d.effect_id
   where e.conversation_message_id = p_message and d.recipient_person_id = p_person and d.channel = 'email'
$$;
create or replace function pg_temp.comment_emails(p_comment uuid, p_person uuid) returns setof public.deliveries
language sql stable as $$
  select d.* from public.deliveries d join public.delivery_effects e on e.id = d.effect_id
   where e.comment_id = p_comment and d.recipient_person_id = p_person and d.channel = 'email'
$$;

insert into public.people (id, organization_id, first_name, last_name, email)
values (pg_temp.fx('guest'), pg_temp.fx('org'), 'Gale', 'Guest', 'gale@example.com');
insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by)
values (pg_temp.fx('plan'), pg_temp.fx('org'), pg_temp.fx('sunday'), 'Mention plan', now() + interval '500 days', 'published', pg_temp.fx('jordan'));
insert into public.plan_items (id, plan_id, item_type, title, sort_order)
values (pg_temp.fx('item'), pg_temp.fx('plan'), 'item', 'Welcome', 0),
       (pg_temp.fx('item2'), pg_temp.fx('plan'), 'item', 'Offering', 1);
insert into public.assignments (plan_id, person_id, user_id, team_id, position_id, status, created_by, visibility, released_at, attendance_mode)
values
  (pg_temp.fx('plan'), pg_temp.fx('sam'), pg_temp.fx('sam_u'), pg_temp.fx('band'), pg_temp.fx('electric'), 'confirmed', pg_temp.fx('jordan'), 'released', now(), 'all'),
  (pg_temp.fx('plan'), pg_temp.fx('riley'), pg_temp.fx('riley_u'), pg_temp.fx('production'), pg_temp.fx('lyrics'), 'unconfirmed', pg_temp.fx('jordan'), 'released', now(), 'all'),
  (pg_temp.fx('plan'), pg_temp.fx('guest'), null, pg_temp.fx('band'), pg_temp.fx('drums'), 'unconfirmed', pg_temp.fx('jordan'), 'released', now(), 'all');

-- ------------------------------------------------------------- chat ----
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
insert into me_fx select 'band_chat', (public.open_conversation('team', pg_temp.fx('band'))).id;

-- Default delay: ten minutes. The no-login guest gets no email.
select public.post_conversation_message(pg_temp.fx('m1'), pg_temp.fx('band_chat'), '@Riley can you bring the capo?', null,
  array[pg_temp.fx('riley'), pg_temp.fx('guest')]);
reset role;
select pg_temp.check((select resolution from public.conversation_message_mentions
  where message_id = pg_temp.fx('m1') and person_id = pg_temp.fx('riley')) = 'notified', 'Riley is notified');
select pg_temp.check((select count(*) from pg_temp.chat_emails(pg_temp.fx('m1'), pg_temp.fx('riley'))) = 1, 'mention queues one email');
select pg_temp.check((select next_attempt_at = now() + interval '600 seconds' and status = 'queued'
  from pg_temp.chat_emails(pg_temp.fx('m1'), pg_temp.fx('riley'))), 'email is due in ten minutes');
select pg_temp.check(not exists (select 1 from public.deliveries d join public.delivery_effects e on e.id = d.effect_id
  where e.conversation_message_id = pg_temp.fx('m1') and d.recipient_person_id = pg_temp.fx('guest')), 'no_login gets nothing');
insert into me_fx select 'd1', id from pg_temp.chat_emails(pg_temp.fx('m1'), pg_temp.fx('riley'));

-- A second mention in the same chat while the first is queued: collapsed.
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
select public.post_conversation_message(pg_temp.fx('m2'), pg_temp.fx('band_chat'), '@Riley and the spare strings', null,
  array[pg_temp.fx('riley')], 0);
reset role;
select pg_temp.check(not exists (select 1 from pg_temp.chat_emails(pg_temp.fx('m2'), pg_temp.fx('riley'))), 'second mention is collapsed');
select pg_temp.check((select mention_count from public.mention_email_batch(pg_temp.fx('d1'))) = 2, 'the queued email covers both mentions');
-- The worker's own role can call the batch; members cannot.
set local role authenticated;
do $$ begin
  perform public.mention_email_batch(pg_temp.fx('d1'));
  raise exception 'a member called mention_email_batch';
exception when insufficient_privilege then null; end $$;

-- Read before due: nothing left to email.
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
select public.mark_conversation_read(pg_temp.fx('band_chat'), now());
reset role;
select pg_temp.check((select mention_count from public.mention_email_batch(pg_temp.fx('d1'))) = 0, 'read mentions are not emailed');

-- Once the first email has gone out, a new mention queues a new one, now
-- with no delay (worker unconfigured).
update public.deliveries set status = 'cancelled', completed_at = now() where id = pg_temp.fx('d1');
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
select public.post_conversation_message(pg_temp.fx('m3'), pg_temp.fx('band_chat'), '@Riley soundcheck at 8', null,
  array[pg_temp.fx('riley')], 0);
reset role;
select pg_temp.check((select next_attempt_at = now() from pg_temp.chat_emails(pg_temp.fx('m3'), pg_temp.fx('riley'))),
  'unconfigured worker: due now');

-- A muted chat resolves the mention as muted: no email.
update public.deliveries set status = 'cancelled', completed_at = now()
 where id in (select id from pg_temp.chat_emails(pg_temp.fx('m3'), pg_temp.fx('riley')));
set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
select public.set_conversation_muted(pg_temp.fx('band_chat'), true);
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
select public.post_conversation_message(pg_temp.fx('m4'), pg_temp.fx('band_chat'), '@Riley ping', null, array[pg_temp.fx('riley')]);
reset role;
select pg_temp.check(not exists (select 1 from pg_temp.chat_emails(pg_temp.fx('m4'), pg_temp.fx('riley'))), 'muted gets no email');

-- --------------------------------------------------------- comments ----
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
select public.post_item_comment(pg_temp.fx('c1'), pg_temp.fx('item'), '@Riley lyrics for this?', array[pg_temp.fx('riley')]);
reset role;
select pg_temp.check((select next_attempt_at = now() + interval '600 seconds'
  from pg_temp.comment_emails(pg_temp.fx('c1'), pg_temp.fx('riley'))), 'comment mention email due in ten minutes');
insert into me_fx select 'dc1', id from pg_temp.comment_emails(pg_temp.fx('c1'), pg_temp.fx('riley'));
select pg_temp.check((select mention_count from public.mention_email_batch(pg_temp.fx('dc1'))) = 1, 'one unread comment mention');

-- Marking the mention's feed row read counts as seen.
insert into public.notifications (organization_id, user_id, type, title, plan_id, plan_item_id, dedupe_key, read_at)
select pg_temp.fx('org'), pg_temp.fx('riley_u'), 'comment_mention', 'x', pg_temp.fx('plan'), pg_temp.fx('item'),
       e.id::text || ':' || pg_temp.fx('riley')::text, now()
  from public.delivery_effects e where e.comment_id = pg_temp.fx('c1');
select pg_temp.check((select mention_count from public.mention_email_batch(pg_temp.fx('dc1'))) = 0, 'read feed row cancels');

-- Opt-out: no email, even on another item.
insert into public.person_reminder_preferences (person_id, organization_id, mention_email)
values (pg_temp.fx('riley'), pg_temp.fx('org'), false);
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
select public.post_item_comment(pg_temp.fx('c2'), pg_temp.fx('item2'), '@Riley offering slides?', array[pg_temp.fx('riley')]);
reset role;
select pg_temp.check(not exists (select 1 from pg_temp.comment_emails(pg_temp.fx('c2'), pg_temp.fx('riley'))), 'opted out gets no email');
select pg_temp.check((select count(*) from public.deliveries d join public.delivery_effects e on e.id = d.effect_id
  where e.comment_id = pg_temp.fx('c2') and d.recipient_person_id = pg_temp.fx('riley')) = 2, 'opt-out keeps feed and push');

-- The owner can still change the setting under RLS.
set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
update public.person_reminder_preferences set mention_email = true where person_id = pg_temp.fx('riley');
reset role;
select pg_temp.check((select mention_email from public.person_reminder_preferences where person_id = pg_temp.fx('riley')),
  'Riley can turn mention emails back on');

rollback;
