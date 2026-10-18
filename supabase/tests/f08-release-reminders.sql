-- F08: consolidated/scheduled release, scoped-link continuity, reminder
-- policies and durable reminder jobs. Run against a seeded local database.
-- Everything rolls back. "Fake clock": due/scheduled instants are moved into
-- the past instead of waiting.
begin;

create temporary table f08 (k text primary key, id uuid) on commit drop;
grant select, insert, update on f08 to authenticated, service_role;

insert into f08 values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('band', 'cccccccc-0000-4000-8000-000000000001'),
  ('production', 'cccccccc-0000-4000-8000-000000000002'),
  ('sam', (select id from public.people where profile_id = '33333333-3333-4333-8333-333333333333')),
  ('riley', (select id from public.people where profile_id = '44444444-4444-4444-8444-444444444444')),
  ('morgan', (select id from public.people where profile_id = '55555555-5555-4555-8555-555555555555')),
  ('guest', gen_random_uuid()),
  ('guest2', gen_random_uuid()),
  ('plan_a', gen_random_uuid()), ('plan_b', gen_random_uuid()),
  ('plan_d', gen_random_uuid()), ('plan_e', gen_random_uuid()),
  ('d_rehearsal', gen_random_uuid()), ('d_service', gen_random_uuid());

insert into public.people (id, organization_id, first_name, email) values
  ((select id from f08 where k = 'guest'), (select id from f08 where k = 'org'), 'F08 Guest', 'f08-guest@example.test'),
  ((select id from f08 where k = 'guest2'), (select id from f08 where k = 'org'), 'F08 Guest Two', 'f08-guest2@example.test');

insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by)
select f.id, (select id from f08 where k = 'org'), 'bbbbbbbb-0000-4000-8000-000000000001',
       'F08 ' || f.k, now() + (d || ' days')::interval, 'published', '22222222-2222-4222-8222-222222222222'
  from f08 f join (values ('plan_a', 300), ('plan_b', 301), ('plan_d', 310), ('plan_e', 311)) v(k, d) on v.k = f.k;
insert into public.plan_times (plan_id, kind, name, starts_at, ends_at, sort_order)
select f.id, 'service', 'Service', p.service_date, p.service_date + interval '1 hour', 1
  from f08 f join public.plans p on p.id = f.id where f.k in ('plan_a', 'plan_b', 'plan_e');
insert into public.plan_times (id, plan_id, kind, name, starts_at, ends_at, sort_order) values
  ((select id from f08 where k = 'd_rehearsal'), (select id from f08 where k = 'plan_d'), 'rehearsal', 'Rehearsal',
   now() + interval '309 days', now() + interval '309 days 2 hours', 0),
  ((select id from f08 where k = 'd_service'), (select id from f08 where k = 'plan_d'), 'service', 'Service',
   now() + interval '310 days', now() + interval '310 days 1 hour', 1);

-- ============================================================ release =====
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

select count(*) from public.schedule_plan_assignments((select id from f08 where k = 'plan_a'), jsonb_build_array(
  jsonb_build_object('person_id', (select id from f08 where k = 'sam'), 'team_id', (select id from f08 where k = 'band'),
                     'position_id', 'dddddddd-0000-4000-8000-000000000003', 'visibility', 'prepared', 'attendance_mode', 'all'),
  jsonb_build_object('person_id', (select id from f08 where k = 'riley'), 'team_id', (select id from f08 where k = 'band'),
                     'position_id', 'dddddddd-0000-4000-8000-000000000005', 'visibility', 'prepared', 'attendance_mode', 'all')
), false, 'f08-sched-a');
select count(*) from public.schedule_plan_assignments((select id from f08 where k = 'plan_b'), jsonb_build_array(
  jsonb_build_object('person_id', (select id from f08 where k = 'sam'), 'team_id', (select id from f08 where k = 'band'),
                     'position_id', 'dddddddd-0000-4000-8000-000000000003', 'visibility', 'prepared', 'attendance_mode', 'all')
), false, 'f08-sched-b');

insert into f08 select 'sam_a', id from public.assignments where plan_id = (select id from f08 where k = 'plan_a') and person_id = (select id from f08 where k = 'sam');
insert into f08 select 'riley_a', id from public.assignments where plan_id = (select id from f08 where k = 'plan_a') and person_id = (select id from f08 where k = 'riley');
insert into f08 select 'sam_b', id from public.assignments where plan_id = (select id from f08 where k = 'plan_b') and person_id = (select id from f08 where k = 'sam');

-- Prepared rows are invisible to the recipient.
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$ begin
  if exists (select 1 from public.assignments where id in (select id from f08 where k in ('sam_a', 'sam_b'))) then
    raise exception 'prepared request visible to its recipient';
  end if;
end $$;
-- A member cannot release.
do $$ begin
  perform public.create_release_batch((select id from f08 where k = 'org'),
    jsonb_build_array(jsonb_build_object('assignment_id', (select id from f08 where k = 'sam_a'), 'request_revision', 0)),
    true, null, 'f08-member-key');
  raise exception 'member released a request';
exception when sqlstate 'P0002' then null;
end $$;

