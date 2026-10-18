-- F04: attendance resolver, exact conflicts, redaction, audited overrides,
-- commit-time recheck, time-edit impact, copy scope, untimed fallback,
-- overnight/DST intervals and recipient calendar sequencing.
-- Run against a seeded local database. Everything rolls back.
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/f04-assigned-times.sql
begin;

create temporary table f04_fx (k text primary key, id uuid) on commit drop;
create temporary table f04_val (k text primary key, v jsonb) on commit drop;
grant select, insert, update, delete on f04_fx, f04_val to authenticated, service_role;

create temporary table f04_base on commit drop as
  select date_trunc('day', now()) + interval '400 days' as t;
grant select on f04_base to authenticated, service_role;

insert into f04_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('band', 'cccccccc-0000-4000-8000-000000000001'),
  ('production', 'cccccccc-0000-4000-8000-000000000002'),
  ('riley', (select id from public.people where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' and profile_id = '44444444-4444-4444-8444-444444444444')),
  ('sam', (select id from public.people where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' and profile_id = '33333333-3333-4333-8333-333333333333')),
  ('guest', gen_random_uuid()), ('guest2', gen_random_uuid()),
  ('plan_a', gen_random_uuid()), ('a_reh', gen_random_uuid()), ('a_s1', gen_random_uuid()), ('a_s2', gen_random_uuid()),
  ('plan_b', gen_random_uuid()), ('b_mid', gen_random_uuid()), ('b_adj', gen_random_uuid()), ('b_late', gen_random_uuid()), ('b_fri', gen_random_uuid()),
  ('plan_c', gen_random_uuid()), ('c1', gen_random_uuid()), ('c2', gen_random_uuid()), ('c3', gen_random_uuid()), ('c4', gen_random_uuid()),
  ('plan_d', gen_random_uuid()),
  ('plan_e', gen_random_uuid()), ('e1', gen_random_uuid()),
  ('plan_f', gen_random_uuid()), ('f1', gen_random_uuid()), ('f2', gen_random_uuid()),
  ('plan_g', gen_random_uuid()), ('g1', gen_random_uuid()),
  ('plan_h', gen_random_uuid()), ('h1', gen_random_uuid()),
  ('plan_p', gen_random_uuid()), ('p1', gen_random_uuid());

create or replace function pg_temp.fx(p text) returns uuid language sql stable as
  $$ select id from f04_fx where k = p $$;
create or replace function pg_temp.at(p interval) returns timestamptz language sql stable as
  $$ select t + p from f04_base $$;

insert into public.people (id, organization_id, first_name, email) values
  (pg_temp.fx('guest'), pg_temp.fx('org'), 'F04 Guest', null),
  (pg_temp.fx('guest2'), pg_temp.fx('org'), 'F04 Guest Two', null);

insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by) values
  (pg_temp.fx('plan_a'), pg_temp.fx('org'), 'bbbbbbbb-0000-4000-8000-000000000001', 'F04 Plan A', pg_temp.at('2 days 9 hours'), 'published', '22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('plan_b'), pg_temp.fx('org'), 'bbbbbbbb-0000-4000-8000-000000000001', 'F04 Plan B', pg_temp.at('2 days 10 hours'), 'published', '22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('plan_c'), pg_temp.fx('org'), 'bbbbbbbb-0000-4000-8000-000000000001', 'F04 Plan C', pg_temp.at('10 days 9 hours'), 'published', '22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('plan_d'), pg_temp.fx('org'), 'bbbbbbbb-0000-4000-8000-000000000001', 'F04 Untimed', pg_temp.at('20 days 9 hours'), 'published', '22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('plan_e'), pg_temp.fx('org'), 'bbbbbbbb-0000-4000-8000-000000000001', 'F04 Overnight', pg_temp.at('30 days 22 hours'), 'published', '22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('plan_f'), pg_temp.fx('org'), 'bbbbbbbb-0000-4000-8000-000000000001', 'F04 After midnight', pg_temp.at('31 days'), 'published', '22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('plan_g'), pg_temp.fx('org'), 'bbbbbbbb-0000-4000-8000-000000000001', 'F04 Fall back', '2027-11-07T06:00:00Z', 'published', '22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('plan_h'), pg_temp.fx('org'), 'bbbbbbbb-0000-4000-8000-000000000001', 'F04 Fall back two', '2027-11-07T06:00:00Z', 'published', '22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('plan_p'), pg_temp.fx('org'), 'bbbbbbbb-0000-4000-8000-000000000001', 'F04 Prepared', pg_temp.at('50 days 9 hours'), 'published', '22222222-2222-4222-8222-222222222222');

insert into public.plan_times (id, plan_id, kind, name, starts_at, ends_at, sort_order) values
  (pg_temp.fx('a_reh'), pg_temp.fx('plan_a'), 'rehearsal', 'Friday rehearsal', pg_temp.at('19 hours'), pg_temp.at('21 hours'), 0),
  (pg_temp.fx('a_s1'), pg_temp.fx('plan_a'), 'service', '09:00', pg_temp.at('2 days 9 hours'), pg_temp.at('2 days 10 hours'), 1),
  (pg_temp.fx('a_s2'), pg_temp.fx('plan_a'), 'service', '11:00', pg_temp.at('2 days 11 hours'), pg_temp.at('2 days 12 hours'), 2),
  (pg_temp.fx('b_mid'), pg_temp.fx('plan_b'), 'service', 'between', pg_temp.at('2 days 10 hours 15 minutes'), pg_temp.at('2 days 10 hours 45 minutes'), 0),
  (pg_temp.fx('b_adj'), pg_temp.fx('plan_b'), 'other', 'touching', pg_temp.at('2 days 10 hours'), pg_temp.at('2 days 10 hours 15 minutes'), 1),
  (pg_temp.fx('b_late'), pg_temp.fx('plan_b'), 'other', 'during 11:00', pg_temp.at('2 days 11 hours 15 minutes'), pg_temp.at('2 days 11 hours 45 minutes'), 2),
  (pg_temp.fx('b_fri'), pg_temp.fx('plan_b'), 'rehearsal', 'Friday overlap', pg_temp.at('20 hours'), pg_temp.at('20 hours 30 minutes'), 3),
  (pg_temp.fx('c1'), pg_temp.fx('plan_c'), 'service', '09:00', pg_temp.at('10 days 9 hours'), pg_temp.at('10 days 10 hours'), 0),
  (pg_temp.fx('c2'), pg_temp.fx('plan_c'), 'service', '11:00', pg_temp.at('10 days 11 hours'), pg_temp.at('10 days 12 hours'), 1),
  (pg_temp.fx('c3'), pg_temp.fx('plan_c'), 'rehearsal', 'Thursday', pg_temp.at('8 days 19 hours'), pg_temp.at('8 days 21 hours'), 2),
  (pg_temp.fx('e1'), pg_temp.fx('plan_e'), 'service', 'Overnight', pg_temp.at('30 days 22 hours'), pg_temp.at('31 days 1 hour'), 0),
  (pg_temp.fx('f1'), pg_temp.fx('plan_f'), 'service', 'Overlaps', pg_temp.at('31 days 30 minutes'), pg_temp.at('31 days 1 hour 30 minutes'), 0),
  (pg_temp.fx('f2'), pg_temp.fx('plan_f'), 'other', 'Touches', pg_temp.at('31 days 1 hour'), pg_temp.at('31 days 2 hours'), 1),
  -- America/Chicago falls back on 2027-11-07: 01:30 CDT (06:30Z) to 01:30 CST (07:30Z) is one real hour.
  (pg_temp.fx('g1'), pg_temp.fx('plan_g'), 'service', '01:30 CDT–01:30 CST', '2027-11-07T06:30:00Z', '2027-11-07T07:30:00Z', 0),
  (pg_temp.fx('h1'), pg_temp.fx('plan_h'), 'service', 'second 01:00 hour', '2027-11-07T07:00:00Z', '2027-11-07T07:15:00Z', 0),
  (pg_temp.fx('p1'), pg_temp.fx('plan_p'), 'service', 'Prepared', pg_temp.at('50 days 9 hours'), pg_temp.at('50 days 10 hours'), 0);

-- Morgan becomes a scheduler scoped to the Band team only (no override).
update public.organization_members set role = 'scheduler', access_mode = 'scoped'
 where organization_id = pg_temp.fx('org') and user_id = '55555555-5555-4555-8555-555555555555';
insert into public.access_grants (organization_id, user_id, capability, scope_type, team_id)
values (pg_temp.fx('org'), '55555555-5555-4555-8555-555555555555', 'scheduling.manage', 'team', pg_temp.fx('band'));

-- A private blockout reason that must never reach a scheduler.
insert into public.blockouts (organization_id, person_id, user_id, starts_at, ends_at, reason)
values (pg_temp.fx('org'), pg_temp.fx('riley'), '44444444-4444-4444-8444-444444444444',
        pg_temp.at('2 days 10 hours 30 minutes'), pg_temp.at('2 days 10 hours 40 minutes'), 'Private medical reason');

set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

-- ------------------------------------------------ selected attendance ----
insert into f04_fx
select 'riley_a', id from public.schedule_plan_assignments(
  pg_temp.fx('plan_a'),
  jsonb_build_array(jsonb_build_object(
    'person_id', pg_temp.fx('riley'), 'team_id', pg_temp.fx('band'),
    'position_id', 'dddddddd-0000-4000-8000-000000000003',
    'attendance_mode', 'selected', 'time_ids', jsonb_build_array(pg_temp.fx('a_s1'), pg_temp.fx('a_reh')))),
  false, 'f04-riley-a');

do $$ begin
  if (select array_agg(plan_time_id order by plan_time_id) from public.assignment_attendance_for(array[pg_temp.fx('riley_a')]))
     <> (select array_agg(id order by id) from f04_fx where k in ('a_s1', 'a_reh')) then
    raise exception 'resolver does not return exactly the selected times';
  end if;
  if exists (select 1 from public.assignment_attendance_for(array[pg_temp.fx('riley_a')]) where source <> 'plan_time') then
    raise exception 'timed plan produced a fallback interval';
  end if;
end $$;

-- ---------------------------------------------------- exact intervals ----
create or replace function pg_temp.conflicts(p_person text, p_plan text, p_times text[], p_team text default 'band')
returns setof record language sql as $$
  select c.kind, c.severity, c.detail, c.redacted, c.other_plan_id, c.override_permitted
    from public.check_assignment_conflicts(pg_temp.fx('org'),
      jsonb_build_array(jsonb_build_object(
        'person_id', pg_temp.fx(p_person), 'plan_id', pg_temp.fx(p_plan), 'team_id', pg_temp.fx(p_team),
        'attendance_mode', 'selected',
        'time_ids', (select jsonb_agg(pg_temp.fx(t)) from unnest(p_times) t)))) c
$$;

do $$
declare v_count int;
begin
  -- 09:00–10:00 + 11:00–12:00 do not block the 10:15–10:45 gap (apart from
  -- the blockout inside it, which is a different kind).
  select count(*) into v_count from pg_temp.conflicts('riley', 'plan_b', array['b_mid'])
    as c(kind text, severity text, detail text, redacted boolean, other_plan_id uuid, override_permitted boolean)
   where c.kind = 'overlapping_commitment';
  if v_count <> 0 then raise exception 'a gap between services was reported as an overlap'; end if;
  -- Touching end/start is not an overlap.
  select count(*) into v_count from pg_temp.conflicts('riley', 'plan_b', array['b_adj'])
    as c(kind text, severity text, detail text, redacted boolean, other_plan_id uuid, override_permitted boolean);
  if v_count <> 0 then raise exception 'adjacent intervals were reported as overlapping'; end if;
  -- Riley attends only the 09:00 service, so 11:15 does not collide with 11:00.
  select count(*) into v_count from pg_temp.conflicts('riley', 'plan_b', array['b_late'])
    as c(kind text, severity text, detail text, redacted boolean, other_plan_id uuid, override_permitted boolean);
  if v_count <> 0 then raise exception 'an unselected time produced a conflict'; end if;
  -- The Friday rehearsal overlap does block.
  select count(*) into v_count from pg_temp.conflicts('riley', 'plan_b', array['b_fri'])
    as c(kind text, severity text, detail text, redacted boolean, other_plan_id uuid, override_permitted boolean)
   where c.kind = 'overlapping_commitment' and c.severity = 'blocking'
     and c.detail = 'F04 Plan A · Friday rehearsal' and c.other_plan_id = pg_temp.fx('plan_a')
     and c.override_permitted;
  if v_count <> 1 then raise exception 'rehearsal overlap not reported exactly once (%)', v_count; end if;
  -- Blockouts are their own kind and never show the private reason.
  select count(*) into v_count from pg_temp.conflicts('riley', 'plan_b', array['b_mid'])
    as c(kind text, severity text, detail text, redacted boolean, other_plan_id uuid, override_permitted boolean)
   where c.kind = 'blockout' and c.detail = 'Unavailable';
  if v_count <> 1 then raise exception 'blockout not reported as a redacted blockout'; end if;
  if exists (select 1 from public.check_assignment_conflicts(pg_temp.fx('org'),
               jsonb_build_array(jsonb_build_object('person_id', pg_temp.fx('riley'), 'plan_id', pg_temp.fx('plan_b'),
                 'attendance_mode', 'all'))) c where c.detail ilike '%medical%') then
    raise exception 'a blockout reason leaked';
  end if;
end $$;

-- A time from another plan is refused.
do $$ begin
  perform * from public.check_assignment_conflicts(pg_temp.fx('org'),
    jsonb_build_array(jsonb_build_object('person_id', pg_temp.fx('riley'), 'plan_id', pg_temp.fx('plan_b'),
      'attendance_mode', 'selected', 'time_ids', jsonb_build_array(pg_temp.fx('a_s1')))));
  raise exception 'foreign time id accepted by the check';
exception when sqlstate '22023' then null;
end $$;
do $$ begin
  perform public.schedule_plan_assignments(pg_temp.fx('plan_b'),
    jsonb_build_array(jsonb_build_object('person_id', pg_temp.fx('guest'), 'team_id', pg_temp.fx('band'),
      'attendance_mode', 'selected', 'time_ids', jsonb_build_array(pg_temp.fx('a_s1')))), false);
  raise exception 'foreign time id accepted when scheduling';
exception when sqlstate '22023' then null;
end $$;

-- ------------------------------------------ commit recheck and override ----
do $$
declare v_hint text; v_detail text;
begin
  perform public.schedule_plan_assignments(pg_temp.fx('plan_b'),
    jsonb_build_array(jsonb_build_object('person_id', pg_temp.fx('riley'), 'team_id', pg_temp.fx('band'),
      'attendance_mode', 'selected', 'time_ids', jsonb_build_array(pg_temp.fx('b_fri')))), false);
  raise exception 'a blocking conflict committed without an override';
exception when sqlstate 'PT409' then
  get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
  if v_hint <> 'scheduling_conflict' or (v_detail::jsonb -> 0 ->> 'kind') <> 'overlapping_commitment' then
    raise exception 'conflict error is not typed (hint %, detail %)', v_hint, v_detail;
  end if;
end $$;

-- Same plan, another position, overlapping: shown as a warning, not blocking.
do $$ begin
  if (select c.severity from public.check_assignment_conflicts(pg_temp.fx('org'),
        jsonb_build_array(jsonb_build_object('person_id', pg_temp.fx('riley'), 'plan_id', pg_temp.fx('plan_a'),
          'team_id', pg_temp.fx('band'), 'position_id', 'dddddddd-0000-4000-8000-000000000004',
          'attendance_mode', 'selected', 'time_ids', jsonb_build_array(pg_temp.fx('a_s1'))))) c
       where c.kind = 'overlapping_commitment') <> 'warning' then
    raise exception 'same-plan double role is not a warning';
  end if;
  -- The identical obligation (same plan/team/position) is not a conflict with itself.
  if exists (select 1 from public.check_assignment_conflicts(pg_temp.fx('org'),
        jsonb_build_array(jsonb_build_object('person_id', pg_temp.fx('riley'), 'plan_id', pg_temp.fx('plan_a'),
          'team_id', pg_temp.fx('band'), 'position_id', 'dddddddd-0000-4000-8000-000000000003',
          'attendance_mode', 'all'))) c where c.kind = 'overlapping_commitment') then
    raise exception 'the identical request conflicted with itself';
  end if;
end $$;

-- Override with a reason: committed and audited.
insert into f04_fx
select 'riley_b', id from public.schedule_plan_assignments(pg_temp.fx('plan_b'),
  jsonb_build_array(jsonb_build_object('person_id', pg_temp.fx('riley'), 'team_id', pg_temp.fx('band'),
    'attendance_mode', 'selected', 'time_ids', jsonb_build_array(pg_temp.fx('b_fri')))),
  false, null, null, null, 'Only needed for the first half hour');
do $$ begin
  if (select count(*) from public.assignment_conflict_overrides
       where assignment_id = pg_temp.fx('riley_b') and reason = 'Only needed for the first half hour'
         and actor_id = '22222222-2222-4222-8222-222222222222'
         and conflicts -> 0 ->> 'other_plan_id' = pg_temp.fx('plan_a')::text) <> 1 then
    raise exception 'override not audited';
  end if;
end $$;

-- Jordan also places Riley on Production for plan A (a double role on that plan).
insert into f04_fx
select 'riley_prod', id from public.schedule_plan_assignments(pg_temp.fx('plan_a'),
  jsonb_build_array(jsonb_build_object('person_id', pg_temp.fx('riley'), 'team_id', pg_temp.fx('production'),
    'attendance_mode', 'selected', 'time_ids', jsonb_build_array(pg_temp.fx('a_s2')))), false);

-- --------------------------------------------- scoped scheduler and redaction
set local request.jwt.claim.sub = '55555555-5555-4555-8555-555555555555';
do $$
declare v_row record;
begin
  -- Riley's Production 11:00 request is outside Morgan's scope: an interval,
  -- not a plan. The Band rehearsal (in scope) keeps its title.
  select * into v_row from public.check_assignment_conflicts(pg_temp.fx('org'),
    jsonb_build_array(jsonb_build_object('person_id', pg_temp.fx('riley'), 'plan_id', pg_temp.fx('plan_b'),
      'team_id', pg_temp.fx('band'), 'attendance_mode', 'selected', 'time_ids', jsonb_build_array(pg_temp.fx('b_late'))))) c
   where c.kind = 'overlapping_commitment';
  if v_row is null or not v_row.redacted or v_row.detail <> 'Another commitment'
     or v_row.other_plan_id is not null or v_row.other_assignment_id is not null then
    raise exception 'out-of-scope commitment not redacted: %', row_to_json(v_row);
  end if;
  if v_row.override_permitted then raise exception 'scoped scheduler may override without the capability'; end if;
end $$;
do $$ begin
  perform public.schedule_plan_assignments(pg_temp.fx('plan_b'),
    jsonb_build_array(jsonb_build_object('person_id', pg_temp.fx('riley'), 'team_id', pg_temp.fx('band'),
      'position_id', 'dddddddd-0000-4000-8000-000000000004',
      'attendance_mode', 'selected', 'time_ids', jsonb_build_array(pg_temp.fx('b_late')))),
    false, null, null, null, 'Trying anyway');
  raise exception 'override accepted without the capability';
exception when sqlstate '42501' then null;
end $$;
do $$ begin
  if (select count(*) from public.assignment_conflict_overrides) <> 1 then
    raise exception 'Band scheduler cannot read the Band override audit';
  end if;
end $$;
reset role;
insert into public.access_grants (organization_id, user_id, capability, scope_type, team_id)
values (pg_temp.fx('org'), '55555555-5555-4555-8555-555555555555', 'scheduling.override_conflicts', 'team', pg_temp.fx('band'));
set local role authenticated;
do $$ begin
  if not (select bool_and(c.override_permitted) from public.check_assignment_conflicts(pg_temp.fx('org'),
       jsonb_build_array(jsonb_build_object('person_id', pg_temp.fx('riley'), 'plan_id', pg_temp.fx('plan_b'),
         'team_id', pg_temp.fx('band'), 'attendance_mode', 'all'))) c) then
    raise exception 'team override grant not honoured';
  end if;
end $$;

-- A member cannot check conflicts or read audits.
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$ begin
  perform * from public.check_assignment_conflicts(pg_temp.fx('org'), '[]'::jsonb);
  raise exception 'member ran a conflict check';
exception when sqlstate '42501' then null;
end $$;
do $$ begin
  if exists (select 1 from public.assignment_conflict_overrides) then raise exception 'member read override audit'; end if;
end $$;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

-- ------------------------------------------ overnight and DST intervals ----
insert into f04_fx
select 'guest_e', id from public.schedule_plan_assignments(pg_temp.fx('plan_e'),
  jsonb_build_array(jsonb_build_object('person_id', pg_temp.fx('guest'), 'team_id', pg_temp.fx('band'))), false);
insert into f04_fx
select 'guest_g', id from public.schedule_plan_assignments(pg_temp.fx('plan_g'),
  jsonb_build_array(jsonb_build_object('person_id', pg_temp.fx('guest'), 'team_id', pg_temp.fx('band'))), false);
do $$ begin
  if (select count(*) from pg_temp.conflicts('guest', 'plan_f', array['f1'])
        as c(kind text, severity text, detail text, redacted boolean, other_plan_id uuid, override_permitted boolean)) <> 1 then
    raise exception 'overnight overlap after midnight not detected';
  end if;
  if (select count(*) from pg_temp.conflicts('guest', 'plan_f', array['f2'])
        as c(kind text, severity text, detail text, redacted boolean, other_plan_id uuid, override_permitted boolean)) <> 0 then
    raise exception 'touching the overnight end was reported';
  end if;
  if (select count(*) from pg_temp.conflicts('guest', 'plan_h', array['h1'])
        as c(kind text, severity text, detail text, redacted boolean, other_plan_id uuid, override_permitted boolean)) <> 1 then
    raise exception 'repeated fall-back hour overlap not detected';
  end if;
end $$;

-- ------------------------------------------------------ untimed fallback ----
insert into f04_fx
select 'guest_d', id from public.schedule_plan_assignments(pg_temp.fx('plan_d'),
  jsonb_build_array(jsonb_build_object('person_id', pg_temp.fx('guest'), 'team_id', pg_temp.fx('band'))), false);
do $$ begin
  if (select count(*) from public.assignment_attendance_for(array[pg_temp.fx('guest_d')])
       where source = 'untimed_fallback' and plan_time_id is null
         and ends_at - starts_at = interval '2 hours') <> 1 then
    raise exception 'untimed plan does not resolve to one labelled fallback interval';
  end if;
end $$;

-- --------------------------------------------- change attendance scope ----
insert into f04_fx
select 'sam_c', id from public.schedule_plan_assignments(pg_temp.fx('plan_c'),
  jsonb_build_array(jsonb_build_object('person_id', pg_temp.fx('sam'), 'team_id', pg_temp.fx('band'),
    'position_id', 'dddddddd-0000-4000-8000-000000000003',
    'attendance_mode', 'selected', 'time_ids', jsonb_build_array(pg_temp.fx('c1'), pg_temp.fx('c3')))),
  true, 'f04-sam-c');
insert into f04_fx
select 'guest2_c', id from public.schedule_plan_assignments(pg_temp.fx('plan_c'),
  jsonb_build_array(jsonb_build_object('person_id', pg_temp.fx('guest2'), 'team_id', pg_temp.fx('band'))), false);

do $$
declare v_rev bigint := (select request_revision from public.assignments where id = pg_temp.fx('sam_c'));
begin
  insert into f04_val values ('sam_rev', to_jsonb(v_rev));
  if not (select applicable from public.attendance_calendar_states
           where person_id = pg_temp.fx('sam') and plan_time_id = pg_temp.fx('c3')) then
    raise exception 'released selected time has no calendar state';
  end if;
  begin
    perform public.set_assignment_attendance(pg_temp.fx('plan_c'),
      jsonb_build_array(jsonb_build_object('assignment_id', pg_temp.fx('sam_c'),
        'expected_request_revision', v_rev - 1, 'attendance_mode', 'selected',
        'time_ids', jsonb_build_array(pg_temp.fx('c1')))));
    raise exception 'stale attendance revision accepted';
  exception when sqlstate 'PT409' then null;
  end;
  begin
    perform public.set_assignment_attendance(pg_temp.fx('plan_c'),
      jsonb_build_array(jsonb_build_object('assignment_id', pg_temp.fx('sam_c'),
        'expected_request_revision', v_rev, 'attendance_mode', 'selected',
        'time_ids', jsonb_build_array(pg_temp.fx('a_s1')))));
    raise exception 'another plan''s time accepted for attendance';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- Narrow Sam to C1 + C2: C3 drops out (CANCELLED with a higher sequence), C2 joins.
select public.set_assignment_attendance(pg_temp.fx('plan_c'),
  jsonb_build_array(jsonb_build_object('assignment_id', pg_temp.fx('sam_c'),
    'expected_request_revision', (select v from f04_val where k = 'sam_rev')::bigint,
    'attendance_mode', 'selected',
    'time_ids', jsonb_build_array(pg_temp.fx('c1'), pg_temp.fx('c3')))), null, false);
do $$ begin
  -- Same set again: no change, no new revision.
  if (select request_revision from public.assignments where id = pg_temp.fx('sam_c'))
     <> (select v from f04_val where k = 'sam_rev')::bigint then
    raise exception 'an unchanged scope bumped the request revision';
  end if;
end $$;
select public.set_assignment_attendance(pg_temp.fx('plan_c'),
  jsonb_build_array(jsonb_build_object('assignment_id', pg_temp.fx('sam_c'),
    'expected_request_revision', (select v from f04_val where k = 'sam_rev')::bigint,
    'attendance_mode', 'selected',
    'time_ids', jsonb_build_array(pg_temp.fx('c1'), pg_temp.fx('c2')))), null, true, 'f04-sam-narrow');
do $$ begin
  if (select request_revision from public.assignments where id = pg_temp.fx('sam_c'))
     <= (select v from f04_val where k = 'sam_rev')::bigint then
    raise exception 'scope change did not bump the request revision';
  end if;
  if (select applicable or sequence_offset <> 1 from public.attendance_calendar_states
       where person_id = pg_temp.fx('sam') and plan_time_id = pg_temp.fx('c3')) then
    raise exception 'dropped time is not cancelled with a bumped sequence';
  end if;
  if not (select applicable from public.attendance_calendar_states
           where person_id = pg_temp.fx('sam') and plan_time_id = pg_temp.fx('c2')) then
    raise exception 'added time is not applicable';
  end if;
  -- Only Sam was re-requested, with exactly the new scope.
  if (select array_agg(i.plan_time_ids) from public.delivery_effects e
        join public.assignment_request_snapshots s on s.effect_id = e.id
        join public.assignment_request_snapshot_items i on i.snapshot_id = s.id
       where e.effect_key = 'f04-sam-narrow') is null
     or exists (select 1 from public.delivery_effects e
                  join public.assignment_request_snapshots s on s.effect_id = e.id
                 where e.effect_key = 'f04-sam-narrow' and s.person_id <> pg_temp.fx('sam')) then
    raise exception 'attendance change was not re-requested to exactly that Person';
  end if;
  -- The request sent for the old scope can no longer be answered as it was.
  if (select array_agg(plan_time_id order by starts_at, plan_time_id)
        from public.assignment_attendance_for(array[pg_temp.fx('sam_c')]))
     = (select i.plan_time_ids from public.assignment_request_snapshot_items i
          join public.assignment_request_snapshots s on s.id = i.snapshot_id
          join public.delivery_effects e on e.id = s.effect_id
         where e.effect_key = 'f04-sam-c') then
    raise exception 'old request scope still matches after the change';
  end if;
end $$;
reset role;
-- Seed a per-time answer and history for C2 so time removal can be checked.
insert into public.assignment_time_responses (assignment_id, plan_time_id, status)
values (pg_temp.fx('sam_c'), pg_temp.fx('c2'), 'confirmed');
insert into public.assignment_time_response_history (organization_id, assignment_id, plan_time_id, assignee_person_id, status)
values (pg_temp.fx('org'), pg_temp.fx('sam_c'), pg_temp.fx('c2'), pg_temp.fx('sam'), 'confirmed');
set local role authenticated;

-- ------------------------------------------------- time-edit impact ----
create or replace function pg_temp.times_payload(p_drop text[], p_add boolean, p_move_c1 boolean)
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(x order by x->>'sort_order'), '[]'::jsonb) from (
    select jsonb_build_object('id', pt.id, 'kind', pt.kind, 'name', pt.name,
      'starts_at', case when p_move_c1 and pt.id = pg_temp.fx('c1') then pt.starts_at + interval '30 minutes' else pt.starts_at end,
      'ends_at', case when p_move_c1 and pt.id = pg_temp.fx('c1') then pt.ends_at + interval '30 minutes' else pt.ends_at end,
      'sort_order', pt.sort_order) x
      from public.plan_times pt
     where pt.plan_id = pg_temp.fx('plan_c')
       and pt.id not in (select pg_temp.fx(k) from unnest(p_drop) k)
    union all
    select jsonb_build_object('id', pg_temp.fx('c4'), 'kind', 'other', 'name', 'Meal',
      'starts_at', pg_temp.at('10 days 13 hours'), 'ends_at', pg_temp.at('10 days 14 hours'), 'sort_order', 9)
     where p_add
  ) q
$$;

do $$
declare
  v_impact jsonb;
  v_sam jsonb;
  v_guest jsonb;
begin
  -- Reorder only: identity preserved, nobody affected.
  v_impact := public.preview_plan_time_changes(pg_temp.fx('plan_c'), pg_temp.times_payload('{}', false, false));
  if jsonb_array_length(v_impact->'assignments') <> 0 or (v_impact->>'hidden_affected')::int <> 0 then
    raise exception 'an unchanged list reported affected requests: %', v_impact;
  end if;

  -- Add C4, move C1: guest (all) gains C4 and has C1 changed; Sam (C1, C2) has C1 changed.
  v_impact := public.preview_plan_time_changes(pg_temp.fx('plan_c'), pg_temp.times_payload('{}', true, true));
  select x into v_sam from jsonb_array_elements(v_impact->'assignments') x where x->>'assignment_id' = pg_temp.fx('sam_c')::text;
  select x into v_guest from jsonb_array_elements(v_impact->'assignments') x where x->>'assignment_id' = pg_temp.fx('guest2_c')::text;
  if v_sam->'gains' <> '[]'::jsonb or v_sam->'changed' <> to_jsonb(array[pg_temp.fx('c1')]) then
    raise exception 'selected request impact wrong: %', v_sam;
  end if;
  if v_guest->'gains' <> to_jsonb(array[pg_temp.fx('c4')]) or v_guest->'changed' <> to_jsonb(array[pg_temp.fx('c1')]) then
    raise exception 'all-times request impact wrong: %', v_guest;
  end if;

  -- Remove C1 and C2: Sam is left with no time (orphaned), guest loses both.
  v_impact := public.preview_plan_time_changes(pg_temp.fx('plan_c'), pg_temp.times_payload(array['c1', 'c2'], false, false));
  select x into v_sam from jsonb_array_elements(v_impact->'assignments') x where x->>'assignment_id' = pg_temp.fx('sam_c')::text;
  if not (v_sam->>'orphaned')::boolean then raise exception 'orphaned selected request not reported'; end if;
  insert into f04_val values ('orphan_hash', to_jsonb(v_impact->>'impact_hash')),
                             ('orphan_rev', v_impact->'content_revision');

  -- Legacy path cannot delete a selected time.
  begin
    perform public.replace_plan_times(pg_temp.fx('plan_c'), pg_temp.times_payload(array['c1', 'c2'], false, false), null);
    raise exception 'legacy replacement deleted a selected time';
  exception when sqlstate 'PT409' then null;
  end;
  -- Commit without resolving the orphan is refused.
  begin
    perform public.apply_plan_time_changes(pg_temp.fx('plan_c'), pg_temp.times_payload(array['c1', 'c2'], false, false),
      (v_impact->>'content_revision')::bigint, v_impact->>'impact_hash', '[]'::jsonb, false);
    raise exception 'orphaned request committed without a resolution';
  exception when sqlstate 'PT409' then null;
  end;
  -- A stale hash is refused.
  begin
    perform public.apply_plan_time_changes(pg_temp.fx('plan_c'), pg_temp.times_payload(array['c1', 'c2'], false, false),
      (v_impact->>'content_revision')::bigint, md5('stale'),
      jsonb_build_array(jsonb_build_object('assignment_id', pg_temp.fx('sam_c'), 'action', 'all')), false);
    raise exception 'stale impact hash accepted';
  exception when sqlstate 'PT409' then null;
  end;
end $$;

-- Someone else changes who is affected after the preview: the old hash is stale.
reset role;
insert into public.assignments (plan_id, person_id, team_id, status, created_by, attendance_mode)
values (pg_temp.fx('plan_c'), pg_temp.fx('riley'), pg_temp.fx('production'), 'unconfirmed', '22222222-2222-4222-8222-222222222222', 'all');
set local role authenticated;
do $$ begin
  perform public.apply_plan_time_changes(pg_temp.fx('plan_c'), pg_temp.times_payload(array['c1', 'c2'], false, false),
    (select v from f04_val where k = 'orphan_rev')::bigint, (select v #>> '{}' from f04_val where k = 'orphan_hash'),
    jsonb_build_array(jsonb_build_object('assignment_id', pg_temp.fx('sam_c'), 'action', 'all')), false);
  raise exception 'impact changed after preview but the commit went through';
exception when sqlstate 'PT409' then null;
end $$;

-- Fresh preview, then commit with the orphan resolved to all times.
do $$
declare
  v_impact jsonb := public.preview_plan_time_changes(pg_temp.fx('plan_c'), pg_temp.times_payload(array['c1', 'c2'], true, false));
  v_result jsonb;
  v_live_before int;
begin
  select count(*) into v_live_before from public.assignment_request_snapshots
   where plan_id = pg_temp.fx('plan_c') and person_id = pg_temp.fx('sam') and consumed_at is null and superseded_at is null;
  if v_live_before = 0 then raise exception 'fixture: Sam has no live request to invalidate'; end if;

  v_result := public.apply_plan_time_changes(pg_temp.fx('plan_c'), pg_temp.times_payload(array['c1', 'c2'], true, false),
    (v_impact->>'content_revision')::bigint, v_impact->>'impact_hash',
    jsonb_build_array(jsonb_build_object('assignment_id', pg_temp.fx('sam_c'), 'action', 'all')), true, 'f04-times-commit');

  if (select attendance_mode from public.assignments where id = pg_temp.fx('sam_c')) <> 'all' then
    raise exception 'orphan resolution not applied';
  end if;
  if exists (select 1 from public.plan_times where id in (pg_temp.fx('c1'), pg_temp.fx('c2'))) then
    raise exception 'removed times still exist';
  end if;
  if exists (select 1 from public.assignment_time_responses where plan_time_id = pg_temp.fx('c2')) then
    raise exception 'answer for a removed time survived';
  end if;
  if not exists (select 1 from public.assignment_time_response_history
                  where assignment_id = pg_temp.fx('sam_c') and plan_time_id is null) then
    raise exception 'history for a removed time was lost';
  end if;
  if (v_result->>'invalidated_requests')::int < 1 then raise exception 'live requests were not invalidated'; end if;
  if exists (select 1 from public.assignment_request_snapshots s
              where s.plan_id = pg_temp.fx('plan_c') and s.person_id = pg_temp.fx('sam')
                and s.consumed_at is null and s.superseded_at is null
                and s.effect_id is distinct from (select id from public.delivery_effects where effect_key = 'f04-times-commit')) then
    raise exception 'a pre-change request is still answerable';
  end if;
  if not exists (select 1 from public.delivery_effects e
                   join public.assignment_request_snapshots s on s.effect_id = e.id
                  where e.effect_key = 'f04-times-commit' and s.person_id = pg_temp.fx('sam')) then
    raise exception 'affected Person was not re-requested';
  end if;
  -- A prepared or unaffected plan is untouched; Sam now attends C3 + C4.
  if (select array_agg(plan_time_id order by plan_time_id) from public.assignment_attendance_for(array[pg_temp.fx('sam_c')]))
     <> (select array_agg(id order by id) from f04_fx where k in ('c3', 'c4')) then
    raise exception 'resolved scope wrong after the commit';
  end if;
end $$;

-- Member cannot preview time changes.
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$ begin
  perform public.preview_plan_time_changes(pg_temp.fx('plan_c'), '[]'::jsonb);
  raise exception 'member previewed a time edit';
exception when sqlstate 'P0002' then null;
end $$;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

-- ------------------------------------------------------------- copying ----
do $$ begin
  -- Same date: Riley's copied 09:00/rehearsal overlap the originals on another plan.
  perform public.duplicate_plan(pg_temp.fx('plan_a'), pg_temp.at('2 days 9 hours'), 'F04 copy', true, 'f04-dup-0001');
  raise exception 'a conflicting copy committed without an override';
exception when sqlstate 'PT409' then null;
end $$;
insert into f04_fx
select 'plan_copy', public.duplicate_plan(pg_temp.fx('plan_a'), pg_temp.at('2 days 9 hours'), 'F04 copy', true,
  'f04-dup-0002', 'Second team for the overflow room');
do $$
declare v_copy uuid;
begin
  select id into v_copy from public.assignments
   where plan_id = pg_temp.fx('plan_copy') and person_id = pg_temp.fx('riley') and team_id = pg_temp.fx('band');
  if (select attendance_mode from public.assignments where id = v_copy) <> 'selected' then
    raise exception 'copy widened a selected request';
  end if;
  if (select count(*) from public.assignment_attendance_times aat
        join public.plan_times pt on pt.id = aat.plan_time_id
       where aat.assignment_id = v_copy and pt.plan_id = pg_temp.fx('plan_copy')) <> 2 then
    raise exception 'copied selection does not point at the copied times';
  end if;
  if not exists (select 1 from public.assignment_conflict_overrides
                  where assignment_id = v_copy and reason = 'Second team for the overflow room') then
    raise exception 'copy override not audited';
  end if;
end $$;

-- ------------------------------------------- prepared stays out of view ----
insert into f04_fx
select 'sam_p', id from public.schedule_plan_assignments(pg_temp.fx('plan_p'),
  jsonb_build_array(jsonb_build_object('person_id', pg_temp.fx('sam'), 'team_id', pg_temp.fx('band'))),
  false, null, 'prepared');
do $$ begin
  if exists (select 1 from public.attendance_calendar_states where plan_time_id = pg_temp.fx('p1')) then
    raise exception 'prepared request reached the calendar state';
  end if;
end $$;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$ begin
  if exists (select 1 from public.assignment_attendance_for(array[pg_temp.fx('sam_p')])) then
    raise exception 'recipient sees prepared attendance';
  end if;
  if not exists (select 1 from public.assignment_attendance_for(array[pg_temp.fx('sam_c')])) then
    raise exception 'recipient cannot read own released attendance';
  end if;
  if exists (select 1 from public.attendance_calendar_states where person_id <> pg_temp.fx('sam')) then
    raise exception 'member reads another Person''s calendar state';
  end if;
end $$;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

-- Declining cancels the time in the calendar; a re-request that collides is rechecked.
reset role;
update public.assignments set status = 'declined' where id = pg_temp.fx('riley_a');
do $$ begin
  if (select applicable from public.attendance_calendar_states
       where person_id = pg_temp.fx('riley') and plan_time_id = pg_temp.fx('a_reh')) then
    raise exception 'declined time still applicable';
  end if;
end $$;
set local role authenticated;
do $$ begin
  -- Riley's B rehearsal (overridden earlier) now makes re-requesting A a conflict.
  update public.assignments set status = 'unconfirmed' where id = pg_temp.fx('riley_a');
  perform private.check_pending_conflicts();
  raise exception 're-request over a conflict was not rechecked';
exception when sqlstate 'PT409' then null;
end $$;

-- A selected time cannot be deleted on its own, but its whole plan can.
do $$ begin
  delete from public.plan_times where id = pg_temp.fx('a_s1');
  raise exception 'a selected time was deleted directly';
exception when sqlstate 'PT409' then null;
end $$;
do $$ begin
  delete from public.plans where id = pg_temp.fx('plan_a');
  if exists (select 1 from public.plans where id = pg_temp.fx('plan_a')) then
    raise exception 'a plan with selected requests could not be deleted';
  end if;
end $$;

rollback;
