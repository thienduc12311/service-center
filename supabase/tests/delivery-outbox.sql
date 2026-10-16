-- F00 delivery outbox: enqueue in the writer's transaction, idempotent effect
-- keys, one scheduler update for app and link answers, leased claims, retry
-- accounting, honest outcomes and access.
--
-- Run against a seeded local database:
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/delivery-outbox.sql
-- Everything runs inside one transaction and is rolled back.
begin;

-- Seed: org aaaa…01; Jordan 2222 scheduler, owner 1111, Sam 3333 and Riley
-- 4444 members; team cccc…01 with Sam's position dddd…03 and Riley's dddd…05.
create temporary table fixture on commit drop as
select gen_random_uuid() as plan_id;
grant select on fixture to authenticated, service_role;

insert into public.plans (id, organization_id, title, service_date, created_by)
select plan_id, 'aaaaaaaa-0000-4000-8000-000000000001', 'Outbox test', now() + interval '7 days',
       '22222222-2222-4222-8222-222222222222'
  from fixture;

-- A second organization the scheduler is not part of.
insert into public.organizations (id, name, slug, timezone)
values ('aaaaaaaa-0000-4000-8000-0000000000f0', 'Elsewhere', 'elsewhere-outbox-test', 'UTC');
insert into public.teams (id, organization_id, name)
values ('cccccccc-0000-4000-8000-0000000000f0', 'aaaaaaaa-0000-4000-8000-0000000000f0', 'Foreign team');

-- --------------------------------------------- scheduling enqueues ---------
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

do $$
declare n int;
begin
  -- A foreign team is refused and nothing is written.
  begin
    perform public.schedule_plan_assignments(
      (select plan_id from fixture),
      '[{"user_id":"33333333-3333-4333-8333-333333333333","team_id":"cccccccc-0000-4000-8000-0000000000f0"}]',
      true, 'test-foreign');
    raise exception 'a foreign team was accepted';
  exception when sqlstate '22023' then null;
  end;

  -- A position from another team is refused.
  begin
    perform public.schedule_plan_assignments(
      (select plan_id from fixture),
      '[{"user_id":"33333333-3333-4333-8333-333333333333","team_id":"cccccccc-0000-4000-8000-000000000002","position_id":"dddddddd-0000-4000-8000-000000000003"}]',
      true, 'test-mismatch');
    raise exception 'a position from another team was accepted';
  exception when sqlstate '22023' then null;
  end;

  select count(*) into n from public.schedule_plan_assignments(
    (select plan_id from fixture),
    '[{"user_id":"33333333-3333-4333-8333-333333333333","team_id":"cccccccc-0000-4000-8000-000000000001","position_id":"dddddddd-0000-4000-8000-000000000003"},
      {"user_id":"33333333-3333-4333-8333-333333333333","team_id":"cccccccc-0000-4000-8000-000000000001","position_id":"dddddddd-0000-4000-8000-000000000004"},
      {"user_id":"44444444-4444-4444-8444-444444444444","team_id":"cccccccc-0000-4000-8000-000000000001","position_id":"dddddddd-0000-4000-8000-000000000005"},
      {"user_id":"44444444-4444-4444-8444-444444444444","team_id":"cccccccc-0000-4000-8000-000000000001","position_id":"dddddddd-0000-4000-8000-000000000005"}]',
    true, 'test-schedule-1');
  if n <> 3 then raise exception 'expected 3 new assignments (duplicate row skipped), got %', n; end if;

  if (select count(*) from public.delivery_effects where effect_key = 'test-schedule-1') <> 1 then
    raise exception 'expected one effect for the scheduling action';
  end if;
  -- Two people, three channels each: Sam's two positions are one recipient.
  if (select count(*) from public.deliveries d join public.delivery_effects e on e.id = d.effect_id
       where e.effect_key = 'test-schedule-1') <> 6 then
    raise exception 'expected 2 recipients x 3 channels';
  end if;
  if exists (select 1 from public.deliveries d join public.delivery_effects e on e.id = d.effect_id
              where e.effect_key = 'test-schedule-1' and d.status <> 'queued') then
    raise exception 'new deliveries must start queued';
  end if;

  -- Re-saving the same people adds nothing and enqueues nothing.
  select count(*) into n from public.schedule_plan_assignments(
    (select plan_id from fixture),
    '[{"user_id":"33333333-3333-4333-8333-333333333333","team_id":"cccccccc-0000-4000-8000-000000000001","position_id":"dddddddd-0000-4000-8000-000000000003"}]',
    true, 'test-schedule-2');
  if n <> 0 or exists (select 1 from public.delivery_effects where effect_key = 'test-schedule-2') then
    raise exception 'a re-save created assignments or an effect';
  end if;

  -- The same reminder key twice is one effect.
  perform public.enqueue_plan_notifications((select plan_id from fixture), 'assignment_reminder',
    (select array_agg(id) from public.assignments where plan_id = (select plan_id from fixture)), 'test-reminder');
  perform public.enqueue_plan_notifications((select plan_id from fixture), 'assignment_reminder',
    (select array_agg(id) from public.assignments where plan_id = (select plan_id from fixture)), 'test-reminder');
  if (select count(*) from public.deliveries d join public.delivery_effects e on e.id = d.effect_id
       where e.effect_key = 'test-reminder') <> 6 then
    raise exception 'a repeated reminder key enqueued twice';
  end if;

  -- Clients never write the outbox directly.
  begin
    insert into public.deliveries (organization_id, effect_id, recipient_id, channel)
    select organization_id, id, '22222222-2222-4222-8222-222222222222', 'email'
      from public.delivery_effects where effect_key = 'test-reminder';
    raise exception 'a scheduler inserted a delivery directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.deliveries set status = 'delivered';
    raise exception 'a scheduler updated deliveries directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.delivery_attempts;
    raise exception 'attempt history is readable by a client';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ------------------------------------------- a member's access ------------
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';