set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
-- A stale review releases nothing.
do $$ begin
  perform public.create_release_batch((select id from f08 where k = 'org'),
    (select jsonb_agg(jsonb_build_object('assignment_id', a.id, 'request_revision', a.request_revision + 1))
       from public.assignments a where a.id in (select id from f08 where k in ('sam_a', 'sam_b', 'riley_a'))),
    true, null, 'f08-stale-key');
  raise exception 'stale review released';
exception when sqlstate 'PT409' then null;
end $$;
do $$ begin
  if exists (select 1 from public.assignments where id in (select id from f08 where k in ('sam_a', 'sam_b', 'riley_a'))
              and visibility <> 'prepared') then raise exception 'stale review leaked a release'; end if;
end $$;

-- The reviewed set across two plans is released in one batch.
insert into f08
select 'batch', (public.create_release_batch((select id from f08 where k = 'org'),
  (select jsonb_agg(jsonb_build_object('assignment_id', a.id, 'request_revision', a.request_revision))
     from public.assignments a where a.id in (select id from f08 where k in ('sam_a', 'sam_b', 'riley_a'))),
  true, null, 'f08-batch-key-1')).id;

reset role;
set local request.jwt.claim.sub = '';
do $$
declare v_batch public.release_batches; v_effect public.delivery_effects;
begin
  select * into v_batch from public.release_batches where id = (select id from f08 where k = 'batch');
  if v_batch.status <> 'released' or v_batch.plan_count <> 2 or v_batch.item_count <> 3 then
    raise exception 'batch not released as reviewed: %', v_batch;
  end if;
  select * into v_effect from public.delivery_effects where id = v_batch.effect_id;
  if v_effect.plan_id is not null or cardinality(v_effect.assignment_ids) <> 3 or v_effect.release_batch_id <> v_batch.id then
    raise exception 'batch effect is not one consolidated effect';
  end if;
  -- Sam: one snapshot per plan, one delivery per channel (one message).
  if (select count(*) from public.assignment_request_snapshots
       where effect_id = v_effect.id and person_id = (select id from f08 where k = 'sam')) <> 2 then
    raise exception 'Sam should get a separate snapshot per plan';
  end if;
  if (select count(*) from public.assignment_request_snapshot_items i
        join public.assignment_request_snapshots s on s.id = i.snapshot_id
       where s.effect_id = v_effect.id and s.plan_id = (select id from f08 where k = 'plan_a')
         and s.person_id = (select id from f08 where k = 'sam')) <> 1 then
    raise exception 'plan A snapshot must hold only plan A';
  end if;
  if (select count(*) from public.deliveries where effect_id = v_effect.id
        and recipient_person_id = (select id from f08 where k = 'sam')) <> 3 then
    raise exception 'Sam should get one delivery per channel for the whole batch';
  end if;
  insert into f08 values ('batch_effect', v_effect.id);
end $$;

-- Repeating the release is idempotent; reusing the key for other content is refused.
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$ begin
  if (public.create_release_batch((select id from f08 where k = 'org'),
        (select jsonb_agg(jsonb_build_object('assignment_id', i.assignment_id, 'request_revision', i.expected_request_revision))
           from public.release_batch_items i where i.batch_id = (select id from f08 where k = 'batch')),
        true, null, 'f08-batch-key-1')).id <> (select id from f08 where k = 'batch') then
    raise exception 'repeat release created another batch';
  end if;
  begin
    perform public.create_release_batch((select id from f08 where k = 'org'),
      jsonb_build_array(jsonb_build_object('assignment_id', (select id from f08 where k = 'sam_a'), 'request_revision', 0)),
      true, null, 'f08-batch-key-1');
    raise exception 'key reuse accepted';
  exception when sqlstate 'PT409' then null;
  end;
end $$;
reset role;
set local request.jwt.claim.sub = '';
do $$ begin
  if (select count(*) from public.delivery_effects where release_batch_id = (select id from f08 where k = 'batch')) <> 1 then
    raise exception 'repeat release added effects';
  end if;
end $$;

-- ============================================= per-plan scoped links =====
create function pg_temp.sam_snapshot(p_plan text) returns uuid language sql as $$
  select s.id from public.assignment_request_snapshots s
   where s.effect_id = (select id from f08 where k = 'batch_effect')
     and s.person_id = (select id from f08 where k = 'sam') and s.plan_id = (select id from f08 where k = p_plan);
$$;
create function pg_temp.email_delivery(p_effect uuid, p_person text) returns uuid language sql as $$
  select d.id from public.deliveries d where d.effect_id = p_effect and d.channel = 'email'
     and d.recipient_person_id = (select id from f08 where k = p_person);
$$;
-- Records a provider-accepted email the way the worker does.
create function pg_temp.accept(p_delivery uuid) returns void language plpgsql as $$
begin
  update public.deliveries set status = 'sending', attempts = attempts + 1, lease_owner = 'f08-test',
         lease_expires_at = now() + interval '1 minute' where id = p_delivery;
  perform public.complete_delivery(p_delivery, 'f08-test', 'provider_accepted', null, 'msg-' || p_delivery::text, null);
end $$;

select public.issue_assignment_link(pg_temp.email_delivery((select id from f08 where k = 'batch_effect'), 'sam'),
  pg_temp.sam_snapshot('plan_a'), 'f08-hash-a1', now() + interval '400 days', 'sam@example.com');
