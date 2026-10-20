-- MOB-011: the F03 delegation paths the native household picker relies on,
-- beyond f03-preferences-delegation.sql: a grant exposes no extra plan, item,
-- note, file or assignment rows; each right stands alone (respond does not
-- read availability, availability does not read or answer requests); one
-- grant cannot answer another Person's request; a grant that expires or is
-- stopped after the screen loaded refuses the next answer; and granting the
-- same helper again replaces the old grant (audited). Run against a seeded
-- local database after migrations. Everything rolls back.
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/mob011-delegation.sql
begin;

create temporary table m11(k text primary key, id uuid) on commit drop;
grant select, insert, update on m11 to authenticated, service_role;
insert into m11 values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('band', 'cccccccc-0000-4000-8000-000000000001'),
  ('sam', (select id from public.people where profile_id = '33333333-3333-4333-8333-333333333333' and organization_id = 'aaaaaaaa-0000-4000-8000-000000000001')),
  ('riley', (select id from public.people where profile_id = '44444444-4444-4444-8444-444444444444' and organization_id = 'aaaaaaaa-0000-4000-8000-000000000001')),
  ('morgan', (select id from public.people where profile_id = '55555555-5555-4555-8555-555555555555' and organization_id = 'aaaaaaaa-0000-4000-8000-000000000001')),
  ('plan', gen_random_uuid()), ('time', gen_random_uuid()), ('sam_req', gen_random_uuid()), ('sam_conf', gen_random_uuid()),
  ('morgan_req', gen_random_uuid());

create or replace function pg_temp.fx(p text) returns uuid language sql stable as
  $$ select id from m11 where k = p $$;

-- What the caller can read about Sam's plan and Sam's availability, through RLS.
create or replace function pg_temp.visible() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'plans', (select count(*) from public.plans where id = pg_temp.fx('plan')),
    'items', (select count(*) from public.plan_items where plan_id = pg_temp.fx('plan')),
    'notes', (select count(*) from public.plan_notes where plan_id = pg_temp.fx('plan')),
    'times', (select count(*) from public.plan_times where plan_id = pg_temp.fx('plan')),
    'assignments', (select count(*) from public.assignments where plan_id = pg_temp.fx('plan')),
    'attachments', (select count(*) from public.attachments where organization_id = pg_temp.fx('org')),
    'blockouts', (select count(*) from public.blockouts where person_id = pg_temp.fx('sam')),
    'preferences', (select count(*) from public.scheduling_preferences where person_id = pg_temp.fx('sam')))
$$;

-- Asserts a statement fails with this SQLSTATE.
create or replace function pg_temp.expect_error(p_sql text, p_state text, p_label text)
returns void language plpgsql as $$
declare v_state text;
begin
  execute p_sql;
  raise exception '%: expected % but it succeeded', p_label, p_state;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate;
  if v_state <> p_state then raise exception '%: expected % but got % (%)', p_label, p_state, v_state, sqlerrm; end if;
end $$;

create or replace function pg_temp.respond(p_person text, p_assignment text, p_status text, p_expected text) returns text language sql as $$
  select format('select * from public.respond_as_delegate(%L, %L, %L, %L, %L)',
    pg_temp.fx('org'), pg_temp.fx(p_person), pg_temp.fx(p_assignment), p_status, p_expected)
$$;

-- A draft plan with an item and a note; Sam has two released requests, Morgan one.
insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by) values
  (pg_temp.fx('plan'), pg_temp.fx('org'), 'bbbbbbbb-0000-4000-8000-000000000001', 'M11 private', '2027-08-01', 'draft', '22222222-2222-4222-8222-222222222222');
insert into public.plan_times (id, plan_id, kind, name, starts_at, ends_at, sort_order) values
  (pg_temp.fx('time'), pg_temp.fx('plan'), 'service', '10am', '2027-08-01T14:00:00Z', '2027-08-01T15:30:00Z', 0);
insert into public.plan_items (plan_id, title) values (pg_temp.fx('plan'), 'Private item');
insert into public.plan_notes (organization_id, plan_id, body) values (pg_temp.fx('org'), pg_temp.fx('plan'), 'Private note');
insert into public.assignments (id, plan_id, person_id, team_id, position_id, status, visibility, created_by) values
  (pg_temp.fx('sam_req'), pg_temp.fx('plan'), pg_temp.fx('sam'), pg_temp.fx('band'), 'dddddddd-0000-4000-8000-000000000003', 'unconfirmed', 'released', '22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('sam_conf'), pg_temp.fx('plan'), pg_temp.fx('sam'), pg_temp.fx('band'), 'dddddddd-0000-4000-8000-000000000004', 'confirmed', 'released', '22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('morgan_req'), pg_temp.fx('plan'), pg_temp.fx('morgan'), pg_temp.fx('band'), 'dddddddd-0000-4000-8000-000000000003', 'unconfirmed', 'released', '22222222-2222-4222-8222-222222222222');