do $$
begin
  if exists (select 1 from public.deliveries) or exists (select 1 from public.delivery_effects) then
    raise exception 'a member can read deliveries';
  end if;
  begin
    perform public.schedule_plan_assignments((select plan_id from fixture), '[]', true, 'test-member');
    raise exception 'a member scheduled people';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.enqueue_plan_notifications((select plan_id from fixture), 'assignment_reminder', '{}', 'test-member-2');
    raise exception 'a member sent a reminder';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    perform private.enqueue_assignment_requests((select plan_id from fixture), 'assignment_reminder', '{}', 'test-member-3', null);
    raise exception 'a member called the private enqueue';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------------------------------------- answers notify the scheduler ----
-- Signed-in decline (app path).
select 1 from public.respond_to_own_assignment(
  (select id from public.assignments where plan_id = (select plan_id from fixture)
     and position_id = 'dddddddd-0000-4000-8000-000000000003'),
  'declined', 'unconfirmed', 'Away');
-- Signed-in confirm of the other position.
select 1 from public.respond_to_own_assignment(
  (select id from public.assignments where plan_id = (select plan_id from fixture)
     and position_id = 'dddddddd-0000-4000-8000-000000000004'),
  'confirmed', 'unconfirmed');

reset role;

do $$
begin
  if (select count(*) from public.delivery_effects
       where plan_id = (select plan_id from fixture) and template = 'scheduler_response') <> 2 then
    raise exception 'expected one scheduler effect per answer';
  end if;
  -- Decline: feed, push and email to Jordan (who scheduled it).
  if (select array_agg(d.channel::text order by d.channel::text) from public.deliveries d
        join public.delivery_effects e on e.id = d.effect_id
       where e.plan_id = (select plan_id from fixture) and e.template = 'scheduler_response'
         and e.response_status = 'declined'
         and d.recipient_id = '22222222-2222-4222-8222-222222222222') <> array['email', 'in_app', 'push'] then
    raise exception 'a decline must reach the scheduler on feed, push and email';
  end if;
  -- Confirm: feed and push only.
  if (select array_agg(d.channel::text order by d.channel::text) from public.deliveries d
        join public.delivery_effects e on e.id = d.effect_id
       where e.plan_id = (select plan_id from fixture) and e.template = 'scheduler_response'
         and e.response_status = 'confirmed') <> array['in_app', 'push'] then
    raise exception 'a confirmation should not email the scheduler';
  end if;
