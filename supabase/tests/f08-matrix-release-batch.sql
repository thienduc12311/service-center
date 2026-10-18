-- F08 gate: a multi-plan F05 matrix release goes through one F08 release
-- batch — one outbox effect, one delivery per Person per channel, one request
-- snapshot per Person per plan — and stays idempotent under the operation id.
-- Run against the seeded local database. Everything rolls back.
begin;

create temporary table f08m (k text primary key, id uuid) on commit drop;
grant select, insert, update on f08m to authenticated, service_role;
insert into f08m values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('band', 'cccccccc-0000-4000-8000-000000000001'),
  ('pos_a', 'dddddddd-0000-4000-8000-000000000003'),
  ('pos_b', 'dddddddd-0000-4000-8000-000000000005'),
  ('sam', (select id from public.people where profile_id = '33333333-3333-4333-8333-333333333333')),
  ('riley', (select id from public.people where profile_id = '44444444-4444-4444-8444-444444444444')),
  ('morgan', (select id from public.people where profile_id = '55555555-5555-4555-8555-555555555555')),
  ('guest', gen_random_uuid()),
  ('plan_a', gen_random_uuid()), ('plan_b', gen_random_uuid());
create or replace function pg_temp.fx(p text) returns uuid language sql stable as
  $$ select id from f08m where k = p $$;

insert into public.people (id, organization_id, first_name, email)
values (pg_temp.fx('guest'), pg_temp.fx('org'), 'F08M Guest', 'f08m-guest@example.test');
insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by) values
  (pg_temp.fx('plan_a'), pg_temp.fx('org'), 'bbbbbbbb-0000-4000-8000-000000000001', 'F08M A', now() + interval '600 days', 'published', '22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('plan_b'), pg_temp.fx('org'), 'bbbbbbbb-0000-4000-8000-000000000001', 'F08M B', now() + interval '607 days', 'published', '22222222-2222-4222-8222-222222222222');
insert into public.plan_times (plan_id, kind, name, starts_at, ends_at, sort_order) values
  (pg_temp.fx('plan_a'), 'service', 'Service', now() + interval '600 days', now() + interval '600 days 1 hour', 0),
  (pg_temp.fx('plan_b'), 'service', 'Service', now() + interval '607 days', now() + interval '607 days 1 hour', 0);

set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

-- Prepared requests: Sam on both plans, Riley and a guest on plan A.
select count(*) from public.schedule_plan_assignments(pg_temp.fx('plan_a'), jsonb_build_array(
  jsonb_build_object('person_id', pg_temp.fx('sam'), 'team_id', pg_temp.fx('band'), 'position_id', pg_temp.fx('pos_a'),
                     'visibility', 'prepared', 'attendance_mode', 'all'),
  jsonb_build_object('person_id', pg_temp.fx('riley'), 'team_id', pg_temp.fx('band'), 'position_id', pg_temp.fx('pos_b'),
                     'visibility', 'prepared', 'attendance_mode', 'all'),
  jsonb_build_object('person_id', pg_temp.fx('guest'), 'team_id', pg_temp.fx('band'), 'position_id', null,
                     'visibility', 'prepared', 'attendance_mode', 'all')
), false, 'f08m-sched-a');
select count(*) from public.schedule_plan_assignments(pg_temp.fx('plan_b'), jsonb_build_array(
  jsonb_build_object('person_id', pg_temp.fx('sam'), 'team_id', pg_temp.fx('band'), 'position_id', pg_temp.fx('pos_a'),
                     'visibility', 'prepared', 'attendance_mode', 'all')
), false, 'f08m-sched-b');
insert into f08m select 'sam_a', id from public.assignments where plan_id = pg_temp.fx('plan_a') and person_id = pg_temp.fx('sam');
insert into f08m select 'riley_a', id from public.assignments where plan_id = pg_temp.fx('plan_a') and person_id = pg_temp.fx('riley');
insert into f08m select 'guest_a', id from public.assignments where plan_id = pg_temp.fx('plan_a') and person_id = pg_temp.fx('guest');
insert into f08m select 'sam_b', id from public.assignments where plan_id = pg_temp.fx('plan_b') and person_id = pg_temp.fx('sam');

create function pg_temp.release_action(p_key text, p_notify boolean) returns jsonb language sql as $$
  select jsonb_build_object('kind', 'release', 'plan_id', a.plan_id, 'assignment_id', a.id,
                            'expected_request_revision', a.request_revision, 'notify', p_notify)
    from public.assignments a where a.id = pg_temp.fx(p_key);
$$;
create function pg_temp.revisions() returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('plan_id', id, 'staffing_revision', staffing_revision) order by id)
    from public.plans where id in (pg_temp.fx('plan_a'), pg_temp.fx('plan_b'));
$$;

