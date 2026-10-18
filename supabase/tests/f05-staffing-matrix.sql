-- F05: atomic multi-plan staffing, stale rollback, idempotency and fresh copies.
-- Run against the seeded local database. Everything rolls back.
begin;

create temporary table f05_fx (k text primary key, id uuid) on commit drop;
grant select, insert, update, delete on f05_fx to authenticated, service_role;
insert into f05_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('band', 'cccccccc-0000-4000-8000-000000000001'),
  ('position', 'dddddddd-0000-4000-8000-000000000003'),
  ('sam', (select id from public.people where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' and profile_id = '33333333-3333-4333-8333-333333333333')),
  ('riley', (select id from public.people where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' and profile_id = '44444444-4444-4444-8444-444444444444')),
  ('plan_a', gen_random_uuid()), ('plan_b', gen_random_uuid());
create or replace function pg_temp.fx(p text) returns uuid language sql stable as
  $$ select id from f05_fx where k = p $$;

insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by) values
  (pg_temp.fx('plan_a'), pg_temp.fx('org'), 'bbbbbbbb-0000-4000-8000-000000000001', 'F05 A', now() + interval '500 days', 'draft', '22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('plan_b'), pg_temp.fx('org'), 'bbbbbbbb-0000-4000-8000-000000000001', 'F05 B', now() + interval '507 days', 'draft', '22222222-2222-4222-8222-222222222222');
insert into public.plan_times (plan_id, kind, name, starts_at, ends_at, sort_order) values
  (pg_temp.fx('plan_a'), 'service', 'Service', now() + interval '500 days', now() + interval '500 days 1 hour', 0),
  (pg_temp.fx('plan_b'), 'service', 'Service', now() + interval '507 days', now() + interval '507 days 1 hour', 0);

set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

do $$
declare actions jsonb; revisions jsonb; operation text; first_result jsonb; replay jsonb;
begin
  actions := jsonb_build_array(
    jsonb_build_object('kind','assign','plan_id',pg_temp.fx('plan_a'),'person_id',pg_temp.fx('sam'),
      'team_id',pg_temp.fx('band'),'position_id',pg_temp.fx('position'),'visibility','prepared',
      'attendance_mode','all','time_ids','[]'::jsonb,'notify',false),
    jsonb_build_object('kind','assign','plan_id',pg_temp.fx('plan_b'),'person_id',pg_temp.fx('riley'),
      'team_id',pg_temp.fx('band'),'position_id',pg_temp.fx('position'),'visibility','prepared',
      'attendance_mode','all','time_ids','[]'::jsonb,'notify',false));
  revisions := (select jsonb_agg(jsonb_build_object('plan_id', id, 'staffing_revision', staffing_revision) order by id)
    from public.plans where id in (pg_temp.fx('plan_a'), pg_temp.fx('plan_b')));
  operation := public.staffing_matrix_operation_id(actions, revisions);
  first_result := public.commit_staffing_matrix(pg_temp.fx('org'), operation, actions, revisions, 'f05-first-batch');
  replay := public.commit_staffing_matrix(pg_temp.fx('org'), operation, actions, revisions, 'f05-first-batch');
  if first_result <> replay then raise exception 'idempotent replay returned a different result'; end if;
  if (select count(*) from public.assignments where plan_id in (pg_temp.fx('plan_a'), pg_temp.fx('plan_b'))) <> 2 then
    raise exception 'two-plan batch did not create exactly two requests';
  end if;
  if exists (select 1 from public.assignments where plan_id in (pg_temp.fx('plan_a'), pg_temp.fx('plan_b'))
      and (status <> 'unconfirmed' or visibility <> 'prepared' or notified_at is not null or responded_at is not null)) then
    raise exception 'new matrix requests reused response or delivery state';
  end if;
end $$;

-- A stale revision in the middle scope aborts the entire declared batch.
do $$
declare actions jsonb; revisions jsonb; operation text; before_count integer; hint text;
begin
  actions := jsonb_build_array(
    jsonb_build_object('kind','remove','plan_id',pg_temp.fx('plan_a'),'assignment_id',
      (select id from public.assignments where plan_id = pg_temp.fx('plan_a')),
      'expected_request_revision',(select request_revision from public.assignments where plan_id = pg_temp.fx('plan_a'))),
    jsonb_build_object('kind','remove','plan_id',pg_temp.fx('plan_b'),'assignment_id',
      (select id from public.assignments where plan_id = pg_temp.fx('plan_b')),
      'expected_request_revision',(select request_revision from public.assignments where plan_id = pg_temp.fx('plan_b'))));
  revisions := (select jsonb_agg(jsonb_build_object('plan_id', id, 'staffing_revision', staffing_revision) order by id)
    from public.plans where id in (pg_temp.fx('plan_a'), pg_temp.fx('plan_b')));
  operation := public.staffing_matrix_operation_id(actions, revisions);
  select count(*) into before_count from public.assignments where plan_id in (pg_temp.fx('plan_a'), pg_temp.fx('plan_b'));
  update public.assignments set notes = 'changed after preview' where plan_id = pg_temp.fx('plan_b');
  begin
    perform public.commit_staffing_matrix(pg_temp.fx('org'), operation, actions, revisions, 'f05-stale-batch');
    raise exception 'stale batch committed';
  exception when sqlstate 'PT409' then get stacked diagnostics hint = pg_exception_hint;
  end;
  if hint <> 'matrix_changed' then raise exception 'stale batch did not return matrix_changed'; end if;
  if (select count(*) from public.assignments where plan_id in (pg_temp.fx('plan_a'), pg_temp.fx('plan_b'))) <> before_count then
    raise exception 'stale batch partially removed requests';
  end if;
end $$;

-- Saved views are owner-only even inside the same organization.
insert into public.staffing_matrix_views (organization_id, owner_id, name, filters)
values (pg_temp.fx('org'), '22222222-2222-4222-8222-222222222222', 'My month', '{"plan_ids":[]}'::jsonb);
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$ begin
  if exists (select 1 from public.staffing_matrix_views where name = 'My month') then
    raise exception 'another owner read a saved matrix view';
  end if;
end $$;

rollback;