end $$;

-- Public link decline for Riley: same rule, one effect, link single-use.
insert into public.assignment_notifications (organization_id, plan_id, user_id, email, token_hash, expires_at, created_by)
select 'aaaaaaaa-0000-4000-8000-000000000001', plan_id, '44444444-4444-4444-8444-444444444444',
       'riley@example.com', 'test-link-hash', now() + interval '1 day', '22222222-2222-4222-8222-222222222222'
  from fixture;

set local role service_role;
-- The API's service-role client carries no user.
set local request.jwt.claim.sub = '';
do $$
declare r record;
begin
  select * into r from public.respond_via_assignment_link('test-link-hash', 'declined');
  if r.outcome <> 'ok' or r.assignments_updated <> 1 or r.effect_id is null then
    raise exception 'link decline failed: %', r;
  end if;
  if (select array_agg(channel::text order by channel::text) from public.deliveries where effect_id = r.effect_id)
     <> array['email', 'in_app', 'push'] then
    raise exception 'link decline did not follow the scheduler-update rule';
  end if;
  select * into r from public.respond_via_assignment_link('test-link-hash', 'declined');
  if r.outcome <> 'used' then raise exception 'a used link answered again'; end if;
  select * into r from public.respond_via_assignment_link('no-such-hash', 'confirmed');
  if r.outcome <> 'not_found' then raise exception 'unknown link not reported'; end if;
end $$;

-- --------------------------------------------------------- worker ---------
do $$
declare
  a_ids uuid[];
  b_ids uuid[];
  d     public.deliveries;
  email public.deliveries;