-- A stale release cell aborts the whole commit: nothing released, no batch.
do $$
declare actions jsonb; revisions jsonb; hint text;
begin
  actions := jsonb_build_array(pg_temp.release_action('sam_a', true), pg_temp.release_action('sam_b', true));
  revisions := pg_temp.revisions();
  update public.assignments set notes = 'changed after preview' where id = pg_temp.fx('sam_b');
  begin
    perform public.commit_staffing_matrix(pg_temp.fx('org'), public.staffing_matrix_operation_id(actions, revisions),
      actions, revisions, 'f08m-stale-commit');
    raise exception 'stale matrix release committed';
  exception when sqlstate 'PT409' then get stacked diagnostics hint = pg_exception_hint;
  end;
  if hint <> 'matrix_changed' then raise exception 'stale matrix release did not return matrix_changed'; end if;
  if exists (select 1 from public.assignments where id in (pg_temp.fx('sam_a'), pg_temp.fx('sam_b')) and visibility <> 'prepared')
     or exists (select 1 from public.release_batches where idempotency_key like 'matrix:%'
                  and organization_id = pg_temp.fx('org') and created_by = '22222222-2222-4222-8222-222222222222') then
    raise exception 'stale matrix release leaked a release or batch';
  end if;
end $$;

-- Releasing a cell the same commit removes is refused whole.
do $$
declare actions jsonb; revisions jsonb; hint text;
begin
  actions := jsonb_build_array(
    jsonb_build_object('kind', 'remove', 'plan_id', pg_temp.fx('plan_a'), 'assignment_id', pg_temp.fx('riley_a'),
      'expected_request_revision', (select request_revision from public.assignments where id = pg_temp.fx('riley_a'))),
    pg_temp.release_action('riley_a', true));
  revisions := pg_temp.revisions();
  begin
    perform public.commit_staffing_matrix(pg_temp.fx('org'), public.staffing_matrix_operation_id(actions, revisions),
      actions, revisions, 'f08m-remove-release');
    raise exception 'release of a removed cell committed';
  exception when sqlstate 'PT409' then get stacked diagnostics hint = pg_exception_hint;
  end;
  if hint <> 'matrix_changed' or not exists (select 1 from public.assignments where id = pg_temp.fx('riley_a')) then
    raise exception 'remove+release was not rolled back as matrix_changed';
  end if;
end $$;

-- One matrix commit: three notifying release cells over two plans, one new
-- cell created released with notify (Morgan on plan B), and one silent release.
do $$
declare actions jsonb; revisions jsonb; operation text; first_result jsonb; replay jsonb;
begin
  actions := jsonb_build_array(
    pg_temp.release_action('sam_a', true),
    pg_temp.release_action('sam_b', true),
    pg_temp.release_action('riley_a', true),
    jsonb_build_object('kind', 'assign', 'plan_id', pg_temp.fx('plan_b'), 'person_id', pg_temp.fx('morgan'),
      'team_id', pg_temp.fx('band'), 'position_id', pg_temp.fx('pos_b'), 'visibility', 'released',
      'attendance_mode', 'all', 'time_ids', '[]'::jsonb, 'notify', true),
    pg_temp.release_action('guest_a', false));
  revisions := pg_temp.revisions();
  operation := public.staffing_matrix_operation_id(actions, revisions);
  first_result := public.commit_staffing_matrix(pg_temp.fx('org'), operation, actions, revisions, 'f08m-commit-1');
  replay := public.commit_staffing_matrix(pg_temp.fx('org'), operation, actions, revisions, 'f08m-commit-1');
  if first_result <> replay then raise exception 'matrix replay returned a different result'; end if;
  if jsonb_array_length(first_result->'delivery_effect_ids') <> 1 then
    raise exception 'matrix release should report exactly one delivery effect: %', first_result;
  end if;
  if jsonb_array_length(first_result->'release_batch_ids') <> 2 or jsonb_array_length(first_result->'assignment_ids') <> 5 then
    raise exception 'matrix result shape is wrong: %', first_result;
  end if;
  insert into f08m values
    ('operation_effect', (first_result->'delivery_effect_ids'->>0)::uuid),
    ('morgan_b', (select id from public.assignments where plan_id = pg_temp.fx('plan_b') and person_id = pg_temp.fx('morgan')));
  perform set_config('f08m.operation', operation, true);
end $$;

reset role;
set local request.jwt.claim.sub = '';
do $$
declare
  v_operation text := current_setting('f08m.operation');
  v_batch public.release_batches;
  v_silent public.release_batches;
  v_effect public.delivery_effects;
