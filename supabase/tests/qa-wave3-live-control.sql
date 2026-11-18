-- W3-LIVE-D1: vacant/expired leases reject commands without mutating history.
-- docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/qa-wave3-live-control.sql
begin;

create temporary table w3_live_fx (k text primary key, id uuid) on commit drop;
grant select, insert on w3_live_fx to authenticated;
insert into w3_live_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('st', 'bbbbbbbb-0000-4000-8000-000000000001'),
  ('plan', gen_random_uuid()), ('time', gen_random_uuid());
create function pg_temp.fx(p text) returns uuid language sql stable as
  $$ select id from w3_live_fx where k = p $$;

insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by)
values (pg_temp.fx('plan'), pg_temp.fx('org'), pg_temp.fx('st'), 'W3 Live control',
  '2027-05-02 14:00+00', 'published', '22222222-2222-4222-8222-222222222222');
insert into public.plan_times (id, plan_id, kind, starts_at, ends_at)
values (pg_temp.fx('time'), pg_temp.fx('plan'), 'service', '2027-05-02 13:00+00', '2027-05-02 14:00+00');
insert into public.plan_items (plan_id, item_type, title, length_seconds, sort_order) values
  (pg_temp.fx('plan'), 'item', 'First', 60, 0),
  (pg_temp.fx('plan'), 'item', 'Second', 60, 1);

create function pg_temp.reject_commands(p_run uuid, p_actions text[], p_hint text)
returns void language plpgsql as $$
declare
  v_before jsonb;
  v_history bigint;
  v_action text;
  v_state text;
  v_hint text;
begin
  select to_jsonb(r) into v_before from public.live_runs r where id = p_run;
  select count(*) into v_history from public.live_run_transitions where run_id = p_run;
  foreach v_action in array p_actions loop
    begin
      perform public.live_run_action(p_run, v_action, (v_before->>'revision')::bigint,
        'tab-a', 'rejected-' || v_action, 1, 'Regression test', 'service_end');
      raise exception 'FAIL: % on % run with no valid lease succeeded', v_action, v_before->>'status';
    exception when sqlstate 'PT409' then
      get stacked diagnostics v_hint = pg_exception_hint, v_state = returned_sqlstate;
      if v_hint is distinct from p_hint then
        raise exception 'FAIL: % expected % but got %/%', v_action, p_hint, v_state, v_hint;
      end if;
    end;
    if (select to_jsonb(r) from public.live_runs r where id = p_run) is distinct from v_before
       or (select count(*) from public.live_run_transitions where run_id = p_run) <> v_history then
      raise exception 'FAIL: rejected % changed run state or history', v_action;
    end if;
  end loop;
end $$;

set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
declare r jsonb;
begin
  r := public.create_live_run(pg_temp.fx('plan'), pg_temp.fx('time'), 'item', 'w3-live', 'tab-a');
  insert into w3_live_fx values ('run', (r->'run'->>'id')::uuid);
  perform public.live_run_action(pg_temp.fx('run'), 'release_control', 1, 'tab-a', 'release-ready');
end $$;

-- Former controller and a different plan editor must both take control first.
select pg_temp.reject_commands(pg_temp.fx('run'),
  array['start', 'set_policy', 'refresh_snapshot', 'release_control', 'renew'], 'run_control_lost');
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
select pg_temp.reject_commands(pg_temp.fx('run'),
  array['start', 'set_policy', 'refresh_snapshot', 'release_control', 'renew'], 'run_control_lost');
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

do $$
declare r jsonb;
begin
  r := public.live_run_action(pg_temp.fx('run'), 'take_control', 2, 'tab-a', 'take-ready');
  r := public.live_run_action(pg_temp.fx('run'), 'set_policy', (r->'run'->>'revision')::bigint,
    'tab-a', 'policy-ready', null, null, 'service_end');
  if r->'run'->>'countdown_policy' <> 'service_end' then raise exception 'FAIL: held policy change'; end if;
  r := public.live_run_action(pg_temp.fx('run'), 'start', (r->'run'->>'revision')::bigint, 'tab-a', 'start');
  perform public.live_run_action(pg_temp.fx('run'), 'release_control', (r->'run'->>'revision')::bigint, 'tab-a', 'release-live');
end $$;
select pg_temp.reject_commands(pg_temp.fx('run'),
  array['pause', 'advance', 'jump', 'end', 'discard', 'set_policy', 'release_control', 'renew'], 'run_control_lost');

do $$
declare r jsonb;
begin
  r := public.live_run_action(pg_temp.fx('run'), 'take_control',
    (select revision from public.live_runs where id = pg_temp.fx('run')), 'tab-a', 'take-live');
  r := public.live_run_action(pg_temp.fx('run'), 'pause', (r->'run'->>'revision')::bigint, 'tab-a', 'pause');
  perform public.live_run_action(pg_temp.fx('run'), 'release_control', (r->'run'->>'revision')::bigint, 'tab-a', 'release-paused');
end $$;
select pg_temp.reject_commands(pg_temp.fx('run'),
  array['resume', 'advance', 'jump', 'end', 'discard', 'set_policy', 'release_control', 'renew'], 'run_control_lost');

-- Expiration must still refuse a matching user/client, and permit reacquisition.
do $$ begin
  perform public.live_run_action(pg_temp.fx('run'), 'take_control',
    (select revision from public.live_runs where id = pg_temp.fx('run')), 'tab-a', 'take-paused');
end $$;
reset role;
update public.live_runs set controller_lease_expires_at = now() - interval '1 second' where id = pg_temp.fx('run');
set local role authenticated;
select pg_temp.reject_commands(pg_temp.fx('run'), array['resume', 'end', 'discard', 'renew'], 'run_control_lost');
do $$
declare r jsonb;
begin
  r := public.live_run_action(pg_temp.fx('run'), 'take_control',
    (select revision from public.live_runs where id = pg_temp.fx('run')), 'tab-a', 'retake-expired');
  r := public.live_run_action(pg_temp.fx('run'), 'resume', (r->'run'->>'revision')::bigint, 'tab-a', 'resume');
  r := public.live_run_action(pg_temp.fx('run'), 'end', (r->'run'->>'revision')::bigint, 'tab-a', 'end');
  -- Previously accepted command IDs still replay after ending.
  r := public.live_run_action(pg_temp.fx('run'), 'end', (r->'run'->>'revision')::bigint - 1, 'tab-a', 'end');
  if not (r->>'replayed')::boolean then raise exception 'FAIL: ended command replay'; end if;
end $$;
select pg_temp.reject_commands(pg_temp.fx('run'), array['set_policy', 'release_control'], 'run_state');
select pg_temp.reject_commands(pg_temp.fx('run'), array['renew', 'end'], 'run_control_lost');

-- Discarding an ended run remains an audited editor operation.
do $$ begin
  perform public.live_run_action(pg_temp.fx('run'), 'discard',
    (select revision from public.live_runs where id = pg_temp.fx('run')), 'tab-a', 'discard-ended', null, 'Regression test');
end $$;
select pg_temp.reject_commands(pg_temp.fx('run'), array['set_policy', 'release_control'], 'run_state');
select pg_temp.reject_commands(pg_temp.fx('run'), array['renew'], 'run_control_lost');

select 'qa-wave3-live-control: all checks passed' as result;
rollback;