select public.issue_assignment_link(pg_temp.email_delivery((select id from f08 where k = 'batch_effect'), 'sam'),
  pg_temp.sam_snapshot('plan_b'), 'f08-hash-b1', now() + interval '400 days', 'sam@example.com');
-- Re-issuing the same deterministic token is a no-op.
select public.issue_assignment_link(pg_temp.email_delivery((select id from f08 where k = 'batch_effect'), 'sam'),
  pg_temp.sam_snapshot('plan_a'), 'f08-hash-a1', now() + interval '400 days', 'sam@example.com');

-- Plan A's action answers plan A only.
do $$
declare v_outcome text;
begin
  select outcome into v_outcome from public.respond_via_assignment_link('f08-hash-a1', 'confirmed');
  if v_outcome <> 'ok' then raise exception 'plan A link failed: %', v_outcome; end if;
  if (select status from public.assignments where id = (select id from f08 where k = 'sam_a')) <> 'confirmed'
     or (select status from public.assignments where id = (select id from f08 where k = 'sam_b')) <> 'unconfirmed' then
    raise exception 'one plan action answered another plan';
  end if;
  select outcome into v_outcome from public.respond_via_assignment_link('f08-hash-a1', 'declined');
  if v_outcome <> 'used' then raise exception 'replayed link was not refused: %', v_outcome; end if;
end $$;

-- ============================================== link continuity ===========
-- Accepting the batch email promotes plan B's link and marks Sam notified.
select pg_temp.accept(pg_temp.email_delivery((select id from f08 where k = 'batch_effect'), 'sam'));
do $$ begin
  if (select sent_at from public.assignment_notifications where token_hash = 'f08-hash-b1') is null then
    raise exception 'accepted link not marked sent';
  end if;
  if (select notified_at from public.assignments where id = (select id from f08 where k = 'sam_b')) is null then
    raise exception 'accepted email did not mark the Person notified';
  end if;
end $$;

-- A resend (manual reminder) issues a fresh token; the accepted one keeps working.
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
insert into f08 select 'resend_effect', public.enqueue_plan_notifications((select id from f08 where k = 'plan_b'),
  'assignment_reminder', array[(select id from f08 where k = 'sam_b')], 'f08-resend-1');
reset role;
set local request.jwt.claim.sub = '';
create function pg_temp.resend_snapshot() returns uuid language sql as $$
  select s.id from public.assignment_request_snapshots s where s.effect_id = (select id from f08 where k = 'resend_effect');
$$;
select public.issue_assignment_link(pg_temp.email_delivery((select id from f08 where k = 'resend_effect'), 'sam'),
  pg_temp.resend_snapshot(), 'f08-hash-b2', now() + interval '400 days', 'sam@example.com');
do $$ begin
  if (select previous_token_hash from public.assignment_notifications where token_hash = 'f08-hash-b2') <> 'f08-hash-b1' then
    raise exception 'accepted token was not kept as previous';
  end if;
  if (select superseded_at from public.assignment_request_snapshots where id = pg_temp.sam_snapshot('plan_b')) is not null then
    raise exception 'previous link snapshot was superseded before the replacement was accepted';
  end if;
end $$;
-- The resend fails and is retried with another token: the unaccepted one is
-- replaced, the accepted previous one is still kept.
select public.issue_assignment_link(pg_temp.email_delivery((select id from f08 where k = 'resend_effect'), 'sam'),
  pg_temp.resend_snapshot(), 'f08-hash-b3', now() + interval '400 days', 'sam@example.com');
do $$
declare v_outcome text;
begin
  if (select previous_token_hash from public.assignment_notifications where token_hash = 'f08-hash-b3') <> 'f08-hash-b1' then
    raise exception 'retry dropped the only accepted link';
  end if;
  select outcome into v_outcome from public.respond_via_assignment_link('f08-hash-b2', 'confirmed');
  if v_outcome <> 'not_found' then raise exception 'unaccepted replaced token still works: %', v_outcome; end if;
  -- The person still holds only the accepted email: it answers its exact scope.
  select outcome into v_outcome from public.respond_via_assignment_link('f08-hash-b1', 'declined');
  if v_outcome <> 'ok' then raise exception 'previous accepted link failed: %', v_outcome; end if;
  if (select status from public.assignments where id = (select id from f08 where k = 'sam_b')) <> 'declined' then
    raise exception 'previous link did not answer plan B';
  end if;
  select outcome into v_outcome from public.respond_via_assignment_link('f08-hash-b3', 'confirmed');
  if v_outcome <> 'used' then raise exception 'second token answered a consumed request: %', v_outcome; end if;
end $$;

-- Acceptance of the replacement retires the previous token (Riley, plan A).
select public.issue_assignment_link(pg_temp.email_delivery((select id from f08 where k = 'batch_effect'), 'riley'),
  (select id from public.assignment_request_snapshots where effect_id = (select id from f08 where k = 'batch_effect')
      and person_id = (select id from f08 where k = 'riley')), 'f08-hash-r1', now() + interval '400 days', 'riley@example.com');
