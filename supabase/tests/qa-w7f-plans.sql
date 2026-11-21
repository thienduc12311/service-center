-- QA wave 7 fix-up: plans track. Everything rolls back.
--   A. W7-NAT-D2 plans.service_date follows the earliest service time on
--      insert / update / delete of times, in the same transaction; a failure
--      rolls both back; no extra content_revision bump; rehearsal-only and
--      no-time plans keep their date.
--   B. W2-RESP-D4 assignment_snapshot_state agrees with respond_via_assignment_link:
--      a request the state call calls current is accepted, one it calls stale
--      or expired is refused.
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/qa-w7f-plans.sql
begin;

create temporary table wf_fx (k text primary key, id uuid) on commit drop;
grant select on wf_fx to authenticated, service_role;
insert into wf_fx select k, gen_random_uuid() from unnest(array[
  'org','owner','member','team','plan','rplan','eplan','plan2','plan3','assignment','assignment2','assignment3','n1','n2','n3'
]) k;
create or replace function pg_temp.fx(p text) returns uuid language sql stable as $$ select id from wf_fx where k = p $$;
create or replace function pg_temp.assert(p_ok boolean, p_label text) returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FAILED: %', p_label; end if; end $$;
create or replace function pg_temp.sd(p text) returns timestamptz language sql stable as
  $$ select service_date from public.plans where id = pg_temp.fx(p) $$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.fx(k), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'wf.' || k || '@example.test', 'x', now(), '{"provider":"email","providers":["email"]}',
       json_build_object('full_name', 'WF ' || initcap(k))::jsonb, now(), now()
  from unnest(array['owner','member']) k;
insert into public.organizations (id, name, slug, timezone)
values (pg_temp.fx('org'), 'WF Church', 'wf-church-' || left(pg_temp.fx('org')::text, 8), 'America/Toronto');
insert into public.organization_members (organization_id, user_id, role, status) values
  (pg_temp.fx('org'), pg_temp.fx('owner'), 'owner', 'active'),
  (pg_temp.fx('org'), pg_temp.fx('member'), 'member', 'active');
insert into public.teams (id, organization_id, name) values (pg_temp.fx('team'), pg_temp.fx('org'), 'WF Band');

insert into public.plans (id, organization_id, title, service_date, status, created_by)
select pg_temp.fx(k), pg_temp.fx('org'), 'WF ' || k, timestamptz '2030-01-10 12:00+00', 'published', pg_temp.fx('owner')
  from unnest(array['plan','rplan','eplan','plan2','plan3']) k;

-- ============================== A. service_date follows service times
select pg_temp.assert(pg_temp.sd('eplan') = '2030-01-10 12:00+00', 'A0 no-time plan keeps date');

insert into public.plan_times (plan_id, kind, name, starts_at, ends_at) values
  (pg_temp.fx('plan'), 'service', 'Late', '2030-01-12 15:00+00', '2030-01-12 16:00+00'),
  (pg_temp.fx('plan'), 'service', 'Early', '2030-01-12 09:00+00', '2030-01-12 10:00+00'),
  (pg_temp.fx('plan'), 'rehearsal', 'Rehearse', '2030-01-11 09:00+00', '2030-01-11 10:00+00');
select pg_temp.assert(pg_temp.sd('plan') = '2030-01-12 09:00+00', 'A1 insert sets earliest service time');

insert into public.plan_times (plan_id, kind, name, starts_at, ends_at)
values (pg_temp.fx('rplan'), 'rehearsal', 'Only rehearsal', '2030-01-01 09:00+00', '2030-01-01 10:00+00');
select pg_temp.assert(pg_temp.sd('rplan') = '2030-01-10 12:00+00', 'A2 rehearsal-only keeps date');

update public.plan_times set starts_at = '2030-01-12 18:00+00', ends_at = '2030-01-12 19:00+00'
 where plan_id = pg_temp.fx('plan') and name = 'Early';
select pg_temp.assert(pg_temp.sd('plan') = '2030-01-12 15:00+00', 'A3 update follows');

delete from public.plan_times where plan_id = pg_temp.fx('plan') and name = 'Late';
select pg_temp.assert(pg_temp.sd('plan') = '2030-01-12 18:00+00', 'A4 delete follows');

delete from public.plan_times where plan_id = pg_temp.fx('plan') and kind = 'service';
select pg_temp.assert(pg_temp.sd('plan') = '2030-01-12 18:00+00', 'A5 no service time left keeps date');

-- A6 the RPC path moves the date in the same call; the date update adds no
-- content_revision bump of its own.
do $$
declare
  v_before bigint; v_after bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.fx('owner'), 'role', 'authenticated')::text, true);
  select content_revision into v_before from public.plans where id = pg_temp.fx('plan2');
  set local role authenticated;
  perform public.replace_plan_times(pg_temp.fx('plan2'), jsonb_build_array(
    jsonb_build_object('id',gen_random_uuid(),'kind','service','name','S','starts_at','2030-02-02T10:00:00Z','ends_at','2030-02-02T11:00:00Z')), null);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  select content_revision into v_after from public.plans where id = pg_temp.fx('plan2');
  perform pg_temp.assert(pg_temp.sd('plan2') = '2030-02-02 10:00+00', 'A6 RPC moves service_date');
  perform pg_temp.assert(v_after - v_before = 1, 'A6 one revision bump for one inserted time (got ' || (v_after - v_before) || ')');
