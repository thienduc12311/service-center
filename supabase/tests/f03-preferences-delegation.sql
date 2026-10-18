-- F03 Passes B–D: preferences/warnings, freshness and availability requests,
-- explicit delegation, opted-in cross-organization reads. Caller-role checks
-- throughout. Run after migrations against seeded local Supabase; rolls back.
begin;

create temporary table f03(k text primary key, id uuid) on commit drop;
grant select, insert, update on f03 to authenticated, service_role;
insert into f03 values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('band', 'cccccccc-0000-4000-8000-000000000001'),
  ('sam', (select id from public.people where profile_id = '33333333-3333-4333-8333-333333333333' and organization_id = 'aaaaaaaa-0000-4000-8000-000000000001')),
  ('riley', (select id from public.people where profile_id = '44444444-4444-4444-8444-444444444444' and organization_id = 'aaaaaaaa-0000-4000-8000-000000000001')),
  ('morgan', (select id from public.people where profile_id = '55555555-5555-4555-8555-555555555555' and organization_id = 'aaaaaaaa-0000-4000-8000-000000000001')),
  ('plan_a', gen_random_uuid()), ('plan_b', gen_random_uuid()), ('time_a', gen_random_uuid()), ('time_b', gen_random_uuid()),
  ('a_vocals', gen_random_uuid()), ('a_keys', gen_random_uuid()), ('b_released', gen_random_uuid()), ('b_prepared', gen_random_uuid()),
  ('org2', gen_random_uuid());

-- Two plans a week apart. Sam holds two positions on plan A (counted once).
insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by) values
  ((select id from f03 where k='plan_a'), (select id from f03 where k='org'), 'bbbbbbbb-0000-4000-8000-000000000001', 'F03 A', '2027-05-02', 'published', '22222222-2222-4222-8222-222222222222'),
  ((select id from f03 where k='plan_b'), (select id from f03 where k='org'), 'bbbbbbbb-0000-4000-8000-000000000001', 'F03 B', '2027-05-09', 'published', '22222222-2222-4222-8222-222222222222');
insert into public.plan_times (id, plan_id, kind, name, starts_at, ends_at, sort_order) values
  ((select id from f03 where k='time_a'), (select id from f03 where k='plan_a'), 'service', '10am', '2027-05-02T14:00:00Z', '2027-05-02T15:30:00Z', 0),
  ((select id from f03 where k='time_b'), (select id from f03 where k='plan_b'), 'service', '10am', '2027-05-09T14:00:00Z', '2027-05-09T15:30:00Z', 0);
insert into public.assignments (id, plan_id, person_id, team_id, position_id, status, visibility, created_by) values
  ((select id from f03 where k='a_vocals'), (select id from f03 where k='plan_a'), (select id from f03 where k='sam'), (select id from f03 where k='band'), 'dddddddd-0000-4000-8000-000000000003', 'confirmed', 'released', '22222222-2222-4222-8222-222222222222'),
  ((select id from f03 where k='a_keys'), (select id from f03 where k='plan_a'), (select id from f03 where k='sam'), (select id from f03 where k='band'), 'dddddddd-0000-4000-8000-000000000004', 'confirmed', 'released', '22222222-2222-4222-8222-222222222222'),
  ((select id from f03 where k='b_released'), (select id from f03 where k='plan_b'), (select id from f03 where k='sam'), (select id from f03 where k='band'), 'dddddddd-0000-4000-8000-000000000003', 'unconfirmed', 'released', '22222222-2222-4222-8222-222222222222'),
  ((select id from f03 where k='b_prepared'), (select id from f03 where k='plan_b'), (select id from f03 where k='sam'), (select id from f03 where k='band'), 'dddddddd-0000-4000-8000-000000000004', 'unconfirmed', 'prepared', '22222222-2222-4222-8222-222222222222');
delete from public.person_availability_reviews where person_id in (select id from f03 where k in ('sam','riley','morgan'));

-- =============================================================== Pass B ===
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';

-- Sam saves an all-teams and a Band preference.
insert into public.scheduling_preferences (organization_id, person_id, team_id, frequency, avoided_weeks, preferred_times)
values ((select id from f03 where k='org'), (select id from f03 where k='sam'), null, 'once_a_month', '{}', '{}');
insert into public.scheduling_preferences (organization_id, person_id, team_id, frequency, max_per_month, avoided_weeks, preferred_times)
values ((select id from f03 where k='org'), (select id from f03 where k='sam'), (select id from f03 where k='band'), 'every_other_week', 1, '{2}', '{09:00}');