select pg_temp.accept(pg_temp.email_delivery((select id from f08 where k = 'batch_effect'), 'riley'));
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
insert into f08 select 'riley_resend', public.enqueue_plan_notifications((select id from f08 where k = 'plan_a'),
  'assignment_reminder', array[(select id from f08 where k = 'riley_a')], 'f08-resend-riley');
reset role;
set local request.jwt.claim.sub = '';
select public.issue_assignment_link(pg_temp.email_delivery((select id from f08 where k = 'riley_resend'), 'riley'),
  (select id from public.assignment_request_snapshots where effect_id = (select id from f08 where k = 'riley_resend')),
  'f08-hash-r2', now() + interval '400 days', 'riley@example.com');
select pg_temp.accept(pg_temp.email_delivery((select id from f08 where k = 'riley_resend'), 'riley'));
do $$
declare v_outcome text;
begin
  if (select previous_token_hash from public.assignment_notifications where token_hash = 'f08-hash-r2') is not null then
    raise exception 'previous token survived acceptance of its replacement';
  end if;
  select outcome into v_outcome from public.respond_via_assignment_link('f08-hash-r1', 'confirmed');
  if v_outcome <> 'not_found' then raise exception 'retired token still answers: %', v_outcome; end if;
  select outcome into v_outcome from public.respond_via_assignment_link('f08-hash-r2', 'confirmed');
  if v_outcome <> 'ok' then raise exception 'replacement token failed: %', v_outcome; end if;
end $$;

-- ================================================= scheduled release ======
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
select count(*) from public.schedule_plan_assignments((select id from f08 where k = 'plan_e'), jsonb_build_array(
  jsonb_build_object('person_id', (select id from f08 where k = 'riley'), 'team_id', (select id from f08 where k = 'band'),
                     'position_id', 'dddddddd-0000-4000-8000-000000000005', 'visibility', 'prepared', 'attendance_mode', 'all'),
  jsonb_build_object('person_id', (select id from f08 where k = 'morgan'), 'team_id', (select id from f08 where k = 'band'),
                     'position_id', 'dddddddd-0000-4000-8000-000000000006', 'visibility', 'prepared', 'attendance_mode', 'all'),
  jsonb_build_object('person_id', (select id from f08 where k = 'sam'), 'team_id', (select id from f08 where k = 'band'),
                     'position_id', 'dddddddd-0000-4000-8000-000000000004', 'visibility', 'prepared', 'attendance_mode', 'all')
), false, 'f08-sched-e');
insert into f08 select 'riley_e', id from public.assignments where plan_id = (select id from f08 where k = 'plan_e') and person_id = (select id from f08 where k = 'riley');
insert into f08 select 'morgan_e', id from public.assignments where plan_id = (select id from f08 where k = 'plan_e') and person_id = (select id from f08 where k = 'morgan');
insert into f08 select 'sam_e', id from public.assignments where plan_id = (select id from f08 where k = 'plan_e') and person_id = (select id from f08 where k = 'sam');

create function pg_temp.items(p_key text) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('assignment_id', a.id, 'request_revision', a.request_revision))
    from public.assignments a where a.id = (select id from f08 where k = p_key);
$$;
insert into f08 select 'sched_ok', (public.create_release_batch((select id from f08 where k = 'org'), pg_temp.items('riley_e'),
  true, now() + interval '1 hour', 'f08-sched-ok')).id;
insert into f08 select 'sched_stale', (public.create_release_batch((select id from f08 where k = 'org'), pg_temp.items('morgan_e'),
  true, now() + interval '1 hour', 'f08-sched-stale')).id;
insert into f08 select 'sched_cancel', (public.create_release_batch((select id from f08 where k = 'org'), pg_temp.items('sam_e'),
  true, now() + interval '1 hour', 'f08-sched-cancel')).id;
do $$ begin
  if (select status from public.release_batches where id = (select id from f08 where k = 'sched_ok')) <> 'scheduled'
     or (select visibility from public.assignments where id = (select id from f08 where k = 'riley_e')) <> 'prepared' then
    raise exception 'scheduled release happened early';
  end if;
end $$;
-- The schedule is edited before it runs: the reviewed scope is stale.
update public.assignments set notes = 'changed after review' where id = (select id from f08 where k = 'morgan_e');
select public.cancel_release_batch((select id from f08 where k = 'sched_cancel'));
-- Riley cannot see the prepared row while it waits.
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
do $$ begin
  if exists (select 1 from public.assignments where id = (select id from f08 where k = 'riley_e')) then
    raise exception 'scheduled (still prepared) request visible to recipient';
  end if;
  begin
    perform public.run_due_release_batches(10);
    raise exception 'member ran the release worker';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local request.jwt.claim.sub = '';

-- Not due yet: nothing runs.
do $$ begin
  if exists (select 1 from public.run_due_release_batches(10) r where r.batch_id in
       (select id from f08 where k like 'sched_%')) then raise exception 'batch ran before it was due'; end if;
end $$;
update public.release_batches set scheduled_for = now() - interval '1 second'
 where id in (select id from f08 where k like 'sched_%');