begin
  -- Park everything else so the test sees only its own rows.
  update public.deliveries set next_attempt_at = now() + interval '1 year'
   where effect_id not in (select id from public.delivery_effects where effect_key = 'test-schedule-1');

  select array_agg(id) into a_ids from public.claim_deliveries('worker-a', 4, 60);
  select array_agg(id) into b_ids from public.claim_deliveries('worker-b', 10, 60);
  if cardinality(a_ids) <> 4 or cardinality(b_ids) <> 2 or a_ids && b_ids then
    raise exception 'claims overlapped or missed rows: % / %', a_ids, b_ids;
  end if;
  if exists (select 1 from public.claim_deliveries('worker-c', 10, 60)) then
    raise exception 'leased rows were claimed again';
  end if;

  -- Accepted email marks Sam as notified; acceptance timestamp only then.
  select * into email from public.deliveries
   where id = any(a_ids || b_ids) and channel = 'email'
     and recipient_id = '33333333-3333-4333-8333-333333333333';
  if not public.begin_delivery_provider_call(email.id, email.lease_owner) then
    raise exception 'the lease holder could not start the provider call';
  end if;
  if public.begin_delivery_provider_call(email.id, 'someone-else') then
    raise exception 'a non-holder started the provider call';
  end if;
  d := public.complete_delivery(email.id, email.lease_owner, 'provider_accepted', null, 'msg-1');
  if d.status <> 'provider_accepted' or d.accepted_at is null or d.completed_at is null then
    raise exception 'accepted email not recorded: %', d;
  end if;
  if exists (select 1 from public.assignments where plan_id = (select plan_id from fixture)
              and user_id = '33333333-3333-4333-8333-333333333333' and notified_at is null) then
    raise exception 'accepted email did not mark the assignments notified';
  end if;
  if (select outcome from public.delivery_attempts where delivery_id = email.id) <> 'provider_accepted' then
    raise exception 'attempt history missing';
  end if;
  -- A second completion by a stale worker is ignored.
  if public.complete_delivery(email.id, email.lease_owner, 'failed', 'late') is not null then
    raise exception 'a completed delivery was completed again';
  end if;

  -- Simulated email for Riley: no acceptance timestamp, not marked notified.
  select * into email from public.deliveries
   where id = any(a_ids || b_ids) and channel = 'email'
     and recipient_id = '44444444-4444-4444-8444-444444444444';
  perform public.begin_delivery_provider_call(email.id, email.lease_owner);
  d := public.complete_delivery(email.id, email.lease_owner, 'simulated');
  if d.accepted_at is not null then raise exception 'a simulated send got an acceptance timestamp'; end if;
  if exists (select 1 from public.assignments where plan_id = (select plan_id from fixture)
              and user_id = '44444444-4444-4444-8444-444444444444' and notified_at is not null) then
    raise exception 'a simulated email marked someone notified';
  end if;

  -- Retryable failure: re-queued with backoff until attempts run out.
  select * into d from public.deliveries
   where id = any(a_ids || b_ids) and channel = 'push'
     and recipient_id = '33333333-3333-4333-8333-333333333333';
  d := public.complete_delivery(d.id, d.lease_owner, 'queued', 'provider_unavailable', null, 120);
  if d.status <> 'queued' or d.next_attempt_at < now() + interval '100 seconds' or d.accepted_at is not null then
    raise exception 'retryable failure not re-queued with backoff: %', d;
  end if;
  update public.deliveries set attempts = max_attempts - 1, next_attempt_at = now() where id = d.id;
  perform public.claim_deliveries('worker-a', 1, 60, d.effect_id);
  d := public.complete_delivery(d.id, 'worker-a', 'queued', 'provider_unavailable', null, 120);
  if d.status <> 'failed' then raise exception 'exhausted retries did not fail: %', d; end if;

  -- Lease recovery: never called the provider -> queued; called -> ambiguous.
  select * into d from public.deliveries
   where id = any(a_ids || b_ids) and channel = 'push'
     and recipient_id = '44444444-4444-4444-8444-444444444444';
  update public.deliveries set lease_expires_at = now() - interval '1 second' where id = d.id;
  select * into email from public.deliveries
   where id = any(a_ids || b_ids) and channel = 'in_app'
     and recipient_id = '44444444-4444-4444-8444-444444444444';
  update public.deliveries set lease_expires_at = now() - interval '1 second',
         provider_call_started_at = now() - interval '2 minutes' where id = email.id;
  update public.deliveries set next_attempt_at = now() + interval '1 year' where id <> d.id and status = 'queued';
  perform public.claim_deliveries('worker-recover', 10, 60);
  if (select status from public.deliveries where id = email.id) <> 'ambiguous'
     or (select last_error_code from public.deliveries where id = email.id) <> 'outcome_unknown' then
    raise exception 'an interrupted provider call was not marked ambiguous';
  end if;
  if (select lease_owner from public.deliveries where id = d.id) <> 'worker-recover' then
    raise exception 'a lease that expired before the provider call was not re-claimed';
  end if;
end $$;

-- -------------------------------------------- administrator retry ---------
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
begin
  begin
    perform public.retry_delivery((select id from public.deliveries where status = 'ambiguous' limit 1));
    raise exception 'a scheduler (not admin) retried a delivery';
  exception when sqlstate 'P0002' then null;
  end;
end $$;

set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$
declare d public.deliveries; again public.deliveries;
begin
  d := public.retry_delivery((select id from public.deliveries where status = 'ambiguous' limit 1));
  if d.status <> 'queued' or d.max_attempts <> d.attempts + 1 or d.manual_retries <> 1 then
    raise exception 'retry did not re-queue one more attempt: %', d;
  end if;
  again := public.retry_delivery(d.id);
  if again.manual_retries <> 1 then raise exception 'a repeated retry queued another attempt'; end if;
  begin
    perform public.retry_delivery((select id from public.deliveries where status = 'provider_accepted' limit 1));
    raise exception 'an accepted delivery was retried';
  exception when sqlstate 'PT409' then null;
  end;
end $$;

reset role;
rollback;