do $$ begin
  begin
    insert into public.scheduling_preferences (organization_id, person_id, avoided_weeks, preferred_weeks)
    values ((select id from f03 where k='org'), (select id from f03 where k='sam'), '{1}', '{1}');
    raise exception 'overlapping preferred/avoided weeks accepted';
  exception when check_violation then null; when unique_violation then null;
  end;
  begin
    insert into public.scheduling_preferences (organization_id, person_id, frequency)
    values ((select id from f03 where k='org'), (select id from f03 where k='riley'), 'every_week');
    raise exception 'member wrote another person''s preference';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.scheduling_preference_warnings((select id from f03 where k='org'), (select id from f03 where k='plan_b'), (select id from f03 where k='band'), array[(select id from f03 where k='sam')]);
    raise exception 'member read warnings';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Riley (member) cannot see Sam's preferences or review.
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
do $$ begin
  if exists (select 1 from public.scheduling_preferences where person_id = (select id from f03 where k='sam')) then
    raise exception 'member read another person''s preferences';
  end if;
end $$;

-- Jordan (scheduler) sees warnings for plan B on Band.
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
declare v_codes text[];
begin
  select array_agg(code order by code) into v_codes
    from public.scheduling_preference_warnings((select id from f03 where k='org'), (select id from f03 where k='plan_b'),
      (select id from f03 where k='band'), array[(select id from f03 where k='sam')]);
  -- every_other_week (plan A is 7 days away), monthly max 1 (one distinct
  -- plan, not two positions), week 2 avoided, 10:00 not in {09:00}, never
  -- reviewed. The all-teams once_a_month row is overridden by the Band row.
  if v_codes <> array['availability_unknown','avoided_week','frequency','monthly_max','time_not_preferred'] then
    raise exception 'unexpected warnings: %', v_codes;
  end if;
  if (select detail from public.scheduling_preference_warnings((select id from f03 where k='org'), (select id from f03 where k='plan_b'),
        (select id from f03 where k='band'), array[(select id from f03 where k='sam')]) where code = 'monthly_max')
     <> 'Already serving 1 of at most 1 this month' then
    raise exception 'positions double-counted';
  end if;
  -- Another team uses the all-teams preference.
  select array_agg(code order by code) into v_codes
    from public.scheduling_preference_warnings((select id from f03 where k='org'), (select id from f03 where k='plan_b'),
      'cccccccc-0000-4000-8000-000000000002', array[(select id from f03 where k='sam')]);
  if v_codes <> array['availability_unknown','frequency'] then raise exception 'all-teams fallback wrong: %', v_codes; end if;
end $$;

-- A scheduler recording Sam's blockout is not Sam's review.
insert into public.blockouts (organization_id, person_id, starts_at, ends_at)
values ((select id from f03 where k='org'), (select id from f03 where k='sam'), '2027-06-01T00:00:00Z', '2027-06-02T00:00:00Z');
do $$ begin
  if exists (select 1 from public.person_availability_reviews where person_id = (select id from f03 where k='sam')) then
    raise exception 'scheduler change counted as review';
  end if;
end $$;

-- Availability request: preview, exact recipients, idempotent create.
do $$
declare v_audience int; v_first record; v_second record;
begin
  select count(*) into v_audience from public.preview_availability_request((select id from f03 where k='org'), (select id from f03 where k='band'));
  if v_audience <> 4 then raise exception 'audience %', v_audience; end if;
  if exists (select 1 from public.preview_availability_request((select id from f03 where k='org'), (select id from f03 where k='band')) a
              where a.has_email is null) then raise exception 'readiness missing'; end if;

  begin
    perform * from public.create_availability_request((select id from f03 where k='org'), (select id from f03 where k='band'),
      array[(select id from f03 where k='sam'), (select id from public.people where profile_id = '22222222-2222-4222-8222-222222222222')],
      null, '2027-06-01', '2027-08-31', null, 'f03-avail-req-bad');
    raise exception 'recipient outside audience accepted';
  exception when sqlstate 'PT409' then null;
  end;

  select * into v_first from public.create_availability_request((select id from f03 where k='org'), (select id from f03 where k='band'),
    array[(select id from f03 where k='sam'), (select id from f03 where k='riley')], 'Summer please', '2027-06-01', '2027-08-31', '2027-05-20', 'f03-avail-req-1');
  select * into v_second from public.create_availability_request((select id from f03 where k='org'), (select id from f03 where k='band'),
    array[(select id from f03 where k='sam'), (select id from f03 where k='riley')], 'Summer please', '2027-06-01', '2027-08-31', '2027-05-20', 'f03-avail-req-1');
  if v_first.request_id <> v_second.request_id or v_first.effect_id <> v_second.effect_id or not v_second.replayed then
    raise exception 'replay created a second request';
  end if;
  insert into f03 values ('request', v_first.request_id), ('effect', v_first.effect_id);