select * from public.run_due_release_batches(10);
do $$ begin
  if (select status from public.release_batches where id = (select id from f08 where k = 'sched_ok')) <> 'released'
     or (select visibility from public.assignments where id = (select id from f08 where k = 'riley_e')) <> 'released'
     or (select effect_id from public.release_batches where id = (select id from f08 where k = 'sched_ok')) is null then
    raise exception 'due scheduled release did not run';
  end if;
  if (select (status, failure_code) from public.release_batches where id = (select id from f08 where k = 'sched_stale'))
     is distinct from ('failed'::public.release_batch_status, 'scope_changed'::text)
     or (select visibility from public.assignments where id = (select id from f08 where k = 'morgan_e')) <> 'prepared' then
    raise exception 'stale scheduled release was not refused';
  end if;
  if (select status from public.release_batches where id = (select id from f08 where k = 'sched_cancel')) <> 'cancelled'
     or (select visibility from public.assignments where id = (select id from f08 where k = 'sam_e')) <> 'prepared' then
    raise exception 'cancelled release ran';
  end if;
  if exists (select 1 from public.run_due_release_batches(10)) then raise exception 'second worker run re-ran batches'; end if;
end $$;

-- Revoking the scheduler before the due time stops the release.
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
insert into f08 select 'sched_revoked', (public.create_release_batch((select id from f08 where k = 'org'), pg_temp.items('sam_e'),
  true, now() + interval '1 hour', 'f08-sched-revoked')).id;
reset role;
set local request.jwt.claim.sub = '';
update public.organization_members set status = 'inactive'
 where organization_id = (select id from f08 where k = 'org') and user_id = '22222222-2222-4222-8222-222222222222';
update public.release_batches set scheduled_for = now() - interval '1 second' where id = (select id from f08 where k = 'sched_revoked');
select * from public.run_due_release_batches(10);
do $$ begin
  if (select failure_code from public.release_batches where id = (select id from f08 where k = 'sched_revoked')) <> 'actor_not_permitted'
     or (select visibility from public.assignments where id = (select id from f08 where k = 'sam_e')) <> 'prepared' then
    raise exception 'revoked scheduler''s release ran';
  end if;
end $$;
update public.organization_members set status = 'active'
 where organization_id = (select id from f08 where k = 'org') and user_id = '22222222-2222-4222-8222-222222222222';

-- ================================================= reminder policies ======
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$ begin
  insert into public.reminder_policies (organization_id, kind, offset_minutes)
  values ((select id from f08 where k = 'org'), 'pending_response', 60);
  raise exception 'member wrote a reminder policy';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  if exists (select 1 from public.reminder_jobs) then raise exception 'member can read reminder jobs'; end if;
end $$;

set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
-- Grant Riley Production scheduling only (scoped leader).
reset role;
set local request.jwt.claim.sub = '';
update public.organization_members set access_mode = 'scoped'
 where organization_id = (select id from f08 where k = 'org') and user_id = '44444444-4444-4444-8444-444444444444';
insert into public.access_grants (organization_id, user_id, capability, scope_type, team_id)
values ((select id from f08 where k = 'org'), '44444444-4444-4444-8444-444444444444', 'scheduling.manage', 'team',
        (select id from f08 where k = 'production'));
set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
-- A team leader may set their own team's policy, not the organization's or another team's.
insert into public.reminder_policies (organization_id, team_id, kind, offset_minutes, channels)
values ((select id from f08 where k = 'org'), (select id from f08 where k = 'production'), 'pending_response', 2880, '{email}');
do $$ begin
  insert into public.reminder_policies (organization_id, kind, offset_minutes)
  values ((select id from f08 where k = 'org'), 'pending_response', 60);
  raise exception 'team leader wrote the organization policy';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  insert into public.reminder_policies (organization_id, team_id, kind, offset_minutes)
  values ((select id from f08 where k = 'org'), (select id from f08 where k = 'band'), 'pending_response', 60);
  raise exception 'team leader wrote another team''s policy';
exception when insufficient_privilege then null;
end $$;

set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
insert into public.reminder_policies (organization_id, kind, offset_minutes, quiet_start, quiet_end)
values ((select id from f08 where k = 'org'), 'confirmed_service', 720, '22:00', '07:00');
do $$
declare v record;
begin
  select * into v from public.effective_reminder_policies((select id from f08 where k = 'org'), null,
    (select id from f08 where k = 'production')) where kind = 'pending_response';
  if v.source <> 'team' or v.offset_minutes <> 2880 or v.channels <> '{email}' then raise exception 'team override not effective: %', v; end if;
  select * into v from public.effective_reminder_policies((select id from f08 where k = 'org'), null,
    (select id from f08 where k = 'band')) where kind = 'pending_response';
  if v.source <> 'default' or v.offset_minutes <> 4320 then raise exception 'default not effective: %', v; end if;
  select * into v from public.effective_reminder_policies((select id from f08 where k = 'org'), null,
    (select id from f08 where k = 'band')) where kind = 'confirmed_service';
  if v.source <> 'organization' or v.offset_minutes <> 720 or v.quiet_start <> '22:00' then
    raise exception 'organization policy not inherited: %', v;
  end if;
end $$;
-- Back to the defaults for the job tests below.
delete from public.reminder_policies where organization_id = (select id from f08 where k = 'org') and team_id is null;
reset role;
set local request.jwt.claim.sub = '';

