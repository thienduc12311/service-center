-- QA wave 2 regression suite (migrations 20261119000000..300). Each section
-- fails on the schema before those migrations:
--   A. W2-AVAIL-D3  team-scoped leaders: only their team's People, reasons hidden
--   B. W2-STAFF-D1  prepared requests outside the viewer's scope still conflict (redacted)
--   C. W2-RESP-D2   no self-approval of a claim, replacement offer or swap
--   D. W2-STAFF-D2  inactive members are not schedulable candidates
-- Run against a seeded local database. Everything rolls back.
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/qa-wave2-fixes.sql
begin;

create temporary table w2_fx (k text primary key, id uuid) on commit drop;
grant select, insert, update, delete on w2_fx to authenticated, service_role;

insert into w2_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('sunday', 'bbbbbbbb-0000-4000-8000-000000000001'),
  ('band', 'cccccccc-0000-4000-8000-000000000001'),
  ('hospitality', 'cccccccc-0000-4000-8000-000000000003'),
  ('drums', 'dddddddd-0000-4000-8000-000000000005'),
  ('bass', 'dddddddd-0000-4000-8000-000000000004'),
  ('greeter', 'dddddddd-0000-4000-8000-00000000000a'),
  ('sam', (select id from public.people where profile_id='33333333-3333-4333-8333-333333333333'
            and organization_id='aaaaaaaa-0000-4000-8000-000000000001')),
  ('riley', (select id from public.people where profile_id='44444444-4444-4444-8444-444444444444'
            and organization_id='aaaaaaaa-0000-4000-8000-000000000001')),
  ('morgan', (select id from public.people where profile_id='55555555-5555-4555-8555-555555555555'
            and organization_id='aaaaaaaa-0000-4000-8000-000000000001')),
  ('sam_blockout', gen_random_uuid()), ('morgan_blockout', gen_random_uuid()),
  ('plan_a', gen_random_uuid()), ('plan_b', gen_random_uuid()), ('hidden_request', gen_random_uuid()),
  ('claim_plan', gen_random_uuid()), ('claim_opening', gen_random_uuid()),
  ('repl_plan', gen_random_uuid()), ('repl_orig', gen_random_uuid()),
  ('swap_plan_1', gen_random_uuid()), ('swap_plan_2', gen_random_uuid()),
  ('swap_riley', gen_random_uuid()), ('swap_sam', gen_random_uuid());

create or replace function pg_temp.fx(p text) returns uuid language sql stable as
  $$ select id from w2_fx where k=p $$;

-- Asserts a call fails with this SQLSTATE and (when given) this hint.
create or replace function pg_temp.expect_error(p_sql text, p_state text, p_hint text, p_label text)
returns void language plpgsql as $$
declare v_state text; v_hint text;
begin
  execute p_sql;
  raise exception '%: expected %/% but it succeeded', p_label, p_state, p_hint;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint;
  if v_state <> p_state or (p_hint is not null and v_hint is distinct from p_hint) then
    raise exception '%: expected %/% but got %/%', p_label, p_state, p_hint, v_state, v_hint;
  end if;
end $$;

-- ------------------------------------------------------------- fixtures ---
-- Riley leads Hospitality only (Morgan is on it; Sam is not). Morgan leads
-- Hospitality for section B. Both are scoped members, no org-wide role.
update public.organization_members set access_mode = 'scoped'
 where organization_id = pg_temp.fx('org') and user_id in ('44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555');
insert into public.access_grants (organization_id, user_id, capability, scope_type, team_id, created_by) values
  (pg_temp.fx('org'), '44444444-4444-4444-8444-444444444444', 'scheduling.manage', 'team', pg_temp.fx('hospitality'), '11111111-1111-4111-8111-111111111111');

insert into public.blockouts (id, organization_id, person_id, starts_at, ends_at, reason) values
  (pg_temp.fx('sam_blockout'), pg_temp.fx('org'), pg_temp.fx('sam'), now() + interval '900 days', now() + interval '900 days 3 hours', 'W2-SECRET-SAM'),
  (pg_temp.fx('morgan_blockout'), pg_temp.fx('org'), pg_temp.fx('morgan'), now() + interval '901 days', now() + interval '901 days 3 hours', 'W2-SECRET-MORGAN');