end $$;

reset role;
do $$ begin
  if (select count(*) from public.delivery_effects where availability_request_id = (select id from f03 where k='request')) <> 1
     or (select count(*) from public.deliveries where effect_id = (select id from f03 where k='effect')) <> 6 then
    raise exception 'expected one effect and 3 channels x 2 recipients';
  end if;
end $$;
set local role authenticated;

-- Morgan (member, not a recipient) cannot read it; Sam sees their own row.
set local request.jwt.claim.sub = '55555555-5555-4555-8555-555555555555';
do $$ begin
  if exists (select 1 from public.availability_requests where id = (select id from f03 where k='request'))
     or exists (select 1 from public.availability_request_recipients where request_id = (select id from f03 where k='request')) then
    raise exception 'non-recipient read the request';
  end if;
  begin
    perform * from public.preview_availability_request((select id from f03 where k='org'), (select id from f03 where k='band'));
    raise exception 'member previewed an audience';
  exception when sqlstate 'P0002' then null;
  end;
end $$;

set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$ begin
  if (select count(*) from public.availability_request_recipients where request_id = (select id from f03 where k='request')) <> 1 then
    raise exception 'recipient should see exactly their own row';
  end if;
  if not exists (select 1 from public.availability_requests where id = (select id from f03 where k='request')) then
    raise exception 'recipient cannot read the request they received';
  end if;
  -- Affirming with no blockouts completes the request and is visible to leaders.
  perform public.affirm_availability((select id from f03 where k='org'), (select id from f03 where k='sam'));
  if (select response_kind from public.availability_request_recipients
       where request_id = (select id from f03 where k='request') and person_id = (select id from f03 where k='sam')) <> 'affirmed' then
    raise exception 'affirm did not complete the request';
  end if;
  begin
    perform public.affirm_availability((select id from f03 where k='org'), (select id from f03 where k='riley'));
    raise exception 'affirmed for someone else';
  exception when sqlstate 'P0002' then null;
  end;
end $$;

set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$ begin
  if exists (select 1 from public.scheduling_preference_warnings((select id from f03 where k='org'), (select id from f03 where k='plan_b'),
        (select id from f03 where k='band'), array[(select id from f03 where k='sam')]) where code like 'availability_%') then
    raise exception 'fresh review still warned';
  end if;
  if (select responded_at from public.availability_request_recipients
       where request_id = (select id from f03 where k='request') and person_id = (select id from f03 where k='riley')) is not null then
    raise exception 'unanswered recipient marked responded';
  end if;
end $$;

-- =============================================================== Pass C ===
-- Nobody but Sam can grant help over Sam's schedule.
do $$ begin
  begin
    perform public.grant_schedule_delegation((select id from f03 where k='org'), (select id from f03 where k='riley'), true, false, false, false);
    -- Jordan's grant is over *Jordan's* own schedule, never Sam's.
    if exists (select 1 from public.schedule_delegations where target_person_id = (select id from f03 where k='sam')) then
      raise exception 'scheduler created a grant over Sam';
    end if;
  end;
end $$;

-- Without a grant Riley can do nothing for Sam.
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
do $$ begin
  begin
    perform * from public.respond_as_delegate((select id from f03 where k='org'), (select id from f03 where k='sam'), (select id from f03 where k='b_released'), 'confirmed', 'unconfirmed');
    raise exception 'responded without a grant';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    insert into public.blockouts (organization_id, person_id, starts_at, ends_at)
    values ((select id from f03 where k='org'), (select id from f03 where k='sam'), '2027-07-01T00:00:00Z', '2027-07-02T00:00:00Z');
    raise exception 'managed availability without a grant';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Sam grants Riley respond + availability (no view-only flag needed: respond implies reading what to answer).
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$
declare v_row public.schedule_delegations;
begin
  begin
    perform public.grant_schedule_delegation((select id from f03 where k='org'), (select id from f03 where k='sam'), true, false, false, false);
    raise exception 'self-grant accepted';
  exception when invalid_parameter_value then null;
  end;
  v_row := public.grant_schedule_delegation((select id from f03 where k='org'), (select id from f03 where k='riley'), true, false, true, false, now() + interval '30 days');
  insert into f03 values ('grant', v_row.id);