insert into public.blockouts (organization_id, person_id, starts_at, ends_at, reason) values
  (pg_temp.fx('org'), pg_temp.fx('sam'), '2027-09-01T00:00:00Z', '2027-09-02T00:00:00Z', 'Private reason');
insert into public.scheduling_preferences (organization_id, person_id, team_id, frequency, avoided_weeks, preferred_times)
  values (pg_temp.fx('org'), pg_temp.fx('sam'), null, 'once_a_month', '{}', '{}');
delete from public.schedule_delegations where target_person_id = pg_temp.fx('sam') or delegate_person_id = pg_temp.fx('sam');

set local role authenticated;

-- Riley's view with no grant is the baseline every grant is compared against.
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
insert into m11 select 'baseline:' || pg_temp.visible()::text, null;

-- ---------------------------------------------- respond grant (+view) ---
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
insert into m11 select 'respond_grant', (public.grant_schedule_delegation(pg_temp.fx('org'), pg_temp.fx('riley'), true, false, false, false)).id;

set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
do $$
declare v_base jsonb := (select substr(k, 10)::jsonb from m11 where k like 'baseline:%');
begin
  if pg_temp.visible() <> v_base then
    raise exception 'respond grant changed what Riley can read: % vs %', pg_temp.visible(), v_base;
  end if;
  -- The delegated listing names the plan and role, nothing else.
  if (select count(*) from public.delegated_schedule(pg_temp.fx('org'), pg_temp.fx('sam'), '2027-07-01', '2027-09-01')) <> 2 then
    raise exception 'delegated schedule should show Sam''s two released requests';
  end if;
  -- Respond does not include availability.
  perform pg_temp.expect_error(format(
    'insert into public.blockouts (organization_id, person_id, starts_at, ends_at) values (%L, %L, %L, %L)',
    pg_temp.fx('org'), pg_temp.fx('sam'), '2027-10-01T00:00:00Z', '2027-10-02T00:00:00Z'), '42501', 'respond grant wrote availability');
  -- Sam's grant answers only Sam's requests: not Morgan's, whichever Person is named.
  perform pg_temp.expect_error(pg_temp.respond('sam', 'morgan_req', 'confirmed', 'unconfirmed'), 'P0002', 'answered Morgan''s request under Sam''s grant');
  perform pg_temp.expect_error(pg_temp.respond('morgan', 'morgan_req', 'confirmed', 'unconfirmed'), 'P0002', 'answered for Morgan without a grant');
  -- An answer based on a stale screen is refused, not applied.
  perform pg_temp.expect_error(pg_temp.respond('sam', 'sam_req', 'declined', 'confirmed'), 'PT409', 'stale expected status applied');
end $$;
reset role;
do $$ begin
  if (select status from public.assignments where id = pg_temp.fx('morgan_req')) <> 'unconfirmed'
     or (select status from public.assignments where id = pg_temp.fx('sam_req')) <> 'unconfirmed' then
    raise exception 'a refused answer changed a request';
  end if;
end $$;
set local role authenticated;

-- Loaded, then expired before the answer: the answer is refused.
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
select count(*) from public.delegated_schedule(pg_temp.fx('org'), pg_temp.fx('sam'));
reset role;
update public.schedule_delegations set expires_at = now() - interval '1 second' where id = pg_temp.fx('respond_grant');
set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
select pg_temp.expect_error(pg_temp.respond('sam', 'sam_req', 'confirmed', 'unconfirmed'), 'P0002', 'expired grant answered');
reset role;
update public.schedule_delegations set expires_at = null where id = pg_temp.fx('respond_grant');
set local role authenticated;

-- Live again: one answer goes through, recorded as Riley.
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
select * from public.respond_as_delegate(pg_temp.fx('org'), pg_temp.fx('sam'), pg_temp.fx('sam_req'), 'confirmed', 'unconfirmed');
reset role;
do $$ begin
  if (select status from public.assignments where id = pg_temp.fx('sam_req')) <> 'confirmed' then raise exception 'delegated accept lost'; end if;
  if (select actor_id from public.assignment_responses where assignment_id = pg_temp.fx('sam_req') order by created_at desc limit 1)
     <> '44444444-4444-4444-8444-444444444444' then raise exception 'actor not recorded as the delegate'; end if;
  if not exists (select 1 from public.schedule_delegation_events where delegation_id = pg_temp.fx('respond_grant')
                  and event = 'responded' and actor_id = '44444444-4444-4444-8444-444444444444') then
    raise exception 'delegated answer not audited';
  end if;
