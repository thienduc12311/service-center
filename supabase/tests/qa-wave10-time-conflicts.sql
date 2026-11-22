-- W10-CD-D1: a plan time edit or bulk reschedule that double-books a Person
-- is refused (PT409 scheduling_conflict) unless the caller may override
-- conflicts and gives a reason, which is audited like an assignment override.
-- Needs migration 20261201000202. Run against the seeded local database.
-- Everything rolls back.
begin;

create temporary table w10t_fx (k text primary key, id uuid) on commit drop;
grant select, insert, update, delete on w10t_fx to authenticated, service_role;
insert into w10t_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('st', 'bbbbbbbb-0000-4000-8000-000000000001'),
  ('band', 'cccccccc-0000-4000-8000-000000000001'),
  ('leader', 'dddddddd-0000-4000-8000-000000000001'),
  ('sam', (select id from public.people where profile_id = '33333333-3333-4333-8333-333333333333')),
  ('busy', gen_random_uuid()), ('moving', gen_random_uuid()), ('busy_t', gen_random_uuid()), ('moving_t', gen_random_uuid());
create or replace function pg_temp.fx(p text) returns uuid language sql stable as $$ select id from w10t_fx where k = p $$;
create or replace function pg_temp.at_local(d date, t text) returns timestamptz language sql stable as
  $$ select (d + t::time) at time zone 'America/Toronto' $$;
-- The moving plan's one service time, placed at a local date and clock.
create or replace function pg_temp.times_at(d date, t text) returns jsonb language sql stable as $$
  select jsonb_build_array(jsonb_build_object('id', pg_temp.fx('moving_t'), 'kind', 'service', 'name', 'Service',
    'starts_at', pg_temp.at_local(d, t), 'ends_at', pg_temp.at_local(d, t) + interval '1 hour', 'sort_order', 0))
$$;
-- A whole-plan move as the API resolves it (same local clock, new date).
create or replace function pg_temp.move_to(d date) returns jsonb language sql stable as $$
  select jsonb_build_array(jsonb_build_object(
    'plan_id', pg_temp.fx('moving'), 'new_local_date', d,
    'service_date', pg_temp.at_local(d, '09:00'),
    'times', jsonb_build_array(jsonb_build_object('id', pg_temp.fx('moving_t'),
      'starts_at', pg_temp.at_local(d, '09:00'), 'ends_at', pg_temp.at_local(d, '10:00')))))
$$;

insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by) values
  (pg_temp.fx('busy'), pg_temp.fx('org'), pg_temp.fx('st'), 'W10 busy', pg_temp.at_local('2028-03-05', '09:00'), 'published', '11111111-1111-4111-8111-111111111111'),
  (pg_temp.fx('moving'), pg_temp.fx('org'), pg_temp.fx('st'), 'W10 moving', pg_temp.at_local('2028-03-12', '09:00'), 'published', '11111111-1111-4111-8111-111111111111');
insert into public.plan_times (id, plan_id, kind, name, starts_at, ends_at, sort_order) values
  (pg_temp.fx('busy_t'), pg_temp.fx('busy'), 'service', 'Service', pg_temp.at_local('2028-03-05', '09:00'), pg_temp.at_local('2028-03-05', '10:00'), 0),
  (pg_temp.fx('moving_t'), pg_temp.fx('moving'), 'service', 'Service', pg_temp.at_local('2028-03-12', '09:00'), pg_temp.at_local('2028-03-12', '10:00'), 0);
insert into public.assignments (plan_id, person_id, team_id, position_id, status, visibility, created_by) values
  (pg_temp.fx('busy'), pg_temp.fx('sam'), pg_temp.fx('band'), pg_temp.fx('leader'), 'confirmed', 'released', '11111111-1111-4111-8111-111111111111'),
  (pg_temp.fx('moving'), pg_temp.fx('sam'), pg_temp.fx('band'), pg_temp.fx('leader'), 'confirmed', 'released', '11111111-1111-4111-8111-111111111111');

-- Jordan: plans.edit + scheduling.manage on the service type, no override.
update public.organization_members set access_mode = 'scoped'
 where organization_id = pg_temp.fx('org') and user_id = '22222222-2222-4222-8222-222222222222';
delete from public.access_grants where organization_id = pg_temp.fx('org') and user_id = '22222222-2222-4222-8222-222222222222';
insert into public.access_grants (organization_id, user_id, capability, scope_type, service_type_id) values
  (pg_temp.fx('org'), '22222222-2222-4222-8222-222222222222', 'plans.edit', 'service_type', pg_temp.fx('st')),
  (pg_temp.fx('org'), '22222222-2222-4222-8222-222222222222', 'scheduling.manage', 'service_type', pg_temp.fx('st'));

set local role authenticated;

-- ------------------------------------------------ time edit, denied -------
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
declare hint text; detail text; msg text;
begin
  begin
    perform public.update_plan_with_times(pg_temp.fx('moving'), '{}'::jsonb, pg_temp.times_at('2028-03-05', '09:30'),
      null, null, '[]'::jsonb, false, null, null);
    raise exception 'a double-booking time edit was saved';
  exception when sqlstate 'PT409' then
    get stacked diagnostics hint = pg_exception_hint, detail = pg_exception_detail, msg = message_text;
  end;
  if hint <> 'scheduling_conflict' then raise exception 'expected scheduling_conflict, got %', hint; end if;
  if not exists (select 1 from jsonb_array_elements(detail::jsonb) c where (c ->> 'person_id')::uuid = pg_temp.fx('sam')) then
    raise exception 'the conflict detail must name the Person: %', detail;
  end if;
  if msg not like '%double-book%' then raise exception 'unexpected message: %', msg; end if;
  -- A reason does not help without the override capability.
  begin
    perform public.update_plan_with_times(pg_temp.fx('moving'), '{}'::jsonb, pg_temp.times_at('2028-03-05', '09:30'),
      null, null, '[]'::jsonb, false, null, 'Sam can do both');
    raise exception 'a scheduler without the override capability overrode a conflict';
  exception when insufficient_privilege then null;
  end;
  if (select starts_at from public.plan_times where id = pg_temp.fx('moving_t')) <> pg_temp.at_local('2028-03-12', '09:00') then
    raise exception 'a refused time edit changed the time';
  end if;
