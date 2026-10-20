-- F10 Pass C: deliberate bulk rescheduling (shift whole plans vs order only).
-- Run against the seeded local database. Everything rolls back.
begin;

create temporary table f10r_fx (k text primary key, id uuid) on commit drop;
grant select, insert, update, delete on f10r_fx to authenticated, service_role;
insert into f10r_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('st', 'bbbbbbbb-0000-4000-8000-000000000001'),
  ('band', 'cccccccc-0000-4000-8000-000000000001'),
  ('keys', 'dddddddd-0000-4000-8000-000000000006'),
  ('leader', 'dddddddd-0000-4000-8000-000000000001'),
  ('sam', (select id from public.people where profile_id = '33333333-3333-4333-8333-333333333333')),
  ('riley', (select id from public.people where profile_id = '44444444-4444-4444-8444-444444444444')),
  ('morgan', (select id from public.people where profile_id = '55555555-5555-4555-8555-555555555555')),
  ('a', gen_random_uuid()), ('b', gen_random_uuid()), ('c', gen_random_uuid()), ('busy', gen_random_uuid());
create or replace function pg_temp.fx(p text) returns uuid language sql stable as $$ select id from f10r_fx where k = p $$;
create or replace function pg_temp.at_local(d date, t text) returns timestamptz language sql stable as
  $$ select (d + t::time) at time zone 'America/Toronto' $$;
-- A plan moved by whole local days, as the API resolves it.
create or replace function pg_temp.move(p_plan uuid, p_to date) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'plan_id', p.id, 'new_local_date', p_to,
    'service_date', (p_to + (p.service_date at time zone 'America/Toronto')::time) at time zone 'America/Toronto',
    'times', coalesce((select jsonb_agg(jsonb_build_object(
      'id', t.id,
      'starts_at', ((t.starts_at at time zone 'America/Toronto') + (p_to - (p.service_date at time zone 'America/Toronto')::date) * interval '1 day') at time zone 'America/Toronto',
      'ends_at', ((t.starts_at at time zone 'America/Toronto') + (p_to - (p.service_date at time zone 'America/Toronto')::date) * interval '1 day') at time zone 'America/Toronto'
                 + (t.ends_at - t.starts_at)))
      from public.plan_times t where t.plan_id = p.id), '[]'::jsonb))
  from public.plans p where p.id = p_plan
$$;

insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by) values
  (pg_temp.fx('a'), pg_temp.fx('org'), pg_temp.fx('st'), 'F10R A', pg_temp.at_local('2027-10-31', '10:00'), 'published', '22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('b'), pg_temp.fx('org'), pg_temp.fx('st'), 'F10R B', pg_temp.at_local('2027-12-05', '10:00'), 'draft', '22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('c'), pg_temp.fx('org'), pg_temp.fx('st'), 'F10R C', pg_temp.at_local('2027-12-12', '10:00'), 'draft', '22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('busy'), pg_temp.fx('org'), pg_temp.fx('st'), 'F10R busy', pg_temp.at_local('2027-11-21', '10:00'), 'draft', '22222222-2222-4222-8222-222222222222');
insert into public.plan_times (plan_id, kind, name, starts_at, ends_at, sort_order) values
  (pg_temp.fx('a'), 'rehearsal', 'Run-through', pg_temp.at_local('2027-10-30', '19:00'), pg_temp.at_local('2027-10-30', '20:30'), 0),
  (pg_temp.fx('a'), 'service', 'Service', pg_temp.at_local('2027-10-31', '10:00'), pg_temp.at_local('2027-10-31', '11:15'), 1),
  (pg_temp.fx('b'), 'service', 'Service', pg_temp.at_local('2027-12-05', '10:00'), pg_temp.at_local('2027-12-05', '11:00'), 0),
  (pg_temp.fx('busy'), 'service', 'Service', pg_temp.at_local('2027-11-21', '10:00'), pg_temp.at_local('2027-11-21', '11:00'), 0);
insert into public.plan_items (plan_id, item_type, title, sort_order) values
  (pg_temp.fx('b'), 'item', 'B welcome', 0),
  (pg_temp.fx('c'), 'header', 'C opening', 0),
  (pg_temp.fx('c'), 'item', 'C prayer', 1);
insert into public.assignments (plan_id, person_id, team_id, position_id, status, visibility, created_by) values
  (pg_temp.fx('a'), pg_temp.fx('sam'), pg_temp.fx('band'), pg_temp.fx('leader'), 'confirmed', 'released', '22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('a'), pg_temp.fx('riley'), pg_temp.fx('band'), pg_temp.fx('keys'), 'declined', 'released', '22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('a'), pg_temp.fx('morgan'), pg_temp.fx('band'), null, 'unconfirmed', 'prepared', '22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('b'), pg_temp.fx('sam'), pg_temp.fx('band'), pg_temp.fx('leader'), 'confirmed', 'released', '22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('busy'), pg_temp.fx('sam'), pg_temp.fx('band'), pg_temp.fx('keys'), 'confirmed', 'released', '22222222-2222-4222-8222-222222222222');

set local role authenticated;

set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$ begin
  perform public.preview_plan_reschedule(pg_temp.fx('org'), 'shift', jsonb_build_array(pg_temp.move(pg_temp.fx('a'), '2027-11-07')), null, false, true);
  raise exception 'a member previewed a reschedule';
exception when insufficient_privilege then null;
end $$;

set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

-- ------------------------- shift across DST, answers kept, no implicit reset
do $$
declare moves jsonb; preview jsonb; result jsonb; replay jsonb; bad jsonb; hint text; before_time uuid;
begin
  moves := jsonb_build_array(pg_temp.move(pg_temp.fx('a'), '2027-11-07'));
  bad := jsonb_set(moves, '{0,times,1,starts_at}', to_jsonb(pg_temp.at_local('2027-10-31', '10:00') + interval '7 days'));
  begin
    perform public.preview_plan_reschedule(pg_temp.fx('org'), 'shift', bad, null, false, true);
    raise exception 'fixed-offset move accepted across DST';
  exception when invalid_parameter_value then null;
  end;

  preview := public.preview_plan_reschedule(pg_temp.fx('org'), 'shift', moves, null, false, true);
  if (preview #>> '{plans,0,counts,confirmed}')::int <> 1 or (preview #>> '{plans,0,counts,declined}')::int <> 1
     or (preview #>> '{plans,0,counts,prepared}')::int <> 1 or (preview #>> '{plans,0,counts,responses_reset}')::int <> 0 then
    raise exception 'unexpected counts: %', preview #> '{plans,0,counts}';
  end if;
  if (select service_date from public.plans where id = pg_temp.fx('a')) <> pg_temp.at_local('2027-10-31', '10:00') then
    raise exception 'preview moved the plan';
  end if;
  select id into before_time from public.plan_times where plan_id = pg_temp.fx('a') and kind = 'service';

  result := public.reschedule_plans(pg_temp.fx('org'), 'shift', preview ->> 'preview_hash', 'f10r-shift-1', moves, null, false, true, null);
  replay := public.reschedule_plans(pg_temp.fx('org'), 'shift', preview ->> 'preview_hash', 'f10r-shift-1', moves, null, false, true, null);
  if not (replay ->> 'replayed')::boolean or replay ->> 'operation_id' <> result ->> 'operation_id' then
    raise exception 'replay did not return the first operation';
  end if;
  if (select to_char(service_date at time zone 'America/Toronto', 'YYYY-MM-DD HH24:MI') from public.plans where id = pg_temp.fx('a')) <> '2027-11-07 10:00' then
    raise exception 'service did not keep 10:00 local across DST';
  end if;
  if (select to_char(starts_at at time zone 'America/Toronto', 'YYYY-MM-DD HH24:MI') from public.plan_times where id = before_time) <> '2027-11-07 10:00' then
    raise exception 'time identity or wall clock not kept';
  end if;
  if (select to_char(starts_at at time zone 'America/Toronto', 'YYYY-MM-DD HH24:MI') from public.plan_times where plan_id = pg_temp.fx('a') and kind = 'rehearsal') <> '2027-11-06 19:00' then
    raise exception 'rehearsal did not move with the plan';
  end if;
  if (select status from public.assignments where plan_id = pg_temp.fx('a') and person_id = pg_temp.fx('sam')) <> 'confirmed'
     or (select status from public.assignments where plan_id = pg_temp.fx('a') and person_id = pg_temp.fx('riley')) <> 'declined' then
    raise exception 'answers were reset implicitly';
  end if;
  if (select visibility from public.assignments where plan_id = pg_temp.fx('a') and person_id = pg_temp.fx('morgan')) <> 'prepared' then
    raise exception 'a prepared request was released by the move';
  end if;
  begin
    perform public.reschedule_plans(pg_temp.fx('org'), 'shift', preview ->> 'preview_hash', 'f10r-shift-1',
      jsonb_build_array(pg_temp.move(pg_temp.fx('a'), '2027-11-14')), null, false, true, null);
    raise exception 'reused key accepted';
  exception when sqlstate 'PT409' then get stacked diagnostics hint = pg_exception_hint;
  end;
  if hint <> 'idempotency_key_reused' then raise exception 'expected idempotency_key_reused, got %', hint; end if;
end $$;

-- ------------------------------------------------- stale review refused ---
do $$
declare moves jsonb; preview jsonb; hint text;
begin
  moves := jsonb_build_array(pg_temp.move(pg_temp.fx('a'), '2027-11-14'));
  preview := public.preview_plan_reschedule(pg_temp.fx('org'), 'shift', moves, null, true, true);
  insert into public.plan_items (plan_id, item_type, title, sort_order) values (pg_temp.fx('a'), 'item', 'Late edit', 9);
  begin
    perform public.reschedule_plans(pg_temp.fx('org'), 'shift', preview ->> 'preview_hash', 'f10r-stale', moves, null, true, true, null);
    raise exception 'stale reschedule applied';
  exception when sqlstate 'PT409' then get stacked diagnostics hint = pg_exception_hint;
  end;
  if hint <> 'template_preview_changed' then raise exception 'expected template_preview_changed, got %', hint; end if;
end $$;

-- ----- forced rollback: a failure on the second plan undoes the first --
reset role;
create function pg_temp.explode() returns trigger language plpgsql as $$
begin
  if new.title = 'F10R busy' then raise exception 'forced failure' using errcode = 'XX000'; end if;
  return new;
end $$;
create trigger f10r_explode before update of service_date on public.plans
  for each row execute function pg_temp.explode();
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
declare moves jsonb; preview jsonb;
begin
  -- Sam already serves on "busy" on 2027-11-21 at 10:00: a warning, not a refusal.
  moves := jsonb_build_array(pg_temp.move(pg_temp.fx('a'), '2027-11-21'), pg_temp.move(pg_temp.fx('busy'), '2027-11-28'));
  preview := public.preview_plan_reschedule(pg_temp.fx('org'), 'shift', moves, null, true, true);
  if (preview #>> '{plans,0,counts,responses_reset}')::int <> 2 then raise exception 'reset count not previewed'; end if;
  if not exists (select 1 from jsonb_array_elements(preview #> '{plans,0,warnings}') w where w ->> 'code' = 'conflicts')
     or preview #>> '{plans,0,conflicts,0,plan_title}' <> 'F10R busy' then
    raise exception 'overlap not shown: %', preview #> '{plans,0}';
  end if;
  -- i18n: the count behind the sentence travels as a parameter.
  if not exists (select 1 from jsonb_array_elements(preview #> '{plans,0,warnings}') w
                  where w ->> 'code' = 'conflicts' and (w #>> '{params,count}')::int >= 1) then
    raise exception 'conflicts notice has no count param: %', preview #> '{plans,0,warnings}';
  end if;
  begin
    perform public.reschedule_plans(pg_temp.fx('org'), 'shift', preview ->> 'preview_hash', 'f10r-rollback', moves, null, true, true, null);
    raise exception 'failing batch applied';
  exception when internal_error then null;
  end;
  if (select to_char(service_date at time zone 'America/Toronto', 'YYYY-MM-DD') from public.plans where id = pg_temp.fx('a')) <> '2027-11-07'
     or (select status from public.assignments where plan_id = pg_temp.fx('a') and person_id = pg_temp.fx('sam')) <> 'confirmed'
     or exists (select 1 from public.plan_reschedule_operations where idempotency_key = 'f10r-rollback') then
    raise exception 'failed batch left partial changes';
  end if;
end $$;
reset role;
drop trigger f10r_explode on public.plans;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

-- ------------------------------------------ explicit reset is audited -----
do $$
declare moves jsonb; preview jsonb; result jsonb;
begin
  moves := jsonb_build_array(pg_temp.move(pg_temp.fx('a'), '2027-11-14'));
  preview := public.preview_plan_reschedule(pg_temp.fx('org'), 'shift', moves, null, true, false);
  if not exists (select 1 from jsonb_array_elements(preview #> '{plans,0,warnings}') w where w ->> 'code' = 'reset_silent') then
    raise exception 'silent reset not warned';
  end if;
  result := public.reschedule_plans(pg_temp.fx('org'), 'shift', preview ->> 'preview_hash', 'f10r-reset', moves, null, true, false, null);
  if (result ->> 'responses_reset')::int <> 2 then raise exception 'reset count %', result ->> 'responses_reset'; end if;
  if exists (select 1 from public.assignments where plan_id = pg_temp.fx('a') and visibility = 'released' and status <> 'unconfirmed') then
    raise exception 'released answers not reset';
  end if;
  if (select count(*) from public.assignment_responses r
       join public.assignments a on a.id = r.assignment_id
      where a.plan_id = pg_temp.fx('a') and r.status = 'unconfirmed'
        and r.actor_id = '22222222-2222-4222-8222-222222222222'
        and r.response_note = 'Reset because the plan was rescheduled') <> 2 then
    raise exception 'reset not recorded in response history';
  end if;
end $$;

-- ------------------------------ order only: rosters and answers untouched --
do $$
declare ord jsonb; preview jsonb; result jsonb;
begin
  ord := jsonb_build_object('source_plan_id', pg_temp.fx('c'), 'destination_plan_id', pg_temp.fx('b'),
                            'items_mode', 'append', 'remove_from_source', true);
  begin
    perform public.preview_plan_reschedule(pg_temp.fx('org'), 'order_only', null, ord, true, true);
    raise exception 'order-only accepted a reset';
  exception when invalid_parameter_value then null;
  end;
  preview := public.preview_plan_reschedule(pg_temp.fx('org'), 'order_only', null, ord, false, true);
  if (preview #>> '{destination,roster_kept,confirmed}')::int <> 1 or (preview #>> '{destination,items_kept}')::int <> 1 then
    raise exception 'unexpected order preview: %', preview;
  end if;
  result := public.reschedule_plans(pg_temp.fx('org'), 'order_only', preview ->> 'preview_hash', 'f10r-order', null, ord, false, true, null);
  if (select string_agg(title, '|' order by sort_order) from public.plan_items where plan_id = pg_temp.fx('b')) <> 'B welcome|C opening|C prayer' then
    raise exception 'order not appended to the destination';
  end if;
  if exists (select 1 from public.plan_items where plan_id = pg_temp.fx('c')) then
    raise exception 'source kept its order';
  end if;
  if (select status from public.assignments where plan_id = pg_temp.fx('b')) <> 'confirmed'
     or (select to_char(service_date at time zone 'America/Toronto', 'YYYY-MM-DD') from public.plans where id = pg_temp.fx('b')) <> '2027-12-05' then
    raise exception 'order-only move changed the roster or the date';
  end if;
end $$;

rollback;