end $$;

-- A7 atomic: a failing time write leaves date and times untouched.
do $$
begin
  begin
    insert into public.plan_times (plan_id, kind, name, starts_at, ends_at) values
      (pg_temp.fx('plan3'), 'service', 'Good', '2030-01-05 09:00+00', '2030-01-05 10:00+00'),
      (pg_temp.fx('plan3'), 'service', 'Bad', '2030-01-05 12:00+00', '2030-01-05 11:00+00');
    raise exception 'A7 expected a check violation';
  exception when check_violation then null;
  end;
  perform pg_temp.assert(pg_temp.sd('plan3') = '2030-01-10 12:00+00', 'A7 failed write leaves the date');
  perform pg_temp.assert(not exists (select 1 from public.plan_times where plan_id = pg_temp.fx('plan3')), 'A7 failed write leaves no times');
end $$;

-- ============================== B. preview and respond agree
create or replace function pg_temp.mk_request(p_k text, p_plan text, p_asg text, p_hash text)
returns uuid language plpgsql as $$
declare v_snap uuid := gen_random_uuid(); v_person uuid;
begin
  select id into v_person from public.people where organization_id = pg_temp.fx('org') and profile_id = pg_temp.fx('member');
  insert into public.assignments (id, plan_id, person_id, user_id, team_id, status, visibility, released_at, released_by, response_owner_id, created_by)
  values (pg_temp.fx(p_asg), pg_temp.fx(p_plan), v_person, pg_temp.fx('member'), pg_temp.fx('team'), 'unconfirmed', 'released', now(),
          pg_temp.fx('owner'), pg_temp.fx('owner'), pg_temp.fx('owner'));
  insert into public.assignment_request_snapshots (id, organization_id, person_id, plan_id, version, expires_at, created_at)
  values (v_snap, pg_temp.fx('org'), v_person, pg_temp.fx(p_plan), 1, now() + interval '1 day', now() - interval '1 minute');
  insert into public.assignment_request_snapshot_items (snapshot_id, assignment_id, expected_request_revision, expected_status, plan_time_ids)
  select v_snap, a.id, a.request_revision, a.status, private.assignment_time_ids(a.id) from public.assignments a where a.id = pg_temp.fx(p_asg);
  insert into public.assignment_notifications (id, organization_id, plan_id, user_id, email, token_hash, expires_at, person_id, snapshot_id)
  values (pg_temp.fx(p_k), pg_temp.fx('org'), pg_temp.fx(p_plan), pg_temp.fx('member'), 'wf.member@example.test', p_hash, now() + interval '1 day', v_person, v_snap);
  return v_snap;
end $$;

insert into public.plan_times (plan_id, kind, name, starts_at, ends_at)
values (pg_temp.fx('plan3'), 'service', 'S3', '2030-03-03 10:00+00', '2030-03-03 11:00+00');

do $$
declare v_snap uuid; v_out text;
begin
  -- B1 current: state says current, respond accepts.
  v_snap := pg_temp.mk_request('n1', 'plan2', 'assignment', 'wf-token-1');
  perform pg_temp.assert(public.assignment_snapshot_state(v_snap) = 'current', 'B1 current');
  select outcome into v_out from public.respond_via_assignment_link('wf-token-1', 'confirmed');
  perform pg_temp.assert(v_out = 'ok', 'B1 respond ok (got ' || v_out || ')');

  -- B2 a time added after the request went out: both call it stale.
  v_snap := pg_temp.mk_request('n2', 'plan3', 'assignment2', 'wf-token-2');
  perform pg_temp.assert(public.assignment_snapshot_state(v_snap) = 'current', 'B2 current before edit');
  insert into public.plan_times (plan_id, kind, name, starts_at, ends_at)
  values (pg_temp.fx('plan3'), 'rehearsal', 'Added', '2030-03-02 10:00+00', '2030-03-02 11:00+00');
  perform pg_temp.assert(public.assignment_snapshot_state(v_snap) = 'stale', 'B2 stale after time added');
  select outcome into v_out from public.respond_via_assignment_link('wf-token-2', 'confirmed');
  perform pg_temp.assert(v_out = 'stale', 'B2 respond stale (got ' || v_out || ')');

  -- B3 expired snapshot: both refuse.
  delete from public.assignment_notifications where id = pg_temp.fx('n2');
  delete from public.assignments where id = pg_temp.fx('assignment2');
  v_snap := pg_temp.mk_request('n3', 'eplan', 'assignment3', 'wf-token-3');
  update public.assignment_request_snapshots set expires_at = now() - interval '1 second', created_at = now() - interval '2 days' where id = v_snap;
  perform pg_temp.assert(public.assignment_snapshot_state(v_snap) = 'expired', 'B3 expired');
  select outcome into v_out from public.respond_via_assignment_link('wf-token-3', 'confirmed');
  perform pg_temp.assert(v_out = 'expired', 'B3 respond expired (got ' || v_out || ')');

  perform pg_temp.assert(public.assignment_snapshot_state(gen_random_uuid()) = 'stale', 'B4 unknown is stale');
end $$;

select 'qa-w7f-plans: all assertions passed' as result;
rollback;