begin
  select * into v_batch from public.release_batches
   where organization_id = pg_temp.fx('org') and created_by = '22222222-2222-4222-8222-222222222222'
     and idempotency_key = 'matrix:' || v_operation;
  select * into v_silent from public.release_batches
   where organization_id = pg_temp.fx('org') and created_by = '22222222-2222-4222-8222-222222222222'
     and idempotency_key = 'matrix:' || v_operation || ':silent';
  if v_batch.status is distinct from 'released' or v_batch.plan_count <> 2 or v_batch.item_count <> 4 or not v_batch.notify then
    raise exception 'notifying matrix batch not released as reviewed: %', v_batch;
  end if;
  if v_silent.status is distinct from 'released' or v_silent.notify or v_silent.effect_id is not null or v_silent.item_count <> 1 then
    raise exception 'silent matrix batch is wrong: %', v_silent;
  end if;
  if v_batch.effect_id <> pg_temp.fx('operation_effect') then
    raise exception 'matrix result does not report the batch effect';
  end if;
  if exists (select 1 from public.assignments
              where id in (pg_temp.fx('sam_a'), pg_temp.fx('sam_b'), pg_temp.fx('riley_a'), pg_temp.fx('guest_a'), pg_temp.fx('morgan_b'))
                and (visibility <> 'released' or released_by <> '22222222-2222-4222-8222-222222222222')) then
    raise exception 'matrix cells were not released by the actor';
  end if;

  -- One effect for the whole commit; no per-cell effects.
  if (select count(*) from public.delivery_effects
       where organization_id = pg_temp.fx('org')
         and (effect_key like 'matrix:' || v_operation || '%' or release_batch_id in (v_batch.id, v_silent.id))) <> 1 then
    raise exception 'matrix release created more than one effect';
  end if;
  select * into v_effect from public.delivery_effects where id = v_batch.effect_id;
  if v_effect.plan_id is not null or cardinality(v_effect.assignment_ids) <> 4 or v_effect.release_batch_id <> v_batch.id
     or v_effect.template <> 'assignment_request' then
    raise exception 'matrix effect is not one consolidated effect: %', v_effect;
  end if;
  if pg_temp.fx('guest_a') = any(v_effect.assignment_ids) then
    raise exception 'a silent release was put in the message';
  end if;

  -- Sam: one message (one delivery per channel) and one snapshot per plan,
  -- each holding only that plan's request.
  if (select count(*) from public.deliveries where effect_id = v_effect.id
        and recipient_person_id = pg_temp.fx('sam')) <> 3
     or (select count(distinct channel) from public.deliveries where effect_id = v_effect.id
        and recipient_person_id = pg_temp.fx('sam')) <> 3 then
    raise exception 'Sam should get one delivery per channel for the whole matrix commit';
  end if;
  if (select count(*) from public.assignment_request_snapshots
       where effect_id = v_effect.id and person_id = pg_temp.fx('sam')) <> 2 then
    raise exception 'Sam should get a separate snapshot per plan';
  end if;
  if exists (
    select 1 from public.assignment_request_snapshots s
      join public.assignment_request_snapshot_items i on i.snapshot_id = s.id
      join public.assignments a on a.id = i.assignment_id
     where s.effect_id = v_effect.id and a.plan_id <> s.plan_id
  ) then raise exception 'a plan snapshot holds another plan''s request'; end if;
  if (select count(*) from public.assignment_request_snapshot_items i
        join public.assignment_request_snapshots s on s.id = i.snapshot_id
       where s.effect_id = v_effect.id and s.person_id = pg_temp.fx('sam')) <> 2 then
    raise exception 'Sam''s snapshots should hold exactly his two requests';
  end if;
  -- Riley (plan A) and Morgan (new released cell on plan B) are in the same message.
  if (select count(*) from public.assignment_request_snapshots where effect_id = v_effect.id) <> 4
     or (select count(*) from public.deliveries where effect_id = v_effect.id and channel = 'email') <> 3 then
    raise exception 'Riley and Morgan should each get one email and one snapshot';
  end if;
  -- The silent release messages nobody.
  if exists (select 1 from public.deliveries where recipient_person_id = pg_temp.fx('guest')) then
    raise exception 'a silent matrix release sent a delivery';
  end if;
end $$;

-- Replaying under another idempotency key is refused as stale (the release
-- moved the staffing revision), and adds no batch or effect.
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
declare actions jsonb; revisions jsonb; hint text;
begin
  actions := jsonb_build_array(pg_temp.release_action('sam_a', true));
  revisions := pg_temp.revisions();
  begin
    perform public.commit_staffing_matrix(pg_temp.fx('org'), public.staffing_matrix_operation_id(actions, revisions),
      actions, revisions, 'f08m-commit-2');
    raise exception 're-releasing a released cell committed';
  exception when sqlstate 'PT409' then get stacked diagnostics hint = pg_exception_hint;
  end;
  if hint <> 'matrix_changed' then raise exception 're-release did not return matrix_changed'; end if;
end $$;
reset role;
set local request.jwt.claim.sub = '';
do $$ begin
  if (select count(*) from public.release_batches where organization_id = pg_temp.fx('org')
        and idempotency_key like 'matrix:%') <> 2
     or (select count(*) from public.delivery_effects where release_batch_id in (
           select id from public.release_batches where organization_id = pg_temp.fx('org') and idempotency_key like 'matrix:%')) <> 1 then
    raise exception 'matrix replay added batches or effects';
  end if;
end $$;

rollback;
