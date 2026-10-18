-- F02 Passes A/B: person-first staffing, account continuity, plan-only
-- positions and identity reconciliation (on top of MOB-005).
-- Run against a seeded local database after the migrations:
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/f02-person-identity.sql
-- Everything runs inside one transaction and is rolled back.
--
-- Cast (seed): 1111 owner, 2222 Jordan scheduler (legacy), 3333 Sam member,
-- 5555 Morgan member. Team c1 Worship Band in service type b1.
begin;

create temporary table fx (k text primary key, id uuid) on commit drop;
grant select, insert on fx to authenticated, service_role;
insert into fx values
  ('org',    'aaaaaaaa-0000-4000-8000-000000000001'),
  ('st',     'bbbbbbbb-0000-4000-8000-000000000001'),
  ('band',   'cccccccc-0000-4000-8000-000000000001'),
  ('plan',   gen_random_uuid()),
  ('plan2',  gen_random_uuid()),
  ('guest',  gen_random_uuid()),
  ('guest2', gen_random_uuid()),
  ('newbie', gen_random_uuid()),
  ('other_org', gen_random_uuid()),
  ('foreign', gen_random_uuid());

insert into public.plans (id, organization_id, service_type_id, title, service_date, status) values
  ((select id from fx where k = 'plan'),  (select id from fx where k = 'org'), (select id from fx where k = 'st'), 'F02 plan',  now() + interval '30 days', 'published'),
  ((select id from fx where k = 'plan2'), (select id from fx where k = 'org'), (select id from fx where k = 'st'), 'F02 plan 2', now() + interval '37 days', 'published');

-- A foreign organization with its own Person.
insert into public.organizations (id, name, slug)
values ((select id from fx where k = 'other_org'), 'Other', 'other-f02-' || substr(gen_random_uuid()::text, 1, 8));
insert into public.people (id, organization_id, first_name)
values ((select id from fx where k = 'foreign'), (select id from fx where k = 'other_org'), 'Foreigner');

-- Guests: one without an email, one with.
insert into public.people (id, organization_id, first_name, last_name, email) values
  ((select id from fx where k = 'guest'),  (select id from fx where k = 'org'), 'Gina', 'Guest', null),
  ((select id from fx where k = 'guest2'), (select id from fx where k = 'org'), 'Gabe', 'Guest', 'gabe.f02@example.com');

-- ===================================================== Pass A: staffing =====
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

do $$
declare
  v_plan  uuid := (select id from fx where k = 'plan');
  v_band  uuid := (select id from fx where k = 'band');
  v_guest uuid := (select id from fx where k = 'guest');
  v_row   public.assignments;
  v_n     int;
begin
  -- A guest is scheduled by Person; no login is invented.
  select * into v_row from public.schedule_plan_assignments(
    v_plan, jsonb_build_array(jsonb_build_object('person_id', v_guest, 'team_id', v_band)), true, 'f02-guest-0001');
  if v_row.person_id <> v_guest or v_row.user_id is not null then
    raise exception 'guest assignment not person-backed: %', row_to_json(v_row);
  end if;
  insert into fx values ('guest_assignment', v_row.id);

  -- Delivery: one email row for the guest, no in-app/push.
  select count(*) into v_n from public.deliveries d
    join public.delivery_effects e on e.id = d.effect_id
   where e.effect_key = 'f02-guest-0001' and d.recipient_person_id = v_guest;
  if v_n <> 1 or exists (select 1 from public.deliveries d join public.delivery_effects e on e.id = d.effect_id
                          where e.effect_key = 'f02-guest-0001' and d.channel <> 'email') then
    raise exception 'guest deliveries wrong (% rows)', v_n;
  end if;

  -- Missing email is visible to the scheduler as a boolean, never an address.
  if (select has_email from public.person_delivery_readiness((select id from fx where k = 'org'), array[v_guest])) then
    raise exception 'guest without email reported as reachable';
  end if;
  if not (select has_email from public.person_delivery_readiness((select id from fx where k = 'org'), array[(select id from fx where k = 'guest2')])) then
    raise exception 'guest with email reported unreachable';
  end if;

  -- Legacy callers may still name a login.
  select * into v_row from public.schedule_plan_assignments(
    v_plan, jsonb_build_array(jsonb_build_object('user_id', '33333333-3333-4333-8333-333333333333', 'team_id', v_band)), false);
  if v_row.person_id is null or v_row.user_id <> '33333333-3333-4333-8333-333333333333' then
    raise exception 'legacy user_id scheduling broken';
  end if;

  -- A foreign Person is refused.
  begin
    perform public.schedule_plan_assignments(
      v_plan, jsonb_build_array(jsonb_build_object('person_id', (select id from fx where k = 'foreign'), 'team_id', v_band)), false);
    raise exception 'foreign person scheduled';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- An inactive member's Person cannot be scheduled.