-- ========================================================= quiet hours ====
do $$ begin
  -- Spring forward (America/Toronto 2026-03-08): 01:00 EST is inside 22:00–08:00;
  -- the end is 08:00 EDT = 12:00Z, not 13:00Z.
  if private.reminder_quiet_shift('2026-03-08 06:00Z', 'America/Toronto', '22:00', '08:00') <> '2026-03-08 12:00Z' then
    raise exception 'spring-forward quiet end wrong: %', private.reminder_quiet_shift('2026-03-08 06:00Z', 'America/Toronto', '22:00', '08:00');
  end if;
  -- Fall back (2026-11-01): 23:00 EDT on Oct 31 shifts to 08:00 EST = 13:00Z.
  if private.reminder_quiet_shift('2026-11-01 03:00Z', 'America/Toronto', '22:00', '08:00') <> '2026-11-01 13:00Z' then
    raise exception 'fall-back quiet end wrong';
  end if;
  -- Outside the window, and a same-day window.
  if private.reminder_quiet_shift('2026-07-01 16:00Z', 'America/Toronto', '22:00', '08:00') <> '2026-07-01 16:00Z'
     or private.reminder_quiet_shift('2026-07-01 17:30Z', 'America/Toronto', '13:00', '14:00') <> '2026-07-01 18:00Z' then
    raise exception 'quiet window boundaries wrong';
  end if;
end $$;

-- ====================================================== reminder jobs =====
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
select count(*) from public.schedule_plan_assignments((select id from f08 where k = 'plan_d'), jsonb_build_array(
  jsonb_build_object('person_id', (select id from f08 where k = 'sam'), 'team_id', (select id from f08 where k = 'band'),
                     'position_id', 'dddddddd-0000-4000-8000-000000000003', 'visibility', 'released', 'attendance_mode', 'all'),
  jsonb_build_object('person_id', (select id from f08 where k = 'sam'), 'team_id', (select id from f08 where k = 'band'),
                     'position_id', 'dddddddd-0000-4000-8000-000000000004', 'visibility', 'released', 'attendance_mode', 'all'),
  jsonb_build_object('person_id', (select id from f08 where k = 'morgan'), 'team_id', (select id from f08 where k = 'band'),
                     'position_id', 'dddddddd-0000-4000-8000-000000000006', 'visibility', 'released', 'attendance_mode', 'all'),
  jsonb_build_object('person_id', (select id from f08 where k = 'guest'), 'team_id', (select id from f08 where k = 'production'),
                     'position_id', 'dddddddd-0000-4000-8000-000000000008', 'visibility', 'released', 'attendance_mode', 'all')
), false, 'f08-sched-d');
reset role;
set local request.jwt.claim.sub = '';
update public.assignments set status = 'confirmed', responded_at = now()
 where plan_id = (select id from f08 where k = 'plan_d') and person_id = (select id from f08 where k = 'morgan');

-- Scheduler sees the plan's jobs (recomputed on read).
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
declare v_count int;
begin
  select count(*) into v_count from public.plan_reminder_jobs((select id from f08 where k = 'plan_d')) where status = 'scheduled';
  -- Sam pending x3 channels (two positions, one reminder), Morgan confirmed x3, guest pending email only (team policy).
  if v_count <> 7 then raise exception 'expected 7 scheduled jobs, got %', v_count; end if;
end $$;
reset role;
set local request.jwt.claim.sub = '';
do $$
declare v_job public.reminder_jobs;
begin
  select * into v_job from public.reminder_jobs
   where plan_id = (select id from f08 where k = 'plan_d') and person_id = (select id from f08 where k = 'sam') and channel = 'email';
  if v_job.kind <> 'pending_response' or cardinality(v_job.assignment_ids) <> 2
     or v_job.occurrence_time_id <> (select id from f08 where k = 'd_service')
     or v_job.due_at <> (select starts_at - interval '72 hours' from public.plan_times where id = (select id from f08 where k = 'd_service')) then
    raise exception 'pending reminder not anchored 72h before the first service time: %', v_job;
  end if;
  select * into v_job from public.reminder_jobs
   where plan_id = (select id from f08 where k = 'plan_d') and person_id = (select id from f08 where k = 'morgan') and channel = 'push';
  if v_job.kind <> 'confirmed_service' or v_job.occurrence_time_id <> (select id from f08 where k = 'd_rehearsal')
     or v_job.due_at <> (select starts_at - interval '24 hours' from public.plan_times where id = (select id from f08 where k = 'd_rehearsal')) then
    raise exception 'confirmed reminder not anchored 24h before first attendance (rehearsal): %', v_job;
  end if;
  select * into v_job from public.reminder_jobs
   where plan_id = (select id from f08 where k = 'plan_d') and person_id = (select id from f08 where k = 'guest');
  if v_job.channel <> 'email' or v_job.due_at <> (select starts_at - interval '48 hours' from public.plan_times where id = (select id from f08 where k = 'd_service')) then
    raise exception 'team policy override not applied to job';
  end if;
end $$;

-- Fake clock: Sam's pending jobs are due. Two materialize calls give one effect per job.
update public.reminder_jobs set due_at = now() - interval '1 minute'
 where plan_id = (select id from f08 where k = 'plan_d') and person_id = (select id from f08 where k = 'sam');
