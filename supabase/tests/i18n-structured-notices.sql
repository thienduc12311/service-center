-- i18n: structured params on scheduling_preference_warnings (20261104000100).
-- The English `detail` is unchanged; `params` carries the values behind it.
-- Run after migrations against seeded local Supabase; rolls back.
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/i18n-structured-notices.sql
-- The F10 notice params are asserted in f10-plan-templates.sql and f10-plan-reschedule.sql.
begin;

create temporary table i18n_fx(k text primary key, id uuid) on commit drop;
grant select on i18n_fx to authenticated, service_role;
insert into i18n_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('band', 'cccccccc-0000-4000-8000-000000000001'),
  ('sam', (select id from public.people where profile_id = '33333333-3333-4333-8333-333333333333' and organization_id = 'aaaaaaaa-0000-4000-8000-000000000001')),
  ('morgan', (select id from public.people where profile_id = '55555555-5555-4555-8555-555555555555' and organization_id = 'aaaaaaaa-0000-4000-8000-000000000001')),
  ('served', gen_random_uuid()), ('target', gen_random_uuid());

-- Sam already serves on the 8th; the target plan is the 15th (week 3).
insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by) values
  ((select id from i18n_fx where k = 'served'), (select id from i18n_fx where k = 'org'), 'bbbbbbbb-0000-4000-8000-000000000001', 'i18n served', '2027-05-09', 'published', '22222222-2222-4222-8222-222222222222'),
  ((select id from i18n_fx where k = 'target'), (select id from i18n_fx where k = 'org'), 'bbbbbbbb-0000-4000-8000-000000000001', 'i18n target', '2027-05-16', 'published', '22222222-2222-4222-8222-222222222222');
insert into public.assignments (plan_id, person_id, team_id, position_id, status, visibility, created_by) values
  ((select id from i18n_fx where k = 'served'), (select id from i18n_fx where k = 'sam'), (select id from i18n_fx where k = 'band'),
   'dddddddd-0000-4000-8000-000000000003', 'confirmed', 'released', '22222222-2222-4222-8222-222222222222');
delete from public.scheduling_preferences where person_id in (select id from i18n_fx where k in ('sam', 'morgan'));
insert into public.scheduling_preferences (organization_id, person_id, team_id, frequency, max_per_month, avoided_weeks)
values ((select id from i18n_fx where k = 'org'), (select id from i18n_fx where k = 'sam'), null, 'every_other_week', 1, '{3}');
delete from public.person_availability_reviews where person_id in (select id from i18n_fx where k in ('sam', 'morgan'));
insert into public.person_availability_reviews (person_id, organization_id, reviewed_at, kind)
values ((select id from i18n_fx where k = 'morgan'), (select id from i18n_fx where k = 'org'), '2026-01-15T12:00:00Z', 'affirmed');

-- As the owner (a scheduler everywhere), through the API role.
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$
declare
  v_rows jsonb;
  v_sam uuid := (select id from i18n_fx where k = 'sam');
  v_morgan uuid := (select id from i18n_fx where k = 'morgan');
  v_tz text := (select coalesce(timezone, 'UTC') from public.organizations where id = (select id from i18n_fx where k = 'org'));
begin
  select jsonb_agg(jsonb_build_object('person', w.person_id, 'code', w.code, 'detail', w.detail, 'params', w.params)) into v_rows
    from public.scheduling_preference_warnings(
      (select id from i18n_fx where k = 'org'), (select id from i18n_fx where k = 'target'), (select id from i18n_fx where k = 'band'),
      array[v_sam, v_morgan]) w;

  if not v_rows @> jsonb_build_array(jsonb_build_object('person', v_sam, 'code', 'frequency', 'detail', 'Prefers serving every other week',
       'params', jsonb_build_object('frequency', 'every_other_week'))) then
    raise exception 'frequency params missing: %', v_rows;
  end if;
  if not v_rows @> jsonb_build_array(jsonb_build_object('person', v_sam, 'code', 'monthly_max', 'detail', 'Already serving 1 of at most 1 this month',
       'params', jsonb_build_object('served', 1, 'max', 1))) then
    raise exception 'monthly_max params missing: %', v_rows;
  end if;
  if not v_rows @> jsonb_build_array(jsonb_build_object('person', v_sam, 'code', 'avoided_week', 'detail', 'Asked not to serve in week 3 of the month',
       'params', jsonb_build_object('week', 3))) then
    raise exception 'avoided_week params missing: %', v_rows;
  end if;
  if not v_rows @> jsonb_build_array(jsonb_build_object('person', v_sam, 'code', 'availability_unknown', 'params', '{}'::jsonb)) then
    raise exception 'availability_unknown should carry empty params: %', v_rows;
  end if;
  if not v_rows @> jsonb_build_array(jsonb_build_object('person', v_morgan, 'code', 'availability_stale',
       'params', jsonb_build_object('reviewed_on', to_char('2026-01-15T12:00:00Z'::timestamptz at time zone v_tz, 'YYYY-MM-DD')))) then
    raise exception 'availability_stale params missing: %', v_rows;
  end if;
  -- Every row carries an object, never null.
  if exists (select 1 from jsonb_array_elements(v_rows) r where jsonb_typeof(r -> 'params') <> 'object') then
    raise exception 'a warning row has no params object: %', v_rows;
  end if;
end $$;
reset role;

-- A member still cannot read warnings (authorization unchanged by the re-create).
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$
begin
  perform * from public.scheduling_preference_warnings((select id from i18n_fx where k = 'org'), (select id from i18n_fx where k = 'target'),
    (select id from i18n_fx where k = 'band'), array[(select id from i18n_fx where k = 'sam')]);
  raise exception 'member read warnings';
exception when insufficient_privilege then null;
end $$;
reset role;

-- Grants survived the drop and re-create.
do $$
begin
  if has_function_privilege('anon', 'public.scheduling_preference_warnings(uuid, uuid, uuid, uuid[], uuid[])', 'execute') then
    raise exception 'anon can execute scheduling_preference_warnings';
  end if;
  if not has_function_privilege('authenticated', 'public.scheduling_preference_warnings(uuid, uuid, uuid, uuid[], uuid[])', 'execute') then
    raise exception 'authenticated lost execute on scheduling_preference_warnings';
  end if;
end $$;

select 'i18n-structured-notices: ok';
rollback;