end $$;

-- A move that overlaps nobody is still saved.
do $$
begin
  perform public.update_plan_with_times(pg_temp.fx('moving'), '{}'::jsonb, pg_temp.times_at('2028-03-12', '11:00'),
    null, null, '[]'::jsonb, false, null, null);
  if (select starts_at from public.plan_times where id = pg_temp.fx('moving_t')) <> pg_temp.at_local('2028-03-12', '11:00') then
    raise exception 'a conflict-free time edit was not saved';
  end if;
  perform public.update_plan_with_times(pg_temp.fx('moving'), '{}'::jsonb, pg_temp.times_at('2028-03-12', '09:00'),
    null, null, '[]'::jsonb, false, null, null);
end $$;

-- ------------------------------------------------ reschedule, denied ------
do $$
declare preview jsonb; hint text;
begin
  preview := public.preview_plan_reschedule(pg_temp.fx('org'), 'shift', pg_temp.move_to('2028-03-05'), null, false, false);
  begin
    perform public.reschedule_plans(pg_temp.fx('org'), 'shift', preview ->> 'preview_hash', 'w10-d1-reschedule-1',
      pg_temp.move_to('2028-03-05'), null, false, false, null);
    raise exception 'a double-booking reschedule was saved';
  exception when sqlstate 'PT409' then get stacked diagnostics hint = pg_exception_hint;
  end;
  if hint <> 'scheduling_conflict' then raise exception 'expected scheduling_conflict, got %', hint; end if;
  begin
    perform public.reschedule_plans(pg_temp.fx('org'), 'shift', preview ->> 'preview_hash', 'w10-d1-reschedule-2',
      pg_temp.move_to('2028-03-05'), null, false, false, 'Sam can do both');
    raise exception 'a reschedule overrode a conflict without the capability';
  exception when insufficient_privilege then null;
  end;
  if (select service_date from public.plans where id = pg_temp.fx('moving')) <> pg_temp.at_local('2028-03-12', '09:00') then
    raise exception 'a refused reschedule moved the plan';
  end if;
end $$;

-- ------------------------------------------- owner override, audited ------
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$
declare preview jsonb;
begin
  perform public.update_plan_with_times(pg_temp.fx('moving'), '{}'::jsonb, pg_temp.times_at('2028-03-05', '09:30'),
    null, null, '[]'::jsonb, false, null, 'Sam leads both services');
  if not exists (select 1 from public.assignment_conflict_overrides o
                  where o.plan_id = pg_temp.fx('moving') and o.person_id = pg_temp.fx('sam')
                    and o.reason = 'Sam leads both services' and o.actor_id = '11111111-1111-4111-8111-111111111111') then
    raise exception 'an overridden time edit was not audited';
  end if;
  -- Put it back (no overlap), then the override path for a reschedule.
  perform public.update_plan_with_times(pg_temp.fx('moving'), '{}'::jsonb, pg_temp.times_at('2028-03-12', '09:00'),
    null, null, '[]'::jsonb, false, null, null);
  preview := public.preview_plan_reschedule(pg_temp.fx('org'), 'shift', pg_temp.move_to('2028-03-05'), null, false, false);
  perform public.reschedule_plans(pg_temp.fx('org'), 'shift', preview ->> 'preview_hash', 'w10-d1-reschedule-3',
    pg_temp.move_to('2028-03-05'), null, false, false, 'Sam leads both services');
  if (select service_date from public.plans where id = pg_temp.fx('moving')) <> pg_temp.at_local('2028-03-05', '09:00') then
    raise exception 'an overridden reschedule did not move the plan';
  end if;
end $$;

-- The audit row is once per request and transaction (as for assignments), so
-- check the reschedule's own row in a transaction of its own.
reset role;
delete from public.assignment_conflict_overrides where plan_id = pg_temp.fx('moving');
update public.plan_times set starts_at = pg_temp.at_local('2028-03-12', '09:00'), ends_at = pg_temp.at_local('2028-03-12', '10:00')
 where id = pg_temp.fx('moving_t');
update public.plans set service_date = pg_temp.at_local('2028-03-12', '09:00') where id = pg_temp.fx('moving');
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$
declare preview jsonb;
begin
  preview := public.preview_plan_reschedule(pg_temp.fx('org'), 'shift', pg_temp.move_to('2028-03-05'), null, false, false);
  perform public.reschedule_plans(pg_temp.fx('org'), 'shift', preview ->> 'preview_hash', 'w10-d1-reschedule-4',
    pg_temp.move_to('2028-03-05'), null, false, false, 'Sam leads both services');
  if not exists (select 1 from public.assignment_conflict_overrides o
                  where o.plan_id = pg_temp.fx('moving') and o.reason = 'Sam leads both services') then
    raise exception 'an overridden reschedule was not audited';
  end if;
end $$;

reset role;
rollback;