-- Two Sunday plans at the same time; Sam has a *prepared* Band request on A.
insert into public.plans(id, organization_id, service_type_id, title, service_date, status, created_by)
select pg_temp.fx(k), pg_temp.fx('org'), pg_temp.fx('sunday'), 'W2 ' || k, now() + (d || ' days')::interval, 'published', '22222222-2222-4222-8222-222222222222'
  from (values ('plan_a', 910), ('plan_b', 910), ('claim_plan', 920), ('repl_plan', 930), ('swap_plan_1', 940), ('swap_plan_2', 941)) v(k, d);
insert into public.plan_times(plan_id, kind, starts_at, ends_at)
select pg_temp.fx(k), 'service', now() + interval '910 days', now() + interval '910 days 2 hours'
  from unnest(array['plan_a', 'plan_b']) k;
insert into public.assignments(id, plan_id, person_id, user_id, team_id, position_id, status, created_by, visibility)
values (pg_temp.fx('hidden_request'), pg_temp.fx('plan_a'), pg_temp.fx('sam'), '33333333-3333-4333-8333-333333333333',
        pg_temp.fx('band'), pg_temp.fx('bass'), 'unconfirmed', '22222222-2222-4222-8222-222222222222', 'prepared');

-- ============================================== A. W2-AVAIL-D3 blockouts ===
set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
do $$
declare v_row public.blockouts;
begin
  if exists (select 1 from public.blockouts where reason like 'W2-SECRET-%') then
    raise exception 'A team leader read a private blockout reason from the table';
  end if;
  if exists (select 1 from public.list_blockouts(pg_temp.fx('org')) b where b.person_id = pg_temp.fx('sam')) then
    raise exception 'A team leader listed blockouts of someone outside their teams';
  end if;
  select * into v_row from public.list_blockouts(pg_temp.fx('org'), pg_temp.fx('morgan')) b where b.id = pg_temp.fx('morgan_blockout');
  if v_row.id is null then raise exception 'A team leader cannot list a team member''s blockouts'; end if;
  if v_row.reason is not null then raise exception 'list_blockouts disclosed a reason to a team leader'; end if;
  -- Writes: team member yes, anyone else no.
  if (public.update_blockout(pg_temp.fx('morgan_blockout'), v_row.revision, jsonb_build_object(
        'starts_at', v_row.starts_at, 'ends_at', v_row.ends_at + interval '1 hour', 'reason', null, 'all_day', false))).id is null then
    raise exception 'A team leader cannot update a team member''s blockout';
  end if;
  if public.delete_blockout(pg_temp.fx('sam_blockout')) is not null then
    raise exception 'A team leader deleted the blockout of someone outside their teams';
  end if;
  perform pg_temp.expect_error($q$select public.create_blockout(pg_temp.fx('org'), pg_temp.fx('sam'),
    jsonb_build_object('starts_at', now() + interval '950 days', 'ends_at', now() + interval '950 days 1 hour', 'all_day', false), null)$q$,
    'P0002', null, 'leader creates blockout outside team');
  perform pg_temp.expect_error($q$insert into public.scheduling_preferences (organization_id, person_id, frequency)
    values (pg_temp.fx('org'), pg_temp.fx('sam'), 'monthly')$q$, '42501', null, 'leader writes preferences outside team');
  -- Conflict checks keep working for the scoped leader, reason redacted.
  if not exists (select 1 from public.check_assignment_conflicts(pg_temp.fx('org'), jsonb_build_array(jsonb_build_object(
        'person_id', pg_temp.fx('morgan'), 'plan_id', pg_temp.fx('plan_b'),
        'intervals', jsonb_build_array(jsonb_build_object('starts_at', now() + interval '901 days', 'ends_at', now() + interval '901 days 1 hour')))))
       c where c.kind = 'blockout' and c.detail = 'Unavailable') then
    raise exception 'Scoped leader lost the redacted blockout conflict';
  end if;
end $$;

-- The Person and an owner still read the reason.
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$ begin
  if (select reason from public.blockouts where id = pg_temp.fx('sam_blockout')) is distinct from 'W2-SECRET-SAM' then
    raise exception 'A Person cannot read their own blockout reason';
  end if;
end $$;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$ begin
  -- (Morgan's reason was cleared by the leader's edit above.)
  if (select reason from public.list_blockouts(pg_temp.fx('org'), pg_temp.fx('sam')) b where b.id = pg_temp.fx('sam_blockout')) is distinct from 'W2-SECRET-SAM' then
    raise exception 'An owner does not read the reason';
  end if;
end $$;