end $$;

set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
do $$
declare v_count int; v_result record;
begin
  -- Reads only released requests, with no prepared row.
  select count(*) into v_count from public.delegated_schedule((select id from f03 where k='org'), (select id from f03 where k='sam'), '2027-04-01', '2027-06-01');
  if v_count <> 3 then raise exception 'delegated schedule rows % (prepared leaked?)', v_count; end if;
  -- Cannot read Sam's private preferences beyond availability rights? Availability grant allows it.
  if not exists (select 1 from public.scheduling_preferences where person_id = (select id from f03 where k='sam')) then
    raise exception 'availability delegate cannot see preferences';
  end if;
  -- Manage availability: allowed, counts as Sam's review, audited.
  insert into public.blockouts (organization_id, person_id, starts_at, ends_at)
  values ((select id from f03 where k='org'), (select id from f03 where k='sam'), '2027-07-01T00:00:00Z', '2027-07-02T00:00:00Z');
  -- Respond to the released request; prepared is unreachable.
  select * into v_result from public.respond_as_delegate((select id from f03 where k='org'), (select id from f03 where k='sam'), (select id from f03 where k='b_released'), 'declined', 'unconfirmed', 'Away');
  if v_result.transition <> 'response' or v_result.effect_id is null then raise exception 'delegated response missing effect'; end if;
  begin
    perform * from public.respond_as_delegate((select id from f03 where k='org'), (select id from f03 where k='sam'), (select id from f03 where k='b_prepared'), 'confirmed', 'unconfirmed');
    raise exception 'answered a prepared request';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    perform * from public.respond_as_delegate((select id from f03 where k='org'), (select id from f03 where k='sam'), (select id from f03 where k='b_released'), 'confirmed', 'declined');
    raise exception 'resurrected a declined request';
  exception when sqlstate 'PT409' then null;
  end;
  -- Grant ends: Riley sees nothing more of Sam's preferences.
end $$;

reset role;
do $$ begin
  if (select actor_id from public.assignment_responses where assignment_id = (select id from f03 where k='b_released') order by created_at desc limit 1)
     <> '44444444-4444-4444-8444-444444444444' then raise exception 'actor not recorded as delegate'; end if;
  if (select count(*) from public.schedule_delegation_events where delegation_id = (select id from f03 where k='grant')) <> 3 then
    raise exception 'expected granted + availability_changed + responded events';
  end if;
  if (select kind from public.person_availability_reviews where person_id = (select id from f03 where k='sam')) <> 'changed' then
    raise exception 'delegate change did not count as review';
  end if;
end $$;
set local role authenticated;

-- Morgan revokes nothing; Sam revokes; the next action fails.
set local request.jwt.claim.sub = '55555555-5555-4555-8555-555555555555';
do $$ begin
  begin
    perform public.revoke_schedule_delegation((select id from f03 where k='grant'));
    raise exception 'unrelated member revoked';
  exception when sqlstate 'P0002' then null;
  end;
end $$;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
select public.revoke_schedule_delegation((select id from f03 where k='grant'));
select public.revoke_schedule_delegation((select id from f03 where k='grant')); -- idempotent
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
do $$ begin
  begin
    perform * from public.delegated_schedule((select id from f03 where k='org'), (select id from f03 where k='sam'));
    raise exception 'revoked delegate read schedule';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    insert into public.blockouts (organization_id, person_id, starts_at, ends_at)
    values ((select id from f03 where k='org'), (select id from f03 where k='sam'), '2027-07-05T00:00:00Z', '2027-07-06T00:00:00Z');
    raise exception 'revoked delegate wrote availability';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Expiry and membership are re-checked too.
reset role;
update public.schedule_delegations set revoked_at = null, revoked_by = null where id = (select id from f03 where k='grant');
update public.schedule_delegations set expires_at = now() - interval '1 second' where id = (select id from f03 where k='grant');
set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
do $$ begin
  if private.delegation_allows('44444444-4444-4444-8444-444444444444', (select id from f03 where k='sam'), 'respond') then
    raise exception 'expired grant still allowed';
  end if;
end $$;
reset role;
update public.schedule_delegations set expires_at = null where id = (select id from f03 where k='grant');
update public.organization_members set status = 'inactive'
 where organization_id = (select id from f03 where k='org') and user_id = '33333333-3333-4333-8333-333333333333';
do $$ begin
  if private.delegation_allows('44444444-4444-4444-8444-444444444444', (select id from f03 where k='sam'), 'respond') then
    raise exception 'grant survived target leaving';
  end if;