reset role;
update public.organization_members set status = 'inactive'
 where organization_id = (select id from fx where k = 'org') and user_id = '55555555-5555-4555-8555-555555555555';
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
begin
  perform public.schedule_plan_assignments(
    (select id from fx where k = 'plan2'),
    jsonb_build_array(jsonb_build_object('user_id', '55555555-5555-4555-8555-555555555555', 'team_id', (select id from fx where k = 'band'))),
    false);
  raise exception 'inactive member scheduled';
exception when sqlstate '22023' then null;
end $$;
reset role;
update public.organization_members set status = 'active'
 where organization_id = (select id from fx where k = 'org') and user_id = '55555555-5555-4555-8555-555555555555';

-- ============================================== Pass B: plan-only position ==
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
declare
  v_plan   uuid := (select id from fx where k = 'plan');
  v_plan2  uuid := (select id from fx where k = 'plan2');
  v_band   uuid := (select id from fx where k = 'band');
  v_before int := (select count(*) from public.team_positions where team_id = (select id from fx where k = 'band') and plan_id is null);
  v_pos    public.team_positions;
  v_copy   uuid;
begin
  v_pos := public.create_plan_position(v_plan, v_band, 'Guest trumpet', 1);
  if v_pos.plan_id <> v_plan then
    raise exception 'position not plan-only';
  end if;
  if (select count(*) from public.team_positions where team_id = v_band and plan_id is null) <> v_before then
    raise exception 'team normal list changed';
  end if;
  if (select needed from public.plan_position_needs where plan_id = v_plan and position_id = v_pos.id) <> 1 then
    raise exception 'need not recorded';
  end if;
  -- Same name on the same plan/team is refused; the name stays free elsewhere.
  begin
    perform public.create_plan_position(v_plan, v_band, 'Guest trumpet', 1);
    raise exception 'duplicate plan-only position';
  exception when sqlstate 'PT409' then null;
  end;
  perform public.create_plan_position(v_plan2, v_band, 'Guest trumpet', 0);

  -- Schedule the email guest into it; it cannot be used on another plan.
  perform public.schedule_plan_assignments(v_plan, jsonb_build_array(jsonb_build_object(
    'person_id', (select id from fx where k = 'guest2'), 'team_id', v_band, 'position_id', v_pos.id)), false);
  begin
    perform public.schedule_plan_assignments(v_plan2, jsonb_build_array(jsonb_build_object(
      'person_id', (select id from fx where k = 'guest2'), 'team_id', v_band, 'position_id', v_pos.id)), false);
    raise exception 'plan-only position used on another plan';
  exception when sqlstate '22023' then null;
  end;
  begin
    insert into public.plan_position_needs (plan_id, position_id, needed) values (v_plan2, v_pos.id, 1);
    raise exception 'plan-only need on another plan';
  exception when sqlstate '22023' then null;
  end;

  -- Removing it while someone holds it is refused.
  begin
    perform public.delete_plan_position(v_pos.id);
    raise exception 'assigned plan-only position deleted';
  exception when sqlstate 'PT409' then null;
  end;

  -- A copy keeps the guests on normal positions and leaves the plan-only one.
  v_copy := public.duplicate_plan(v_plan, now() + interval '44 days', 'F02 copy', true, 'f02-copy-0001');
  if not exists (select 1 from public.assignments where plan_id = v_copy and person_id = (select id from fx where k = 'guest')) then
    raise exception 'guest not copied';
  end if;
  if exists (select 1 from public.assignments a join public.team_positions tp on tp.id = a.position_id
              where a.plan_id = v_copy and tp.plan_id is not null)
     or exists (select 1 from public.plan_position_needs n join public.team_positions tp on tp.id = n.position_id
                 where n.plan_id = v_copy and tp.plan_id is not null) then
    raise exception 'plan-only position copied';
  end if;
end $$;

-- A member cannot add plan-only positions.
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$
begin
  perform public.create_plan_position((select id from fx where k = 'plan'), (select id from fx where k = 'band'), 'Sneaky', 1);
  raise exception 'member created a plan-only position';
exception when sqlstate 'P0002' then null;
end $$;

-- Linking is not an API-role action.
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$
begin
  update public.people set profile_id = '33333333-3333-4333-8333-333333333333' where id = (select id from fx where k = 'guest');
  raise exception 'owner linked a login directly';
exception when insufficient_privilege then null;
end $$;

-- ================================================ Pass B: account linking ==
reset role;