-- ======================================== B. W2-STAFF-D1 hidden conflicts ==
reset role;
insert into public.access_grants (organization_id, user_id, capability, scope_type, team_id, created_by) values
  (pg_temp.fx('org'), '55555555-5555-4555-8555-555555555555', 'scheduling.manage', 'team', pg_temp.fx('hospitality'), '11111111-1111-4111-8111-111111111111');
set local role authenticated;
set local request.jwt.claim.sub = '55555555-5555-4555-8555-555555555555';
do $$
declare v_conflict record;
begin
  if exists (select 1 from public.assignments where id = pg_temp.fx('hidden_request')) then
    raise exception 'Fixture: Morgan must not see the prepared Band request';
  end if;
  select * into v_conflict from public.check_assignment_conflicts(pg_temp.fx('org'), jsonb_build_array(jsonb_build_object(
      'person_id', pg_temp.fx('sam'), 'plan_id', pg_temp.fx('plan_b'), 'team_id', pg_temp.fx('hospitality'),
      'position_id', pg_temp.fx('greeter')))) c
   where c.kind = 'overlapping_commitment';
  if v_conflict is null then raise exception 'A hidden prepared request did not count as a conflict'; end if;
  if v_conflict.severity <> 'blocking' or not v_conflict.redacted or v_conflict.other_plan_id is not null
     or v_conflict.other_assignment_id is not null or v_conflict.detail <> 'Another commitment' then
    raise exception 'Hidden conflict was not blocking and redacted: %', row_to_json(v_conflict);
  end if;
  if not exists (select 1 from public.scheduling_conflicts(pg_temp.fx('org'), now() + interval '910 days',
        now() + interval '910 days 1 hour', array['33333333-3333-4333-8333-333333333333'::uuid]) c
       where c.conflict_type = 'double_booked' and c.plan_id is null and c.detail = 'Another commitment') then
    raise exception 'Legacy window check missed the hidden prepared request';
  end if;
end $$;
-- The scheduler who can see it still gets the full detail.
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$ begin
  if not exists (select 1 from public.check_assignment_conflicts(pg_temp.fx('org'), jsonb_build_array(jsonb_build_object(
      'person_id', pg_temp.fx('sam'), 'plan_id', pg_temp.fx('plan_b'), 'team_id', pg_temp.fx('hospitality')))) c
     where c.kind = 'overlapping_commitment' and not c.redacted and c.other_plan_id = pg_temp.fx('plan_a')) then
    raise exception 'A scheduler with scope lost the conflict detail';
  end if;
end $$;

-- ============================================ C. W2-RESP-D2 self-approval ==
-- Riley now also leads Band and may serve as Drums/Bass; Sam may serve Drums.
reset role;
insert into public.access_grants (organization_id, user_id, capability, scope_type, team_id, created_by) values
  (pg_temp.fx('org'), '44444444-4444-4444-8444-444444444444', 'scheduling.manage', 'team', pg_temp.fx('band'), '11111111-1111-4111-8111-111111111111');
insert into public.team_memberships(team_id, user_id, person_id, position_id) values
  (pg_temp.fx('band'), '44444444-4444-4444-8444-444444444444', pg_temp.fx('riley'), pg_temp.fx('bass')),
  (pg_temp.fx('band'), '33333333-3333-4333-8333-333333333333', pg_temp.fx('sam'), pg_temp.fx('drums'))
on conflict do nothing;
insert into public.plan_position_needs(plan_id, position_id, needed) values
  (pg_temp.fx('claim_plan'), pg_temp.fx('drums'), 1), (pg_temp.fx('repl_plan'), pg_temp.fx('bass'), 1);
insert into public.signup_opportunities(id, organization_id, plan_id, team_id, position_id, capacity, approval_policy, closes_at, created_by)
values (pg_temp.fx('claim_opening'), pg_temp.fx('org'), pg_temp.fx('claim_plan'), pg_temp.fx('band'), pg_temp.fx('drums'), 1,
        'leader_approval', now() + interval '30 days', '22222222-2222-4222-8222-222222222222');