select count(*) from public.materialize_due_reminders(50);
select count(*) from public.materialize_due_reminders(50);
do $$ begin
  if (select count(*) from public.reminder_jobs where plan_id = (select id from f08 where k = 'plan_d')
        and person_id = (select id from f08 where k = 'sam') and status = 'enqueued') <> 3 then
    raise exception 'due jobs not enqueued';
  end if;
  if exists (select reminder_job_id from public.delivery_effects where reminder_job_id is not null
              group by reminder_job_id having count(*) > 1) then
    raise exception 'a job produced two effects';
  end if;
  if (select count(*) from public.deliveries d join public.delivery_effects e on e.id = d.effect_id
       join public.reminder_jobs j on j.id = e.reminder_job_id
      where j.plan_id = (select id from f08 where k = 'plan_d') and j.person_id = (select id from f08 where k = 'sam')) <> 3 then
    raise exception 'each job must have exactly one delivery';
  end if;
  if not exists (select 1 from public.assignment_request_snapshots s join public.reminder_jobs j on j.effect_id = s.effect_id
                  where j.person_id = (select id from f08 where k = 'sam') and j.channel = 'email'
                    and j.plan_id = (select id from f08 where k = 'plan_d')) then
    raise exception 'emailed pending reminder has no exact snapshot';
  end if;
  if not public.reminder_job_is_current((select id from public.reminder_jobs where plan_id = (select id from f08 where k = 'plan_d')
       and person_id = (select id from f08 where k = 'sam') and channel = 'push')) then
    raise exception 'fresh job is not current';
  end if;
end $$;

-- Sam answers after enqueue, before dispatch: the reminder is obsolete.
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
select count(*) from public.respond_to_own_assignment(
  (select id from public.assignments where plan_id = (select id from f08 where k = 'plan_d')
      and person_id = (select id from f08 where k = 'sam') and position_id = 'dddddddd-0000-4000-8000-000000000003'),
  'confirmed', 'unconfirmed');
reset role;
set local request.jwt.claim.sub = '';
do $$ begin
  if public.reminder_job_is_current((select id from public.reminder_jobs where plan_id = (select id from f08 where k = 'plan_d')
       and person_id = (select id from f08 where k = 'sam') and channel = 'push' and kind = 'pending_response')) then
    raise exception 'answered request still has a current reminder';
  end if;
end $$;
select count(*) from public.materialize_due_reminders(50);
do $$ begin
  if exists (select 1 from public.reminder_jobs where plan_id = (select id from f08 where k = 'plan_d')
              and person_id = (select id from f08 where k = 'sam') and kind = 'pending_response' and status = 'enqueued'
              and request_version <> (select request_version from public.reminder_jobs j2
                                       where j2.plan_id = (select id from f08 where k = 'plan_d')
                                         and j2.person_id = (select id from f08 where k = 'sam')
                                         and j2.status = 'scheduled' and j2.kind = 'pending_response' limit 1)) then
    raise exception 'obsolete enqueued reminder (unsent) was not cancelled';
  end if;
  -- Sam still has one unanswered position: a new pending intent for the new request version.
  if not exists (select 1 from public.reminder_jobs where plan_id = (select id from f08 where k = 'plan_d')
                  and person_id = (select id from f08 where k = 'sam') and kind = 'pending_response' and status = 'scheduled') then
    raise exception 'remaining unanswered position lost its reminder';
  end if;
end $$;

-- Time change: moving the rehearsal reschedules Morgan's reminder.
update public.plan_times set starts_at = starts_at + interval '3 hours', ends_at = ends_at + interval '3 hours'
 where id = (select id from f08 where k = 'd_rehearsal');
select count(*) from public.materialize_due_reminders(50);
do $$ begin
  if (select count(*) from public.reminder_jobs where plan_id = (select id from f08 where k = 'plan_d')
        and person_id = (select id from f08 where k = 'morgan') and status = 'cancelled') <> 3
     or (select due_at from public.reminder_jobs where plan_id = (select id from f08 where k = 'plan_d')
           and person_id = (select id from f08 where k = 'morgan') and status = 'scheduled' and channel = 'push')
        <> (select starts_at - interval '24 hours' from public.plan_times where id = (select id from f08 where k = 'd_rehearsal')) then
    raise exception 'time change did not reschedule';
  end if;
end $$;

-- Person channel preference: Morgan turns off push reminders.
set local role authenticated;
set local request.jwt.claim.sub = '55555555-5555-4555-8555-555555555555';
insert into public.person_reminder_preferences (person_id, push) values ((select id from f08 where k = 'morgan'), false);
do $$ begin
  insert into public.person_reminder_preferences (person_id, push) values ((select id from f08 where k = 'sam'), false);
  raise exception 'set another person''s preferences';
exception when insufficient_privilege then null;
end $$;
reset role;
set local request.jwt.claim.sub = '';
select count(*) from public.materialize_due_reminders(50);
do $$ begin
  if exists (select 1 from public.reminder_jobs where plan_id = (select id from f08 where k = 'plan_d')
              and person_id = (select id from f08 where k = 'morgan') and channel = 'push' and status = 'scheduled') then
    raise exception 'push reminder kept after opt-out';
  end if;
end $$;