-- A new login for the email guest, through an invitation.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', (select id from fx where k = 'newbie'), 'authenticated', 'authenticated',
  'gabe.f02@example.com', '', now(), '', '', '', '', '{}'::jsonb, '{"full_name":"Gabe Guest"}'::jsonb, now(), now());

insert into public.person_invitations (organization_id, person_id, email, role, token_hash, expires_at)
values ((select id from fx where k = 'org'), (select id from fx where k = 'guest2'), 'gabe.f02@example.com', 'member', 'f02-token-gabe', now() + interval '7 days');

do $$
declare
  v_guest2 uuid := (select id from fx where k = 'guest2');
  v_newbie uuid := (select id from fx where k = 'newbie');
  v_ids_before uuid[];
  v_status text;
begin
  select array_agg(id order by id) into v_ids_before from public.assignments where person_id = v_guest2;

  -- An invalid token changes nothing.
  if (select out_status from public.accept_person_invitation('nope', v_newbie)) <> 'invalid' then
    raise exception 'invalid token accepted';
  end if;

  select out_status into v_status from public.accept_person_invitation('f02-token-gabe', v_newbie);
  if v_status <> 'linked' then
    raise exception 'acceptance status %', v_status;
  end if;
  if (select profile_id from public.people where id = v_guest2) <> v_newbie then
    raise exception 'Person not linked';
  end if;
  -- Same Person, same assignment ids, login now filled in everywhere.
  if (select array_agg(id order by id) from public.assignments where person_id = v_guest2) <> v_ids_before
     or exists (select 1 from public.assignments where person_id = v_guest2 and user_id is distinct from v_newbie) then
    raise exception 'assignments did not follow the Person';
  end if;
  if (select count(*) from public.people where organization_id = (select id from fx where k = 'org') and profile_id = v_newbie) <> 1 then
    raise exception 'duplicate Person created for the new member';
  end if;
  -- No email-match report for the Person that was linked explicitly.
  if exists (select 1 from public.person_identity_reconciliations where profile_id = v_newbie) then
    raise exception 'explicit link reported as ambiguous';
  end if;
  -- Re-using the token is invalid.
  if (select out_status from public.accept_person_invitation('f02-token-gabe', v_newbie)) <> 'invalid' then
    raise exception 'used invitation accepted again';
  end if;
end $$;

-- The new login sees the same request through RLS.
do $$
begin
  execute format('set local request.jwt.claim.sub = %L', (select id from fx where k = 'newbie'));
end $$;
set local role authenticated;
do $$
begin
  if not exists (select 1 from public.assignments where person_id = (select id from fx where k = 'guest2')) then
    raise exception 'linked login cannot see the earlier request';
  end if;
end $$;

-- Conflicts: Sam (already a member with a Person) accepts an invitation for
-- the no-email guest → stopped and reported; the invitation stays pending.
reset role;
insert into public.person_invitations (organization_id, person_id, email, role, token_hash, expires_at)
values ((select id from fx where k = 'org'), (select id from fx where k = 'guest'), 'sam@example.com', 'member', 'f02-token-sam', now() + interval '7 days');
do $$
declare
  v_status text;
begin
  select out_status into v_status from public.accept_person_invitation('f02-token-sam', '33333333-3333-4333-8333-333333333333');
  if v_status <> 'identity_conflict' then
    raise exception 'conflict status %', v_status;
  end if;
  if (select profile_id from public.people where id = (select id from fx where k = 'guest')) is not null then
    raise exception 'conflicting Person was linked';
  end if;
  if (select accepted_at from public.person_invitations where token_hash = 'f02-token-sam') is not null then
    raise exception 'conflicting invitation consumed';
  end if;
  if not exists (select 1 from public.person_identity_reconciliations
                  where candidate_person_id = (select id from fx where k = 'guest') and reason = 'invitation_conflict' and status = 'open') then
    raise exception 'conflict not reported';
  end if;
end $$;

-- An invitation for a Person already linked to someone else.
insert into public.person_invitations (organization_id, person_id, email, role, token_hash, expires_at)
values ((select id from fx where k = 'org'), (select id from fx where k = 'guest2'), 'x.f02@example.com', 'member', 'f02-token-other', now() + interval '7 days');
do $$
begin
  if (select out_status from public.accept_person_invitation('f02-token-other', '44444444-4444-4444-8444-444444444444')) <> 'person_linked' then
    raise exception 'already-linked Person relinked';
  end if;
end $$;