end $$;
update public.organization_members set status = 'active'
 where organization_id = (select id from f03 where k='org') and user_id = '33333333-3333-4333-8333-333333333333';

-- A view-only grant cannot answer.
update public.schedule_delegations set can_respond = false, can_view_schedule = true, can_manage_availability = false
 where id = (select id from f03 where k='grant');
set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
do $$ begin
  perform * from public.delegated_schedule((select id from f03 where k='org'), (select id from f03 where k='sam'), '2027-04-01', '2027-06-01');
  begin
    perform * from public.respond_as_delegate((select id from f03 where k='org'), (select id from f03 where k='sam'), (select id from f03 where k='a_vocals'), 'declined', 'confirmed');
    raise exception 'view grant answered';
  exception when sqlstate 'P0002' then null;
  end;
end $$;

-- =============================================================== Pass D ===
reset role;
insert into public.organizations (id, name, slug, timezone) values ((select id from f03 where k='org2'), 'Other Org', 'f03-other-org', 'America/Vancouver');
insert into public.organization_members (organization_id, user_id, role, status)
values ((select id from f03 where k='org2'), '33333333-3333-4333-8333-333333333333', 'member', 'active');
insert into public.blockouts (organization_id, person_id, starts_at, ends_at, reason)
values ((select id from f03 where k='org2'),
        (select id from public.people where organization_id = (select id from f03 where k='org2') and profile_id = '33333333-3333-4333-8333-333333333333'),
        '2027-05-09T13:00:00Z', '2027-05-09T16:00:00Z', 'Secret retreat');

set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$ begin
  if exists (select 1 from public.cross_organization_busy((select id from f03 where k='org'), array[(select id from f03 where k='sam')], '2027-05-01', '2027-05-31')) then
    raise exception 'busy shared without opt-in';
  end if;
end $$;

set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$ begin
  begin
    perform * from public.my_organization_schedule((select id from f03 where k='org'), '2027-05-01', '2027-05-31');
    raise exception 'combined schedule without opt-in';
  exception when insufficient_privilege then null;
  end;
end $$;
insert into public.user_schedule_settings (user_id, combined_schedule, share_busy_across_orgs)
values ('33333333-3333-4333-8333-333333333333', true, true);
do $$
declare v_kinds text[];
begin
  select array_agg(distinct kind order by kind) into v_kinds
    from public.my_organization_schedule((select id from f03 where k='org'), '2027-05-01', '2027-05-31');
  if v_kinds <> array['assignment'] then raise exception 'own schedule kinds %', v_kinds; end if;
  if exists (select 1 from public.my_organization_schedule((select id from f03 where k='org'), '2027-05-01', '2027-05-31') where item_id = (select id from f03 where k='b_prepared')) then
    raise exception 'prepared request in combined schedule';
  end if;
  if (select count(*) from public.my_organization_schedule((select id from f03 where k='org2'), '2027-05-01', '2027-05-31')) <> 1 then
    raise exception 'second organization not readable by its member';
  end if;
end $$;

-- Riley (not in org2, not opted in) gets nothing from org2.
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
do $$ begin
  begin
    insert into public.user_schedule_settings (user_id, combined_schedule) values ('44444444-4444-4444-8444-444444444444', true);
    perform * from public.my_organization_schedule((select id from f03 where k='org2'), '2027-05-01', '2027-05-31');
    raise exception 'non-member read another organization';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.cross_organization_busy((select id from f03 where k='org'), array[(select id from f03 where k='sam')], '2027-05-01', '2027-05-31');
    raise exception 'member read cross-org busy';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.user_schedule_settings set share_busy_across_orgs = false where user_id = '33333333-3333-4333-8333-333333333333';
    if found then raise exception 'changed someone else''s settings'; end if;
  end;
end $$;

-- The scheduler sees a bare interval: no title, reason or organization.
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
declare v_row record;
begin
  select * into v_row from public.cross_organization_busy((select id from f03 where k='org'), array[(select id from f03 where k='sam')], '2027-05-01', '2027-05-31');
  if v_row.person_id is null or v_row.starts_at <> '2027-05-09T13:00:00Z' then raise exception 'opted-in busy interval missing'; end if;
  if to_jsonb(v_row) ?| array['reason', 'title', 'organization_id', 'plan_id'] then raise exception 'busy interval leaked detail'; end if;
end $$;

reset role;
select 'f03 preferences/delegation: all checks passed';
rollback;
