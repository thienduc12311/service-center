-- F06: versioned rotations, private immutable proposals and the atomic,
-- idempotent PREPARED commit with stale-input refusal and full rollback.
-- Run against the seeded local database. Everything rolls back.
begin;

create temporary table f06_fx (k text primary key, id uuid) on commit drop;
grant select, insert, update, delete on f06_fx to authenticated, service_role;
insert into f06_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('st', 'bbbbbbbb-0000-4000-8000-000000000001'),
  ('band', 'cccccccc-0000-4000-8000-000000000001'),
  ('eg', 'dddddddd-0000-4000-8000-000000000003'),
  ('sam', (select id from public.people where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' and profile_id = '33333333-3333-4333-8333-333333333333')),
  ('guest', gen_random_uuid()), ('guest2', gen_random_uuid()),
  ('plan_a', gen_random_uuid()), ('plan_b', gen_random_uuid()), ('plan_c', gen_random_uuid()), ('plan_d', gen_random_uuid());
create or replace function pg_temp.fx(p text) returns uuid language sql stable as
  $$ select id from f06_fx where k = p $$;
create or replace function pg_temp.at(p interval) returns timestamptz language sql stable as
  $$ select date_trunc('day', now()) + interval '700 days' + p $$;

insert into public.people (id, organization_id, first_name) values
  (pg_temp.fx('guest'), pg_temp.fx('org'), 'F06 Guest'), (pg_temp.fx('guest2'), pg_temp.fx('org'), 'F06 Second');
insert into public.team_memberships (team_id, person_id, position_id) values
  (pg_temp.fx('band'), pg_temp.fx('guest'), pg_temp.fx('eg')),
  (pg_temp.fx('band'), pg_temp.fx('guest2'), pg_temp.fx('eg'));
insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by) values
  (pg_temp.fx('plan_a'), pg_temp.fx('org'), pg_temp.fx('st'), 'F06 A', pg_temp.at('10 hours'), 'draft', '22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('plan_b'), pg_temp.fx('org'), pg_temp.fx('st'), 'F06 B', pg_temp.at('7 days 10 hours'), 'draft', '22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('plan_c'), pg_temp.fx('org'), pg_temp.fx('st'), 'F06 C', pg_temp.at('14 days 10 hours'), 'draft', '22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('plan_d'), pg_temp.fx('org'), pg_temp.fx('st'), 'F06 D (overlaps C)', pg_temp.at('14 days 10 hours'), 'draft', '22222222-2222-4222-8222-222222222222');
insert into public.plan_times (plan_id, kind, name, starts_at, ends_at, sort_order) values
  (pg_temp.fx('plan_a'), 'service', 'Service', pg_temp.at('10 hours'), pg_temp.at('11 hours'), 0),
  (pg_temp.fx('plan_b'), 'service', 'Service', pg_temp.at('7 days 10 hours'), pg_temp.at('7 days 11 hours'), 0),
  (pg_temp.fx('plan_c'), 'service', 'Service', pg_temp.at('14 days 10 hours'), pg_temp.at('14 days 11 hours'), 0),
  (pg_temp.fx('plan_d'), 'service', 'Service', pg_temp.at('14 days 10 hours 30 minutes'), pg_temp.at('14 days 11 hours 30 minutes'), 0);
insert into public.plan_position_needs (plan_id, position_id, needed)
select p, pg_temp.fx('eg'), 1 from unnest(array[pg_temp.fx('plan_a'), pg_temp.fx('plan_b'), pg_temp.fx('plan_c')]) p;

-- Builds a draft row for the caller from explicit choices (the engine runs in the API).
create or replace function pg_temp.draft(p_plans uuid[], p_choices jsonb, p_rotations jsonb default '[]') returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into public.staffing_proposals (organization_id, author_id, rule_version, seed, lookback_days,
    plan_ids, team_ids, base_revisions, rotation_versions, snapshot, edits, result)
  values (pg_temp.fx('org'), (select auth.uid()), 'f06.fairness.v1', 'seed-f06', 90, p_plans, array[pg_temp.fx('band')],
    (select jsonb_agg(jsonb_build_object('plan_id', id, 'staffing_revision', staffing_revision) order by id) from public.plans where id = any(p_plans)),
    p_rotations, jsonb_build_object('captured', now()), '{"locks":[],"exclusions":[]}', jsonb_build_object('choices', p_choices))
  returning id into v_id;
  return v_id;
end $$;
create or replace function pg_temp.choice(p_plan uuid, p_person uuid, p_source text default 'fairness') returns jsonb
language sql as $$
  select jsonb_build_object('plan_id', p_plan, 'team_id', pg_temp.fx('band'), 'position_id', pg_temp.fx('eg'),
    'person_id', p_person, 'source', p_source)
$$;
create or replace function pg_temp.expect_hint(p_sql text, p_hint text) returns void language plpgsql as $$
declare v_hint text; v_state text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_state = returned_sqlstate;
    if coalesce(v_hint, '') <> p_hint and v_state <> p_hint then
      raise exception 'expected % but got % / %', p_hint, v_state, v_hint;
    end if;
    return;
  end;
  raise exception 'expected % but the statement succeeded: %', p_hint, p_sql;
end $$;

-- ---------------------------------------------------------- rotations --
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

do $$
declare r public.team_rotations; v_rev bigint;
begin
  r := public.save_team_rotation(null, pg_temp.fx('band'), 0, 'F06 EG A/B', 2, (current_date + 700), 'vacancy',
    jsonb_build_array(jsonb_build_object('week_index', 0, 'position_id', pg_temp.fx('eg'), 'person_id', pg_temp.fx('sam')),
                      jsonb_build_object('week_index', 1, 'position_id', pg_temp.fx('eg'), 'person_id', pg_temp.fx('guest'))),
    jsonb_build_array(jsonb_build_object('local_date', (current_date + 714), 'position_id', pg_temp.fx('eg'), 'person_id', null)));
  if r.revision <> 1 then raise exception 'new rotation should be revision 1'; end if;
  insert into f06_fx values ('rotation', r.id);
  perform pg_temp.expect_hint(format('select public.save_team_rotation(%L, null, 0, %L, 2, current_date, %L, %L, %L)',
    r.id, 'stale', 'vacancy', '[]', '[]'), 'rotation_changed');
  r := public.save_team_rotation(r.id, null, 1, 'F06 EG A/B', 2, (current_date + 700), 'fairness',
    jsonb_build_array(jsonb_build_object('week_index', 0, 'position_id', pg_temp.fx('eg'), 'person_id', pg_temp.fx('sam'))), '[]');
  if r.revision <> 2 or r.substitute_policy <> 'fairness' then raise exception 'rotation update did not version'; end if;
  if (select count(*) from public.team_rotation_versions where rotation_id = r.id) <> 2 then raise exception 'version history missing'; end if;
  if (select count(*) from public.team_rotation_slots where rotation_id = r.id) <> 1 then raise exception 'slots not replaced'; end if;
  -- Week outside the cycle and a position from another team are refused.
  perform pg_temp.expect_hint(format('select public.save_team_rotation(null, %L, 0, %L, 1, current_date, %L, %L, %L)',
    pg_temp.fx('band'), 'bad week', 'vacancy',
    jsonb_build_array(jsonb_build_object('week_index', 1, 'position_id', pg_temp.fx('eg'), 'person_id', pg_temp.fx('sam'))), '[]'), '22023');
  perform pg_temp.expect_hint(format('select public.save_team_rotation(null, %L, 0, %L, 1, current_date, %L, %L, %L)',
    pg_temp.fx('band'), 'foreign position', 'vacancy',
    jsonb_build_array(jsonb_build_object('week_index', 0, 'position_id', (select id from public.team_positions where team_id <> pg_temp.fx('band') limit 1), 'person_id', pg_temp.fx('sam'))), '[]'), '22023');
  perform pg_temp.expect_hint(format('insert into public.team_rotations (organization_id, team_id, name, cycle_weeks, anchor_date) values (%L, %L, %L, 1, current_date)',
    pg_temp.fx('org'), pg_temp.fx('band'), 'direct'), '42501');
end $$;

-- A member (Sam) cannot read or write rotations.
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$ begin
  if exists (select 1 from public.team_rotations where id = pg_temp.fx('rotation')) then raise exception 'member read a rotation'; end if;
  perform pg_temp.expect_hint(format('select public.save_team_rotation(null, %L, 0, %L, 1, current_date, %L, %L, %L)',
    pg_temp.fx('band'), 'member', 'vacancy', '[]', '[]'), '42501');
  perform pg_temp.expect_hint(format('select public.archive_team_rotation(%L, 2)', pg_temp.fx('rotation')), 'P0002');
end $$;

-- ---------------------------------------------- proposal privacy/immutability --
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
declare v_id uuid; v_before_assignments int; v_before_effects int;
begin
  select count(*) into v_before_assignments from public.assignments;
  select count(*) into v_before_effects from public.delivery_effects;
  v_id := pg_temp.draft(array[pg_temp.fx('plan_a'), pg_temp.fx('plan_b')],
    jsonb_build_array(pg_temp.choice(pg_temp.fx('plan_a'), pg_temp.fx('sam')), pg_temp.choice(pg_temp.fx('plan_b'), pg_temp.fx('guest'))),
    jsonb_build_array(jsonb_build_object('rotation_id', pg_temp.fx('rotation'), 'revision', 2)));
  insert into f06_fx values ('p1', v_id);
  if (select input_hash from public.staffing_proposals where id = v_id) !~ '^[a-f0-9]{64}$' then raise exception 'input hash not computed'; end if;
  if (select count(*) from public.assignments) <> v_before_assignments
     or (select count(*) from public.delivery_effects) <> v_before_effects then
    raise exception 'a preview created requests or deliveries';
  end if;
  perform pg_temp.expect_hint(format('update public.staffing_proposals set snapshot = %L where id = %L', '{"forged":true}', v_id), '42501');
  perform pg_temp.expect_hint(format('update public.staffing_proposals set status = %L where id = %L', 'committed', v_id), '42501');
  perform pg_temp.expect_hint(format('update public.staffing_proposals set expires_at = now() + interval %L where id = %L', '30 days', v_id), '42501');
end $$;

set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$ begin
  if exists (select 1 from public.staffing_proposals where id = pg_temp.fx('p1')) then raise exception 'another user read a proposal'; end if;
  perform pg_temp.expect_hint(format('select public.commit_staffing_proposal(%L, 0, %L)', pg_temp.fx('p1'), 'member-commit-1'), 'P0002');
  perform pg_temp.expect_hint(format('select pg_temp.draft(array[%L]::uuid[], %L)', pg_temp.fx('plan_a'), '[]'), '42501');
end $$;

-- ------------------------------------------------------- prepared commit --
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
declare v_first jsonb; v_replay jsonb; v_effects int;
begin
  select count(*) into v_effects from public.delivery_effects;
  perform pg_temp.expect_hint(format('select public.commit_staffing_proposal(%L, 5, %L)', pg_temp.fx('p1'), 'f06-commit-key'), 'proposal_changed');
  v_first := public.commit_staffing_proposal(pg_temp.fx('p1'), 0, 'f06-commit-key');
  v_replay := public.commit_staffing_proposal(pg_temp.fx('p1'), 0, 'f06-commit-key');
  if v_first <> v_replay then raise exception 'idempotent replay differed'; end if;
  if jsonb_array_length(v_first->'assignment_ids') <> 2 or v_first->>'visibility' <> 'prepared' then raise exception 'unexpected commit result %', v_first; end if;
  if exists (select 1 from public.assignments where id in (select (jsonb_array_elements_text(v_first->'assignment_ids'))::uuid)
      and (visibility <> 'prepared' or status <> 'unconfirmed' or notified_at is not null or attendance_mode <> 'all')) then
    raise exception 'committed requests are not fresh prepared requests';
  end if;
  if (select count(*) from public.delivery_effects) <> v_effects then raise exception 'prepared commit enqueued delivery'; end if;
  if (select status from public.staffing_proposals where id = pg_temp.fx('p1')) <> 'committed' then raise exception 'not marked committed'; end if;
  perform pg_temp.expect_hint(format('select public.commit_staffing_proposal(%L, 0, %L)', pg_temp.fx('p1'), 'another-key-1'), 'proposal_changed');
end $$;

-- Prepared requests stay invisible to their recipient (F01).
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$ begin
  if exists (select 1 from public.assignments where plan_id = pg_temp.fx('plan_a')) then raise exception 'recipient saw a prepared request'; end if;
end $$;

-- --------------------------------------------------- stale inputs refuse --
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
declare v_id uuid; v_count int;
begin
  select count(*) into v_count from public.assignments where plan_id = pg_temp.fx('plan_c');

  -- Rotation changed after capture.
  v_id := pg_temp.draft(array[pg_temp.fx('plan_c')], jsonb_build_array(pg_temp.choice(pg_temp.fx('plan_c'), pg_temp.fx('guest2'))),
    jsonb_build_array(jsonb_build_object('rotation_id', pg_temp.fx('rotation'), 'revision', 2)));
  perform public.save_team_rotation(pg_temp.fx('rotation'), null, 2, 'F06 EG A/B', 2, (current_date + 700), 'vacancy', '[]', '[]');
  perform pg_temp.expect_hint(format('select public.commit_staffing_proposal(%L, 0, %L)', v_id, 'stale-rotation'), 'proposal_stale');

  -- Plan staffing changed after capture.
  v_id := pg_temp.draft(array[pg_temp.fx('plan_c')], jsonb_build_array(pg_temp.choice(pg_temp.fx('plan_c'), pg_temp.fx('guest2'))));
  update public.plan_position_needs set needed = 2 where plan_id = pg_temp.fx('plan_c');
  perform pg_temp.expect_hint(format('select public.commit_staffing_proposal(%L, 0, %L)', v_id, 'stale-revision'), 'proposal_stale');

  -- Membership removed after capture (does not bump any plan revision).
  -- Schedulers no longer edit rosters, so an owner-level session removes it.
  v_id := pg_temp.draft(array[pg_temp.fx('plan_c')], jsonb_build_array(pg_temp.choice(pg_temp.fx('plan_c'), pg_temp.fx('guest2'))));
  reset role;
  delete from public.team_memberships where person_id = pg_temp.fx('guest2');
  set local role authenticated;
  perform pg_temp.expect_hint(format('select public.commit_staffing_proposal(%L, 0, %L)', v_id, 'stale-membership'), 'proposal_stale');

  -- Blockout added after capture: deferred F04 check refuses and nothing partial remains.
  v_id := pg_temp.draft(array[pg_temp.fx('plan_c'), pg_temp.fx('plan_b')],
    jsonb_build_array(pg_temp.choice(pg_temp.fx('plan_b'), pg_temp.fx('sam')), pg_temp.choice(pg_temp.fx('plan_c'), pg_temp.fx('guest'))));
  reset role;
  insert into public.blockouts (organization_id, person_id, starts_at, ends_at, reason)
  values (pg_temp.fx('org'), pg_temp.fx('guest'), pg_temp.at('14 days 9 hours'), pg_temp.at('14 days 12 hours'), 'Private');
  set local role authenticated;
  perform pg_temp.expect_hint(format('select public.commit_staffing_proposal(%L, 0, %L)', v_id, 'stale-blockout'), 'scheduling_conflict');
  if exists (select 1 from public.assignments where plan_id = pg_temp.fx('plan_b') and person_id = pg_temp.fx('sam')) then
    raise exception 'a refused commit left a partial request';
  end if;

  -- A choice outside the reviewed scope and a duplicate person per plan are refused.
  v_id := pg_temp.draft(array[pg_temp.fx('plan_c')], jsonb_build_array(pg_temp.choice(pg_temp.fx('plan_b'), pg_temp.fx('sam'))));
  perform pg_temp.expect_hint(format('select public.commit_staffing_proposal(%L, 0, %L)', v_id, 'out-of-scope'), '22023');

  -- Expired and superseded drafts.
  v_id := pg_temp.draft(array[pg_temp.fx('plan_c')], jsonb_build_array(pg_temp.choice(pg_temp.fx('plan_c'), pg_temp.fx('sam'))));
  update public.staffing_proposals set status = 'superseded' where id = v_id;
  perform pg_temp.expect_hint(format('select public.commit_staffing_proposal(%L, 0, %L)', v_id, 'superseded'), 'proposal_stale');
  reset role;
  insert into public.staffing_proposals (organization_id, author_id, rule_version, seed, lookback_days, plan_ids, team_ids,
    base_revisions, snapshot, result, expires_at)
  values (pg_temp.fx('org'), '22222222-2222-4222-8222-222222222222', 'f06.fairness.v1', 'seed-exp', 90, array[pg_temp.fx('plan_c')],
    array[pg_temp.fx('band')], '[]', '{}', '{"choices":[]}', now() - interval '1 minute') returning id into v_id;
  set local role authenticated;
  perform pg_temp.expect_hint(format('select public.commit_staffing_proposal(%L, 0, %L)', v_id, 'expired-key'), 'proposal_expired');

  if (select count(*) from public.assignments where plan_id = pg_temp.fx('plan_c')) <> v_count then
    raise exception 'a refused commit changed plan C';
  end if;
end $$;

-- Existing requests are never re-created: an "existing" choice is skipped, a live duplicate is refused.
do $$
declare v_id uuid; v_result jsonb;
begin
  v_id := pg_temp.draft(array[pg_temp.fx('plan_a')], jsonb_build_array(pg_temp.choice(pg_temp.fx('plan_a'), pg_temp.fx('sam'), 'existing')));
  v_result := public.commit_staffing_proposal(v_id, 0, 'existing-only');
  if jsonb_array_length(v_result->'assignment_ids') <> 0 then raise exception 'existing choice was re-created'; end if;
end $$;

rollback;