end $$;
set local role authenticated;

-- Loaded, then stopped by Sam before the withdrawal: refused, and the listing is gone.
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
select public.revoke_schedule_delegation(pg_temp.fx('respond_grant'));
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
select pg_temp.expect_error(pg_temp.respond('sam', 'sam_conf', 'declined', 'confirmed'), 'P0002', 'stopped grant withdrew');
select pg_temp.expect_error(format('select * from public.delegated_schedule(%L, %L)', pg_temp.fx('org'), pg_temp.fx('sam')), 'P0002', 'stopped grant read schedule');

-- -------------------------------------------- availability-only grant ---
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
insert into m11 select 'availability_grant', (public.grant_schedule_delegation(pg_temp.fx('org'), pg_temp.fx('riley'), false, false, true, false)).id;

set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
do $$
declare
  v_base jsonb := (select substr(k, 10)::jsonb from m11 where k like 'baseline:%');
  v_now jsonb := pg_temp.visible();
begin
  -- Availability opens exactly Sam's blockouts and preferences; the plan stays as it was.
  if v_now - 'blockouts' - 'preferences' <> v_base - 'blockouts' - 'preferences' then
    raise exception 'availability grant changed plan visibility: % vs %', v_now, v_base;
  end if;
  if (v_now->>'blockouts')::int < 1 or (v_now->>'preferences')::int < 1 then
    raise exception 'availability grant cannot read Sam''s availability: %', v_now;
  end if;
  perform pg_temp.expect_error(format('select * from public.delegated_schedule(%L, %L)', pg_temp.fx('org'), pg_temp.fx('sam')), 'P0002', 'availability grant read requests');
  perform pg_temp.expect_error(pg_temp.respond('sam', 'sam_conf', 'declined', 'confirmed'), 'P0002', 'availability grant answered');
end $$;

-- ----------------------------------------- granting again replaces ---
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
insert into m11 select 'view_grant', (public.grant_schedule_delegation(pg_temp.fx('org'), pg_temp.fx('riley'), false, true, false, false)).id;
reset role;
do $$ begin
  if (select count(*) from public.schedule_delegations
       where target_person_id = pg_temp.fx('sam') and delegate_person_id = pg_temp.fx('riley') and revoked_at is null) <> 1 then
    raise exception 'more than one active grant for the pair';
  end if;
  if (select revoked_at from public.schedule_delegations where id = pg_temp.fx('availability_grant')) is null then
    raise exception 'old grant not replaced';
  end if;
  if not exists (select 1 from public.schedule_delegation_events where delegation_id = pg_temp.fx('availability_grant')
                  and event = 'revoked' and detail->>'reason' = 'replaced') then
    raise exception 'replacement not audited';
  end if;
end $$;
set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
do $$ begin
  -- View-only: reads the listing, answers nothing, and the old availability right is gone.
  if (select count(*) from public.delegated_schedule(pg_temp.fx('org'), pg_temp.fx('sam'), '2027-07-01', '2027-09-01')) <> 2 then
    raise exception 'view grant cannot read the listing';
  end if;
  perform pg_temp.expect_error(pg_temp.respond('sam', 'sam_conf', 'declined', 'confirmed'), 'P0002', 'view grant answered');
  if pg_temp.visible() <> (select substr(k, 10)::jsonb from m11 where k like 'baseline:%') then
    raise exception 'view grant (replacing availability) still exposes more than the baseline: %', pg_temp.visible();
  end if;
end $$;

reset role;

-- Structural guard: seed members already see this draft plan, so the counts
-- above cannot show a widening on their own. No RLS policy outside the
-- availability tables may consult a grant (directly or through the
-- availability helpers), so a grant can never open plans, items, notes,
-- files, conversations or Storage objects.
do $$
declare v_tables text[];
begin
  select array_agg(distinct schemaname || '.' || tablename order by schemaname || '.' || tablename) into v_tables
    from pg_policies
   where schemaname in ('public', 'storage')
     and (coalesce(qual, '') || coalesce(with_check, '')) ~* '(delegat|can_manage_blockout|is_availability_reviewer)';
  if not v_tables <@ array['public.blockout_series', 'public.blockouts', 'public.person_availability_reviews',
                           'public.schedule_delegation_events', 'public.schedule_delegations', 'public.scheduling_preferences'] then
    raise exception 'a delegation grant reaches beyond availability: %', v_tables;
  end if;
end $$;

select 'mob011 delegation: all checks passed';
rollback;
