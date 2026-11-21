-- ADR-0006: draft plans are quiet; publishing notifies. Uses the seed org and
-- people. Everything rolls back.
--   A. A draft plan queues nothing: enqueue_assignment_requests returns null.
--   B. A multi-plan release batch only asks for the published plan.
--   C. Reminders are only desired for published plans.
--   D. Publishing, by a plan editor who schedules no team, asks exactly the
--      released, not declined, never-notified people; a retry with the same
--      key returns the same effect; the preview counts the same people.
--   E. Re-publishing never re-asks people already notified.
--   F. A past plan is published silently.
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/publish-notifies.sql
-- (requires migration 20261129000010_publish_notifies.sql to be applied or loaded first)
begin;

create temporary table pn_fx (k text primary key, id uuid) on commit drop;
grant select on pn_fx to authenticated, service_role;

insert into pn_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('band', 'cccccccc-0000-4000-8000-000000000001'),
  ('owner', '11111111-1111-4111-8111-111111111111'),
  ('editor', '55555555-5555-4555-8555-555555555555'),
  ('draft', gen_random_uuid()), ('published', gen_random_uuid()),
  ('a_sam', gen_random_uuid()), ('a_riley', gen_random_uuid()),
  ('a_jordan', gen_random_uuid()), ('a_owner', gen_random_uuid()),
  ('a_pub', gen_random_uuid()), ('batch', gen_random_uuid());
insert into pn_fx
select 'sam', id from public.people where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' and profile_id = '33333333-3333-4333-8333-333333333333'
union all
select 'riley', id from public.people where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' and profile_id = '44444444-4444-4444-8444-444444444444'
union all
select 'jordan', id from public.people where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' and profile_id = '22222222-2222-4222-8222-222222222222'
union all
select 'owner_person', id from public.people where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' and profile_id = '11111111-1111-4111-8111-111111111111';

create or replace function pg_temp.fx(p text) returns uuid language sql stable as
  $$ select id from pn_fx where k = p $$;
create or replace function pg_temp.check(ok boolean, message text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'publish-notifies check failed: %', message; end if;
end $$;

-- The editor may edit plans org-wide but schedules no team.
update public.organization_members set role = 'member', access_mode = 'scoped'
 where organization_id = pg_temp.fx('org') and user_id = pg_temp.fx('editor');
delete from public.access_grants where organization_id = pg_temp.fx('org') and user_id = pg_temp.fx('editor');
insert into public.access_grants (organization_id, user_id, capability, scope_type, created_by)
values (pg_temp.fx('org'), pg_temp.fx('editor'), 'plans.edit', 'organization', pg_temp.fx('owner'));

insert into public.plans (id, organization_id, title, service_date, status) values
  (pg_temp.fx('draft'), pg_temp.fx('org'), 'ADR-0006 draft', now() + interval '3 days', 'draft'),
  (pg_temp.fx('published'), pg_temp.fx('org'), 'ADR-0006 published', now() + interval '4 days', 'published');

-- Sam: released, never notified (asked). Riley: released, already notified.
-- Jordan: prepared (stays prepared). Owner: declined.
insert into public.assignments (id, plan_id, person_id, user_id, team_id, status, visibility, notified_at) values
  (pg_temp.fx('a_sam'), pg_temp.fx('draft'), pg_temp.fx('sam'), '33333333-3333-4333-8333-333333333333', pg_temp.fx('band'), 'unconfirmed', 'released', null),
  (pg_temp.fx('a_riley'), pg_temp.fx('draft'), pg_temp.fx('riley'), '44444444-4444-4444-8444-444444444444', pg_temp.fx('band'), 'unconfirmed', 'released', now() - interval '1 day'),
  (pg_temp.fx('a_jordan'), pg_temp.fx('draft'), pg_temp.fx('jordan'), '22222222-2222-4222-8222-222222222222', pg_temp.fx('band'), 'unconfirmed', 'prepared', null),
  (pg_temp.fx('a_owner'), pg_temp.fx('draft'), pg_temp.fx('owner_person'), pg_temp.fx('owner'), pg_temp.fx('band'), 'declined', 'released', null),
  (pg_temp.fx('a_pub'), pg_temp.fx('published'), pg_temp.fx('sam'), '33333333-3333-4333-8333-333333333333', pg_temp.fx('band'), 'unconfirmed', 'released', null);

-- ================================================================ Pass A ===
do $$
begin
  perform pg_temp.check(private.enqueue_assignment_requests(
    pg_temp.fx('draft'), 'assignment_request', array[pg_temp.fx('a_sam')], 'pn-a', null) is null,
    'A: a draft plan queues no request');
  perform pg_temp.check(not exists (select 1 from public.delivery_effects where effect_key = 'pn-a'),
    'A: no effect recorded for a draft');
  update public.plans set status = 'archived' where id = pg_temp.fx('draft');
  perform pg_temp.check(private.enqueue_assignment_requests(
    pg_temp.fx('draft'), 'assignment_request', array[pg_temp.fx('a_sam')], 'pn-a2', null) is null,
    'A: an archived plan queues no request');
  update public.plans set status = 'draft' where id = pg_temp.fx('draft');
end $$;

-- ================================================================ Pass B ===
do $$
declare v_effect uuid; v_ids uuid[];
begin
  insert into public.release_batches (id, organization_id, created_by, idempotency_key, request_hash, notify,
                                      scheduled_for, status, item_count, plan_count)
  values (pg_temp.fx('batch'), pg_temp.fx('org'), pg_temp.fx('owner'), 'pn-batch', 'pn-hash', true,
          now(), 'scheduled', 2, 2);
  insert into public.release_batch_items (batch_id, plan_id, assignment_id, expected_request_revision) values
    (pg_temp.fx('batch'), pg_temp.fx('draft'), pg_temp.fx('a_sam'), 0),
    (pg_temp.fx('batch'), pg_temp.fx('published'), pg_temp.fx('a_pub'), 0);
  v_effect := private.enqueue_release_batch_requests(pg_temp.fx('batch'));
  select assignment_ids into v_ids from public.delivery_effects where id = v_effect;
  perform pg_temp.check(v_ids = array[pg_temp.fx('a_pub')], 'B: the batch asks only for the published plan');
  perform pg_temp.check(not exists (select 1 from public.assignment_request_snapshots
                                     where effect_id = v_effect and plan_id = pg_temp.fx('draft')),
    'B: no snapshot for the draft plan');
  delete from public.deliveries where effect_id = v_effect;
end $$;

-- ================================================================ Pass C ===
do $$
begin
  perform pg_temp.check(not exists (select 1 from private.desired_plan_reminders(pg_temp.fx('draft'))),
    'C: a draft plan wants no reminders');
end $$;

-- ================================================================ Pass D ===
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.fx('editor'), 'role', 'authenticated')::text, true);
do $$
declare v_preview record; v_result record; v_ids uuid[]; v_people uuid[]; v_replay uuid;
begin
  perform pg_temp.check(not public.can_schedule_on_plan(pg_temp.fx('draft'), pg_temp.fx('band')),
    'D: the editor does not schedule the band');
  select * into v_preview from public.publish_plan_notify_preview(pg_temp.fx('draft'));
  perform pg_temp.check(v_preview.will_notify = 1 and v_preview.no_email = '{}', 'D: the preview counts Sam only');

  select * into v_result from public.publish_plan_notify(pg_temp.fx('draft'), true, 'pn-publish');
  perform pg_temp.check((v_result.plan).status = 'published', 'D: the plan is published');
  perform pg_temp.check(v_result.effect_id is not null, 'D: publishing recorded an effect');
  select assignment_ids into v_ids from public.delivery_effects where id = v_result.effect_id;
  perform pg_temp.check(v_ids = array[pg_temp.fx('a_sam')], 'D: only the released, never-notified, undeclined request is asked');
  select array_agg(distinct recipient_person_id) into v_people from public.deliveries where effect_id = v_result.effect_id;
  perform pg_temp.check(v_people = array[pg_temp.fx('sam')], 'D: one recipient, Sam');

  select effect_id into v_replay from public.publish_plan_notify(pg_temp.fx('draft'), true, 'pn-publish');
  perform pg_temp.check(v_replay = v_result.effect_id, 'D: the same key returns the same effect');
  perform pg_temp.check((select will_notify from public.publish_plan_notify_preview(pg_temp.fx('draft'))) = 0,
    'D: nothing is left to publish');
