-- MOB-005 follow-up: a sent request can be removed by its scheduler, and
-- snapshots/links issued before the removal stop answering the removed
-- request while still answering what remains. Everything rolls back.
begin;

create temporary table rm_fx (k text primary key, id uuid) on commit drop;
grant select, insert, update on rm_fx to authenticated, service_role;

insert into rm_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('team', 'cccccccc-0000-4000-8000-000000000001'),
  ('sam_person', (select id from public.people where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' and profile_id = '33333333-3333-4333-8333-333333333333')),
  ('plan', gen_random_uuid()),
  ('service', gen_random_uuid()),
  ('guest', gen_random_uuid());

insert into public.people (id, organization_id, first_name, email)
values ((select id from rm_fx where k = 'guest'), (select id from rm_fx where k = 'org'), 'No Login', 'rm-guest@example.test');
insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by)
values ((select id from rm_fx where k = 'plan'), (select id from rm_fx where k = 'org'),
        'bbbbbbbb-0000-4000-8000-000000000001', 'MOB-005 removal', now() + interval '30 days',
        'published', '22222222-2222-4222-8222-222222222222');
insert into public.plan_times (id, plan_id, kind, name, starts_at, ends_at, sort_order) values
  ((select id from rm_fx where k = 'service'), (select id from rm_fx where k = 'plan'), 'service', '09:00 service',
   now() + interval '30 days', now() + interval '30 days 1 hour', 0);

set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

-- Sam gets two requests, the no-login guest one; all are sent together.
select id from public.schedule_plan_assignments(
  (select id from rm_fx where k = 'plan'),
  jsonb_build_array(
    jsonb_build_object('person_id', (select id from rm_fx where k = 'sam_person'),
      'team_id', (select id from rm_fx where k = 'team'),
      'position_id', 'dddddddd-0000-4000-8000-000000000003',
      'visibility', 'prepared', 'attendance_mode', 'all'),
    jsonb_build_object('person_id', (select id from rm_fx where k = 'sam_person'),
      'team_id', (select id from rm_fx where k = 'team'),
      'position_id', 'dddddddd-0000-4000-8000-000000000004',
      'visibility', 'prepared', 'attendance_mode', 'all'),
    jsonb_build_object('person_id', (select id from rm_fx where k = 'guest'),
      'team_id', (select id from rm_fx where k = 'team'),
      'position_id', 'dddddddd-0000-4000-8000-000000000003',
      'visibility', 'prepared', 'attendance_mode', 'all')
  ), false, 'rm-schedule'
);

insert into rm_fx
select case when person_id = (select id from rm_fx where k = 'guest') then 'guest_assignment'
            when position_id = 'dddddddd-0000-4000-8000-000000000003' then 'kept_assignment'
            else 'removed_assignment' end, id
  from public.assignments where plan_id = (select id from rm_fx where k = 'plan');

select 1 from public.release_plan_assignments_versioned(
  (select id from rm_fx where k = 'plan'),
  (select array_agg(id) from rm_fx where k like '%_assignment'),
  (select jsonb_agg(jsonb_build_object('assignment_id', a.id, 'request_revision', a.request_revision))
     from public.assignments a where a.plan_id = (select id from rm_fx where k = 'plan')),
  true, 'rm-release'
);

reset role;
reset request.jwt.claim.sub;
insert into rm_fx
select case when s.person_id = (select id from rm_fx where k = 'guest') then 'guest_snapshot' else 'sam_snapshot' end, s.id
  from public.assignment_request_snapshots s
  join public.delivery_effects e on e.id = s.effect_id
 where e.effect_key = 'rm-release';

insert into public.assignment_notifications (
  organization_id, plan_id, person_id, user_id, snapshot_id, email, token_hash, expires_at, created_by
) values
  ((select id from rm_fx where k = 'org'), (select id from rm_fx where k = 'plan'),
   (select id from rm_fx where k = 'sam_person'), '33333333-3333-4333-8333-333333333333',
   (select id from rm_fx where k = 'sam_snapshot'), 'sam@example.com', 'rm-sam-token', now() + interval '1 day',
   '22222222-2222-4222-8222-222222222222'),
  ((select id from rm_fx where k = 'org'), (select id from rm_fx where k = 'plan'),
   (select id from rm_fx where k = 'guest'), null,
   (select id from rm_fx where k = 'guest_snapshot'), 'rm-guest@example.test', 'rm-guest-token', now() + interval '1 day',
   '22222222-2222-4222-8222-222222222222');

do $$ begin
  if (select count(*) from public.assignment_request_snapshot_items
       where snapshot_id = (select id from rm_fx where k = 'sam_snapshot')) <> 2 then
    raise exception 'fixture: Sam''s sent request should cover two assignments';
  end if;
end $$;

-- Sam reviews both requests in the app before the scheduler withdraws one.
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
select id from public.preview_assignment_responses(
  (select id from rm_fx where k = 'org'),
  array[(select id from rm_fx where k = 'kept_assignment'), (select id from rm_fx where k = 'removed_assignment')]
);
insert into rm_fx
select 'review_snapshot', id from public.assignment_request_snapshots
 where person_id = (select id from rm_fx where k = 'sam_person')
   and plan_id = (select id from rm_fx where k = 'plan') and effect_id is null
 order by created_at desc limit 1;

-- The recipient themself cannot remove a request.
do $$ declare n int; begin
  delete from public.assignments where id = (select id from rm_fx where k = 'removed_assignment');
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'recipient removed their own sent request'; end if;
end $$;

-- The scheduler can remove sent requests (this was a 23503 before the fix).
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$ declare n int; begin
  delete from public.assignments
   where id in ((select id from rm_fx where k = 'removed_assignment'), (select id from rm_fx where k = 'guest_assignment'));
  get diagnostics n = row_count;
  if n <> 2 then raise exception 'scheduler removed % of 2 sent requests', n; end if;
end $$;

reset role;
reset request.jwt.claim.sub;
do $$ begin
  if exists (select 1 from public.assignments
              where id in (select id from rm_fx where k in ('removed_assignment', 'guest_assignment'))) then
    raise exception 'removed requests still exist';
  end if;
  -- Live snapshots that keep a request are re-versioned, not superseded.
  if (select row(version, superseded_at is null) from public.assignment_request_snapshots
       where id = (select id from rm_fx where k = 'sam_snapshot')) <> row(2::bigint, true)
     or (select row(version, superseded_at is null) from public.assignment_request_snapshots
       where id = (select id from rm_fx where k = 'review_snapshot')) <> row(2::bigint, true) then
    raise exception 'live snapshot was not re-versioned after a removal';
  end if;
  if (select array_agg(assignment_id) from public.assignment_request_snapshot_items
       where snapshot_id = (select id from rm_fx where k = 'sam_snapshot'))
     <> array[(select id from rm_fx where k = 'kept_assignment')] then
    raise exception 'removed request is still in the live snapshot';
  end if;
  -- A snapshot left with nothing to answer is superseded.
  if (select superseded_at from public.assignment_request_snapshots
       where id = (select id from rm_fx where k = 'guest_snapshot')) is null then
    raise exception 'emptied snapshot was not superseded';
  end if;
end $$;

-- A review taken before the removal is refused, as is answering the removed
-- request against the new version; neither leaves any answer behind.
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$ begin
  begin
    perform public.respond_to_assignment_snapshots(
      (select id from rm_fx where k = 'org'),
      jsonb_build_array(jsonb_build_object(
        'snapshot_id', (select id from rm_fx where k = 'review_snapshot'), 'version', 1,
        'answers', jsonb_build_array(
          jsonb_build_object('assignment_id', (select id from rm_fx where k = 'kept_assignment'),
            'plan_time_id', (select id from rm_fx where k = 'service'), 'status', 'confirmed', 'reason', null),
          jsonb_build_object('assignment_id', (select id from rm_fx where k = 'removed_assignment'),
            'plan_time_id', (select id from rm_fx where k = 'service'), 'status', 'confirmed', 'reason', null)
        )
      )), 'rm-stale-review'
    );
    raise exception 'review from before the removal was accepted';
  exception when sqlstate 'PT409' then null;
  end;
  begin
    perform public.respond_to_assignment_snapshots(
      (select id from rm_fx where k = 'org'),
      jsonb_build_array(jsonb_build_object(
        'snapshot_id', (select id from rm_fx where k = 'review_snapshot'), 'version', 2,
        'answers', jsonb_build_array(
          jsonb_build_object('assignment_id', (select id from rm_fx where k = 'kept_assignment'),
            'plan_time_id', (select id from rm_fx where k = 'service'), 'status', 'confirmed', 'reason', null),
          jsonb_build_object('assignment_id', (select id from rm_fx where k = 'removed_assignment'),
            'plan_time_id', (select id from rm_fx where k = 'service'), 'status', 'confirmed', 'reason', null)
        )
      )), 'rm-removed-answer'
    );
    raise exception 'an answer to the removed request was accepted';
  exception when sqlstate 'PT409' then null;
  end;
  begin
    perform public.preview_assignment_responses(
      (select id from rm_fx where k = 'org'),
      array[(select id from rm_fx where k = 'removed_assignment')]
    );
    raise exception 'removed request could still be previewed';
  exception when sqlstate 'PT409' then null;
  end;
end $$;

reset role;
reset request.jwt.claim.sub;
do $$ declare r record; begin
  if (select status from public.assignments where id = (select id from rm_fx where k = 'kept_assignment')) <> 'unconfirmed' then
    raise exception 'a refused response changed the remaining request';
  end if;

  -- The emailed link issued before the removal answers only what remains.
  select * into r from public.respond_via_assignment_link('rm-sam-token', 'confirmed');
  if r.outcome <> 'ok' or r.assignments_updated <> 1 then
    raise exception 'link did not answer the remaining request: %', r;
  end if;
  if (select status from public.assignments where id = (select id from rm_fx where k = 'kept_assignment')) <> 'confirmed' then
    raise exception 'remaining request was not confirmed by the link';
  end if;

  -- A link whose only request was removed no longer answers anything.
  select * into r from public.respond_via_assignment_link('rm-guest-token', 'confirmed');
  if r.outcome <> 'stale' or r.assignments_updated <> 0 then
    raise exception 'link answered a removed request: %', r;
  end if;
end $$;

-- An answered request can be removed too; the consumed snapshot keeps its
-- audit header (who, which plan, when it was answered) unchanged.
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$ declare n int; begin
  delete from public.assignments where id = (select id from rm_fx where k = 'kept_assignment');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'answered request could not be removed'; end if;
end $$;
reset role;
reset request.jwt.claim.sub;
do $$ begin
  if (select row(version, consumed_at is not null, superseded_at is null) from public.assignment_request_snapshots
       where id = (select id from rm_fx where k = 'sam_snapshot')) <> row(2::bigint, true, true) then
    raise exception 'consumed snapshot audit header changed on removal';
  end if;
end $$;

-- Removing the whole plan still works with links and snapshots in place.
delete from public.plans where id = (select id from rm_fx where k = 'plan');
do $$ begin
  if exists (select 1 from public.assignment_request_snapshots where plan_id = (select id from rm_fx where k = 'plan')) then
    raise exception 'plan removal left snapshots behind';
  end if;
end $$;

rollback;