-- ====================================================== reconciliation =====
-- A member joining with an email that matches an unlinked Person gets their
-- own Person and a report — never the unlinked one.
insert into fx values ('joiner', gen_random_uuid()), ('lookalike', gen_random_uuid());
insert into public.people (id, organization_id, first_name, email)
values ((select id from fx where k = 'lookalike'), (select id from fx where k = 'org'), 'Jo', 'Jo.F02@example.com');
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', (select id from fx where k = 'joiner'), 'authenticated', 'authenticated',
  'jo.f02@example.com', '', now(), '', '', '', '', '{}'::jsonb, '{"full_name":"Jo Joiner"}'::jsonb, now(), now());
insert into public.organization_members (organization_id, user_id, role)
values ((select id from fx where k = 'org'), (select id from fx where k = 'joiner'), 'member');
do $$
declare
  v_person uuid := (select id from public.people where organization_id = (select id from fx where k = 'org')
                     and profile_id = (select id from fx where k = 'joiner'));
begin
  if v_person is null or v_person = (select id from fx where k = 'lookalike') then
    raise exception 'joiner adopted the same-email Person';
  end if;
  if (select profile_id from public.people where id = (select id from fx where k = 'lookalike')) is not null then
    raise exception 'same-email Person was linked';
  end if;
  if not exists (select 1 from public.person_identity_reconciliations
                  where person_id = v_person and candidate_person_id = (select id from fx where k = 'lookalike')
                    and reason = 'email_match' and status = 'open') then
    raise exception 'email match not reported';
  end if;
end $$;

-- Merge (owner): Sam's Person absorbs the no-email guest's request.
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$
declare
  v_rec  uuid := (select id from public.person_identity_reconciliations
                   where candidate_person_id = (select id from fx where k = 'guest') and status = 'open');
  v_sam  uuid := (select id from public.people where organization_id = (select id from fx where k = 'org')
                   and profile_id = '33333333-3333-4333-8333-333333333333');
  v_row  public.person_identity_reconciliations;
begin
  -- Sam and the guest are both on the Band (no position) on the plan → refused.
  begin
    perform public.resolve_person_reconciliation(v_rec, 'merge');
    raise exception 'colliding merge applied';
  exception when sqlstate 'PT409' then null;
  end;
  v_row := public.resolve_person_reconciliation(v_rec, 'keep_separate');
  if v_row.status <> 'kept_separate' or v_row.resolved_by <> '11111111-1111-4111-8111-111111111111' then
    raise exception 'keep_separate not recorded';
  end if;
  -- Repeating is a no-op.
  if (public.resolve_person_reconciliation(v_rec, 'merge')).status <> 'kept_separate' then
    raise exception 'resolved report changed again';
  end if;
end $$;

-- A scheduler cannot read or resolve reports.
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
begin
  if exists (select 1 from public.person_identity_reconciliations) then
    raise exception 'scheduler reads reconciliation reports';
  end if;
  perform public.resolve_person_reconciliation(gen_random_uuid(), 'merge');
  raise exception 'scheduler resolved a report';
exception when sqlstate 'P0002' then null;
end $$;

-- ================================================ losing a login keeps history
reset role;
do $$
declare
  v_ids uuid[] := (select array_agg(id order by id) from public.assignments where person_id = (select id from fx where k = 'guest2'));
begin
  delete from auth.users where id = (select id from fx where k = 'newbie');
  if (select array_agg(id order by id) from public.assignments where person_id = (select id from fx where k = 'guest2')) <> v_ids then
    raise exception 'deleting a login deleted staffing history';
  end if;
  if exists (select 1 from public.assignments where person_id = (select id from fx where k = 'guest2') and user_id is not null)
     or (select profile_id from public.people where id = (select id from fx where k = 'guest2')) is not null then
    raise exception 'login reference not cleared';
  end if;
end $$;

-- ===================================================== guest creation =====
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
declare
  v_id uuid;
begin
  v_id := public.create_guest_person((select id from fx where k = 'org'), ' Pat ', null, 'PAT.F02@Example.com');
  if (select row(first_name, email, profile_id is null, created_by)::text from public.people where id = v_id)
     <> row('Pat', 'pat.f02@example.com', true, '22222222-2222-4222-8222-222222222222'::uuid)::text then
    raise exception 'guest not created as a minimal no-login Person';
  end if;
  begin
    perform public.create_guest_person((select id from fx where k = 'org'), 'Bad', null, 'not-an-email');
    raise exception 'bad email accepted';
  exception when sqlstate '22023' then null;
  end;
end $$;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$
begin
  perform public.create_guest_person((select id from fx where k = 'org'), 'Sneaky');
  raise exception 'member created a guest';
exception when insufficient_privilege then null;
end $$;
reset role;

select 'f02-person-identity: ok';
rollback;