end $$;
reset role;

-- ================================================================ Pass E ===
do $$
declare v_effect uuid;
begin
  perform pg_temp.check((select visibility from public.assignments where id = pg_temp.fx('a_jordan')) = 'prepared',
    'D: a prepared request stays prepared');
  -- Sam's request went out; then the plan is unpublished and published again.
  update public.assignments set notified_at = now() where id = pg_temp.fx('a_sam');
  update public.plans set status = 'draft' where id = pg_temp.fx('draft');
  select effect_id into v_effect from public.publish_plan_notify(pg_temp.fx('draft'), true, 'pn-republish');
  perform pg_temp.check(v_effect is null, 'E: re-publishing asks nobody already notified');

  -- Reached without an accepted email (simulated send, or in-app only):
  -- notified_at stays null, and re-publishing still asks nobody.
  update public.assignments set notified_at = null where id = pg_temp.fx('a_sam');
  update public.deliveries d set status = 'simulated'
    from public.delivery_effects e
   where e.id = d.effect_id and e.effect_key = 'pn-publish' and d.channel = 'email';
  update public.plans set status = 'draft' where id = pg_temp.fx('draft');
  perform pg_temp.check((select will_notify from public.publish_plan_notify_preview(pg_temp.fx('draft'))) = 0,
    'E: the preview counts nobody a request already reached');
  select effect_id into v_effect from public.publish_plan_notify(pg_temp.fx('draft'), true, 'pn-republish-simulated');
  perform pg_temp.check(v_effect is null, 'E: re-publishing asks nobody a request already reached');
  update public.deliveries d set status = 'queued'
    from public.delivery_effects e
   where e.id = d.effect_id and e.effect_key = 'pn-publish' and d.channel = 'email';
end $$;

-- ================================================================ Pass F ===
do $$
declare v_result record;
begin
  update public.assignments set notified_at = null where id = pg_temp.fx('a_sam');
  update public.plans set status = 'draft', service_date = now() - interval '2 days' where id = pg_temp.fx('draft');
  perform pg_temp.check((select will_notify from public.publish_plan_notify_preview(pg_temp.fx('draft'))) = 0,
    'F: the preview of a past plan emails nobody');
  select * into v_result from public.publish_plan_notify(pg_temp.fx('draft'), true, 'pn-past');
  perform pg_temp.check((v_result.plan).status = 'published' and v_result.effect_id is null,
    'F: a past plan is published silently');

  -- notify = false publishes silently too.
  update public.plans set status = 'draft', service_date = now() + interval '2 days' where id = pg_temp.fx('draft');
  select * into v_result from public.publish_plan_notify(pg_temp.fx('draft'), false, 'pn-quiet');
  perform pg_temp.check((v_result.plan).status = 'published' and v_result.effect_id is null,
    'F: publishing with notify off asks nobody');
end $$;

select 'publish-notifies: all checks passed' as result;
rollback;