-- Sam declined Bass on the replacement plan; Riley and Sam hold confirmed swap sides.
insert into public.assignments(id, plan_id, person_id, user_id, team_id, position_id, status, created_by, visibility, released_at, attendance_mode) values
  (pg_temp.fx('repl_orig'), pg_temp.fx('repl_plan'), pg_temp.fx('sam'), '33333333-3333-4333-8333-333333333333', pg_temp.fx('band'), pg_temp.fx('bass'), 'declined', '22222222-2222-4222-8222-222222222222', 'released', now(), 'all'),
  (pg_temp.fx('swap_riley'), pg_temp.fx('swap_plan_1'), pg_temp.fx('riley'), '44444444-4444-4444-8444-444444444444', pg_temp.fx('band'), pg_temp.fx('drums'), 'confirmed', '22222222-2222-4222-8222-222222222222', 'released', now(), 'all'),
  (pg_temp.fx('swap_sam'), pg_temp.fx('swap_plan_2'), pg_temp.fx('sam'), '33333333-3333-4333-8333-333333333333', pg_temp.fx('band'), pg_temp.fx('bass'), 'confirmed', '22222222-2222-4222-8222-222222222222', 'released', now(), 'all');
set local role authenticated;

-- Claim: Riley claims, cannot approve it; the scheduler can.
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
insert into w2_fx select 'riley_claim', id from public.claim_signup_opportunity(pg_temp.fx('claim_opening'), 1, 'w2-riley-claim');
select pg_temp.expect_error($$select public.decide_signup_claim(pg_temp.fx('riley_claim'), 1, 'approve')$$, '42501', 'self_approval', 'claimant approves own claim');
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$ begin
  if (public.decide_signup_claim(pg_temp.fx('riley_claim'), 1, 'approve')).status <> 'confirmed' then
    raise exception 'An independent approver could not approve the claim';
  end if;
end $$;

-- Replacement: offered to Riley, accepted, cannot be approved by Riley.
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
insert into w2_fx select 'repl_req', id from public.create_replacement_request(pg_temp.fx('repl_orig'),
  (select request_revision from public.assignments where id = pg_temp.fx('repl_orig')), 'w2-sam-replace', now() + interval '7 days');
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
insert into w2_fx select 'riley_offer', id from public.issue_replacement_offer(pg_temp.fx('repl_req'), pg_temp.fx('riley'), 1, 'w2-offer-riley');
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
select public.act_on_replacement_offer(pg_temp.fx('riley_offer'), 1, 'accept');
select pg_temp.expect_error($$select public.act_on_replacement_offer(pg_temp.fx('riley_offer'), 2, 'approve')$$, '42501', 'self_approval', 'candidate approves own offer');
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$ begin
  if (public.act_on_replacement_offer(pg_temp.fx('riley_offer'), 2, 'approve')).status <> 'finalized' then
    raise exception 'An independent approver could not finalize the replacement';
  end if;
end $$;

-- Swap: Riley proposes, Sam consents, Riley cannot approve.
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
insert into w2_fx select 'swap', id from public.create_approved_swap(pg_temp.fx('swap_riley'), pg_temp.fx('swap_sam'),
  (select request_revision from public.assignments where id = pg_temp.fx('swap_riley')),
  (select request_revision from public.assignments where id = pg_temp.fx('swap_sam')), now() + interval '7 days', 'w2-swap');
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
select public.act_on_approved_swap(pg_temp.fx('swap'), (select version from public.approved_swaps where id = pg_temp.fx('swap')), 'consent');
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
select pg_temp.expect_error($$select public.act_on_approved_swap(pg_temp.fx('swap'), (select version from public.approved_swaps where id = pg_temp.fx('swap')), 'approve')$$,
  '42501', 'self_approval', 'participant approves own swap');
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$ begin
  if (public.act_on_approved_swap(pg_temp.fx('swap'), (select version from public.approved_swaps where id = pg_temp.fx('swap')), 'approve')).status <> 'finalized' then
    raise exception 'An independent approver could not finalize the swap';
  end if;
end $$;

-- ======================================= D. W2-STAFF-D2 inactive members ===
reset role;
update public.organization_members set status = 'inactive'
 where organization_id = pg_temp.fx('org') and user_id = '44444444-4444-4444-8444-444444444444';
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$ begin
  if exists (select 1 from public.team_candidates(pg_temp.fx('band')) c where c.person_id = pg_temp.fx('riley')) then
    raise exception 'An inactive member is still a team candidate';
  end if;
  if not exists (select 1 from public.team_candidates(pg_temp.fx('band')) c where c.person_id = pg_temp.fx('sam')) then
    raise exception 'An active member is no longer a team candidate';
  end if;
  if (select schedulable from public.people_directory where id = pg_temp.fx('riley'))
     or not (select schedulable from public.people_directory where id = pg_temp.fx('sam')) then
    raise exception 'people_directory.schedulable is wrong';
  end if;
end $$;

reset role;
select 'qa wave 2: blockout scope, hidden conflicts, self-approval and schedulable people verified' as result;
rollback;