-- Policy disable cancels pending work.
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
insert into public.reminder_policies (organization_id, kind, enabled, offset_minutes)
values ((select id from f08 where k = 'org'), 'confirmed_service', false, 1440);
reset role;
set local request.jwt.claim.sub = '';
select count(*) from public.materialize_due_reminders(50);
do $$ begin
  if exists (select 1 from public.reminder_jobs where plan_id = (select id from f08 where k = 'plan_d')
              and kind = 'confirmed_service' and status = 'scheduled') then
    raise exception 'disabled policy left scheduled reminders';
  end if;
end $$;

-- Archiving the guest and revoking Sam's membership cancel their reminders.
update public.people set archived_at = now() where id = (select id from f08 where k = 'guest');
update public.organization_members set status = 'inactive'
 where organization_id = (select id from f08 where k = 'org') and user_id = '33333333-3333-4333-8333-333333333333';
select count(*) from public.materialize_due_reminders(50);
do $$ begin
  if exists (select 1 from public.reminder_jobs where plan_id = (select id from f08 where k = 'plan_d')
              and person_id in (select id from f08 where k in ('guest', 'sam')) and status = 'scheduled') then
    raise exception 'archived/revoked Person kept reminders';
  end if;
end $$;
update public.organization_members set status = 'active'
 where organization_id = (select id from f08 where k = 'org') and user_id = '33333333-3333-4333-8333-333333333333';

-- Frequency cap: guest2 has pending requests on two plans due at once; the
-- Production team policy allows one email per day, so the second waits.
update public.reminder_policies set max_per_day = 1
 where team_id = (select id from f08 where k = 'production') and kind = 'pending_response';
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
select count(*) from (values ('plan_d'), ('plan_e')) p(k)
 cross join lateral public.schedule_plan_assignments((select id from f08 where k = p.k), jsonb_build_array(
  jsonb_build_object('person_id', (select id from f08 where k = 'guest2'), 'team_id', (select id from f08 where k = 'production'),
                     'position_id', 'dddddddd-0000-4000-8000-000000000009', 'visibility', 'released', 'attendance_mode', 'all')
), false, 'f08-cap-' || p.k);
reset role;
set local request.jwt.claim.sub = '';
select count(*) from public.materialize_due_reminders(50);
update public.reminder_jobs set due_at = now() - interval '1 minute'
 where person_id = (select id from f08 where k = 'guest2') and status = 'scheduled';
create temporary table f08_cap on commit drop as select * from public.materialize_due_reminders(50);
do $$ begin
  if (select count(*) from f08_cap c join public.reminder_jobs j on j.id = c.job_id
       where j.person_id = (select id from f08 where k = 'guest2') and c.outcome = 'enqueued') <> 1
     or (select count(*) from f08_cap c join public.reminder_jobs j on j.id = c.job_id
          where j.person_id = (select id from f08 where k = 'guest2') and c.outcome = 'deferred') <> 1 then
    raise exception 'frequency cap not applied';
  end if;
  if (select due_at from public.reminder_jobs where person_id = (select id from f08 where k = 'guest2') and status = 'scheduled')
     < now() + interval '23 hours' then
    raise exception 'capped reminder not deferred by the window';
  end if;
end $$;

-- Quiet hours at materialization (worker reached a job inside the window).
update public.reminder_policies
   set quiet_start = ((now() at time zone 'America/Toronto') - interval '1 hour')::time,
       quiet_end = ((now() at time zone 'America/Toronto') + interval '1 hour')::time,
       max_per_day = 5
 where team_id = (select id from f08 where k = 'production') and kind = 'pending_response';
select count(*) from public.materialize_due_reminders(50);
update public.reminder_jobs set due_at = now() - interval '1 minute'
 where person_id = (select id from f08 where k = 'guest2') and status = 'scheduled';
create temporary table f08_quiet on commit drop as select * from public.materialize_due_reminders(50);
do $$ begin
  if not exists (select 1 from f08_quiet c join public.reminder_jobs j on j.id = c.job_id
                  where j.person_id = (select id from f08 where k = 'guest2') and c.outcome = 'deferred'
                    and j.due_at between now() + interval '50 minutes' and now() + interval '70 minutes') then
    raise exception 'job inside quiet hours was not deferred to the window end';
  end if;
  if exists (select 1 from f08_quiet where outcome = 'enqueued') then raise exception 'sent during quiet hours'; end if;
end $$;

-- Scheduler delivery visibility: Jordan sees reminder deliveries for rows he schedules.
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$ begin
  if not exists (select 1 from public.deliveries d join public.delivery_effects e on e.id = d.effect_id
                  where e.reminder_job_id is not null) then
    raise exception 'scheduler cannot see reminder delivery history';
  end if;
end $$;
-- A scoped Production leader does not see Band deliveries.
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
do $$ begin
  if exists (select 1 from public.deliveries d join public.delivery_effects e on e.id = d.effect_id
              where e.release_batch_id = (select id from f08 where k = 'batch')
                and d.recipient_person_id <> (select id from f08 where k = 'riley')) then
    raise exception 'scoped leader sees another team''s deliveries';
  end if;
  begin
    perform public.materialize_due_reminders(1);
    raise exception 'client materialized reminders';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local request.jwt.claim.sub = '';

rollback;
