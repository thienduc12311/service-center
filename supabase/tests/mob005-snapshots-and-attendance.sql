-- MOB-005 Person identity, exact attendance and versioned response snapshots.
-- Run against a seeded local database. Everything rolls back.
begin;

create temporary table mob005_fx (k text primary key, id uuid) on commit drop;
grant select, insert, update on mob005_fx to authenticated, service_role;

insert into mob005_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('team', 'cccccccc-0000-4000-8000-000000000001'),
  ('sam_person', (select id from public.people where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' and profile_id = '33333333-3333-4333-8333-333333333333')),
  ('plan', gen_random_uuid()),
  ('rehearsal', gen_random_uuid()),
  ('service', gen_random_uuid()),
  ('late_service', gen_random_uuid()),
  ('guest', gen_random_uuid());

insert into public.people (id, organization_id, first_name, email)
values ((select id from mob005_fx where k = 'guest'), (select id from mob005_fx where k = 'org'), 'No Login', 'nologin@example.test');

insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by)
values ((select id from mob005_fx where k = 'plan'), (select id from mob005_fx where k = 'org'),
        'bbbbbbbb-0000-4000-8000-000000000001', 'MOB-005 exact request', now() + interval '30 days',
        'published', '22222222-2222-4222-8222-222222222222');
insert into public.plan_times (id, plan_id, kind, name, starts_at, ends_at, sort_order) values
  ((select id from mob005_fx where k = 'rehearsal'), (select id from mob005_fx where k = 'plan'), 'rehearsal', 'Friday rehearsal', now() + interval '28 days', now() + interval '28 days 2 hours', 0),
  ((select id from mob005_fx where k = 'service'), (select id from mob005_fx where k = 'plan'), 'service', '09:00 service', now() + interval '30 days', now() + interval '30 days 1 hour', 1),
  ((select id from mob005_fx where k = 'late_service'), (select id from mob005_fx where k = 'plan'), 'service', '11:00 service', now() + interval '30 days 2 hours', now() + interval '30 days 3 hours', 2);

-- Migration is idempotently Person-first: each linked membership has one row.
do $$ begin
  if exists (
    select organization_id, profile_id from public.people where profile_id is not null
    group by organization_id, profile_id having count(*) <> 1
  ) then raise exception 'linked membership has duplicate Person rows'; end if;
end $$;

set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

-- A linked Person and a no-login Person can be scheduled in one operation.
select id from public.schedule_plan_assignments(
  (select id from mob005_fx where k = 'plan'),
  jsonb_build_array(
    jsonb_build_object(
      'person_id', (select id from mob005_fx where k = 'sam_person'),
      'team_id', (select id from mob005_fx where k = 'team'),
      'position_id', 'dddddddd-0000-4000-8000-000000000003',
      'visibility', 'prepared', 'attendance_mode', 'selected',
      'time_ids', jsonb_build_array((select id from mob005_fx where k = 'rehearsal'), (select id from mob005_fx where k = 'service'))
    ),
    jsonb_build_object(
      'person_id', (select id from mob005_fx where k = 'guest'),
      'team_id', (select id from mob005_fx where k = 'team'),
      'position_id', 'dddddddd-0000-4000-8000-000000000004',
      'visibility', 'released', 'attendance_mode', 'all'
    )
  ), false, 'mob005-schedule'
);

insert into mob005_fx
select 'sam_assignment', id from public.assignments
 where plan_id = (select id from mob005_fx where k = 'plan')
   and person_id = (select id from mob005_fx where k = 'sam_person');
insert into mob005_fx
select 'guest_assignment', id from public.assignments
 where plan_id = (select id from mob005_fx where k = 'plan')
   and person_id = (select id from mob005_fx where k = 'guest');

do $$ begin
  if (select user_id from public.assignments where id = (select id from mob005_fx where k = 'guest_assignment')) is not null then
    raise exception 'no-login assignment acquired a Profile';
  end if;
  if (select array_agg(plan_time_id order by plan_time_id) from public.assignment_attendance_times
       where assignment_id = (select id from mob005_fx where k = 'sam_assignment'))
     <> (select array_agg(id order by id) from mob005_fx where k in ('rehearsal', 'service')) then
    raise exception 'selected attendance scope is not exact/stable';
  end if;
end $$;

-- Selected time references cannot be silently deleted by a full-list edit.
do $$ begin
  begin
    perform public.replace_plan_times(
      (select id from mob005_fx where k = 'plan'),
      jsonb_build_array(
        jsonb_build_object('id', (select id from mob005_fx where k = 'service'), 'kind', 'service',
          'starts_at', now() + interval '30 days', 'ends_at', now() + interval '30 days 1 hour', 'sort_order', 0),
        jsonb_build_object('id', (select id from mob005_fx where k = 'late_service'), 'kind', 'service',
          'starts_at', now() + interval '30 days 2 hours', 'ends_at', now() + interval '30 days 3 hours', 'sort_order', 1)
      ), null
    );
    raise exception 'referenced rehearsal was deleted without review';
  exception when sqlstate 'PT409' then null;
  end;
end $$;

-- A recipient cannot discover a prepared request through direct SQL.
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$ begin
  if exists (select 1 from public.assignments where id = (select id from mob005_fx where k = 'sam_assignment')) then
    raise exception 'recipient discovered prepared assignment';
  end if;
end $$;

-- Release is revision-checked, and snapshot/outbox creation is in the same
-- transaction. A bad revision rolls back release and creates no effect.
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$ begin
  begin
    perform public.release_plan_assignments_versioned(
      (select id from mob005_fx where k = 'plan'),
      array[(select id from mob005_fx where k = 'sam_assignment')],
      jsonb_build_array(jsonb_build_object('assignment_id', (select id from mob005_fx where k = 'sam_assignment'), 'request_revision', 999)),
      true, 'mob005-bad-release'
    );
    raise exception 'stale release succeeded';
  exception when sqlstate 'PT409' then null;
  end;
  if exists (select 1 from public.delivery_effects where effect_key = 'mob005-bad-release')
     or (select visibility from public.assignments where id = (select id from mob005_fx where k = 'sam_assignment')) <> 'prepared' then
    raise exception 'failed release left state/effect behind';
  end if;
end $$;

select 1 from public.release_plan_assignments_versioned(
  (select id from mob005_fx where k = 'plan'),
  array[(select id from mob005_fx where k = 'sam_assignment')],
  jsonb_build_array(jsonb_build_object(
    'assignment_id', (select id from mob005_fx where k = 'sam_assignment'),
    'request_revision', (select request_revision from public.assignments where id = (select id from mob005_fx where k = 'sam_assignment'))
  )), true, 'mob005-release'
);

insert into mob005_fx
select 'snapshot', s.id from public.assignment_request_snapshots s
join public.delivery_effects e on e.id = s.effect_id
where e.effect_key = 'mob005-release';

do $$ begin
  if (select plan_time_ids from public.assignment_request_snapshot_items
       where snapshot_id = (select id from mob005_fx where k = 'snapshot'))
     <> array[(select id from mob005_fx where k = 'rehearsal'), (select id from mob005_fx where k = 'service')] then
    raise exception 'release snapshot did not preserve exact attendance scope';
  end if;
  if (select count(*) from public.deliveries d join public.delivery_effects e on e.id = d.effect_id
       where e.effect_key = 'mob005-release') <> 3 then
    raise exception 'linked Person did not receive one delivery per channel';
  end if;
end $$;

-- Add another assignment after release. It must be outside the old snapshot.
select id from public.schedule_plan_assignments(
  (select id from mob005_fx where k = 'plan'),
  jsonb_build_array(jsonb_build_object(
    'person_id', (select id from mob005_fx where k = 'sam_person'),
    'team_id', (select id from mob005_fx where k = 'team'),
    'position_id', 'dddddddd-0000-4000-8000-000000000004',
    'visibility', 'released', 'attendance_mode', 'selected',
    'time_ids', jsonb_build_array((select id from mob005_fx where k = 'late_service'))
  )), false, 'mob005-later'
);
insert into mob005_fx
select 'later_assignment', id from public.assignments
 where plan_id = (select id from mob005_fx where k = 'plan')
   and person_id = (select id from mob005_fx where k = 'sam_person')
   and position_id = 'dddddddd-0000-4000-8000-000000000004';

reset role;
reset request.jwt.claim.sub;
insert into public.assignment_notifications (
  organization_id, plan_id, person_id, user_id, snapshot_id, email, token_hash, expires_at, created_by
) values (
  (select id from mob005_fx where k = 'org'), (select id from mob005_fx where k = 'plan'),
  (select id from mob005_fx where k = 'sam_person'), '33333333-3333-4333-8333-333333333333',
  (select id from mob005_fx where k = 'snapshot'), 'sam@example.com', 'mob005-token', now() + interval '1 day',
  '22222222-2222-4222-8222-222222222222'
);

do $$ declare r record; begin
  select * into r from public.respond_via_assignment_link('mob005-token', 'confirmed');
  if r.outcome <> 'ok' or r.assignments_updated <> 1 then raise exception 'exact public response failed: %', r; end if;
  if (select status from public.assignments where id = (select id from mob005_fx where k = 'sam_assignment')) <> 'confirmed'
     or (select status from public.assignments where id = (select id from mob005_fx where k = 'later_assignment')) <> 'unconfirmed' then
    raise exception 'public response expanded beyond snapshot';
  end if;
  select * into r from public.respond_via_assignment_link('mob005-token', 'confirmed');
  if r.outcome <> 'used' then raise exception 'public token replay was not rejected'; end if;
end $$;

-- A signed-in split response uses one atomic immutable review and persists
-- different answers for rehearsal/service while retaining aggregate history.
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$ begin
  begin
    perform public.preview_assignment_responses(
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      array[(select id from mob005_fx where k = 'sam_assignment')]
    );
    raise exception 'response preview crossed the active organization boundary';
  exception when sqlstate 'PT409' then null;
  end;
end $$;
select id from public.preview_assignment_responses(
  (select id from mob005_fx where k = 'org'),
  array[(select id from mob005_fx where k = 'sam_assignment')]
);
insert into mob005_fx
select 'split_snapshot', id from public.assignment_request_snapshots
 where person_id = (select id from mob005_fx where k = 'sam_person')
   and plan_id = (select id from mob005_fx where k = 'plan')
   and effect_id is null and consumed_at is null
 order by created_at desc limit 1;

select public.respond_to_assignment_snapshots(
  (select id from mob005_fx where k = 'org'),
  jsonb_build_array(jsonb_build_object(
    'snapshot_id', (select id from mob005_fx where k = 'split_snapshot'), 'version', 1,
    'answers', jsonb_build_array(
      jsonb_build_object(
        'assignment_id', (select id from mob005_fx where k = 'sam_assignment'),
        'plan_time_id', (select id from mob005_fx where k = 'rehearsal'),
        'status', 'confirmed', 'reason', null
      ),
      jsonb_build_object(
        'assignment_id', (select id from mob005_fx where k = 'sam_assignment'),
        'plan_time_id', (select id from mob005_fx where k = 'service'),
        'status', 'declined', 'reason', 'Only rehearsal works'
      )
    )
  )), 'mob005-split-response'
);

do $$ begin
  if (select status from public.assignment_time_responses
       where assignment_id = (select id from mob005_fx where k = 'sam_assignment')
         and plan_time_id = (select id from mob005_fx where k = 'service')) <> 'declined'
     or (select status from public.assignment_time_responses
       where assignment_id = (select id from mob005_fx where k = 'sam_assignment')
         and plan_time_id = (select id from mob005_fx where k = 'rehearsal')) <> 'confirmed' then
    raise exception 'per-time answer was not stored';
  end if;
  if not exists (select 1 from public.assignment_time_response_history
                  where assignment_id = (select id from mob005_fx where k = 'sam_assignment')
                    and response_note = 'Only rehearsal works') then
    raise exception 'per-time response history/reason missing';
  end if;
  if not exists (
    select 1 from public.delivery_effects
     where effect_key like 'assignment-batch-response:mob005-split-response:%:declined'
       and response_transition = 'withdrawal'
  ) then raise exception 'confirmed-to-declined split did not record a withdrawal effect'; end if;
end $$;

-- An authenticated review spanning multiple requests is all-or-nothing. A
-- scheduler change after preview makes the complete batch stale; none of the
-- otherwise-valid answers or history rows may survive the failed statement.
select id from public.preview_assignment_responses((select id from mob005_fx where k = 'org'), array[
  (select id from mob005_fx where k = 'sam_assignment'),
  (select id from mob005_fx where k = 'later_assignment')
]);
insert into mob005_fx
select 'stale_batch_snapshot', id from public.assignment_request_snapshots
 where person_id = (select id from mob005_fx where k = 'sam_person')
   and plan_id = (select id from mob005_fx where k = 'plan')
   and effect_id is null and consumed_at is null
 order by created_at desc limit 1;

reset role;
reset request.jwt.claim.sub;
update public.assignments set notes = 'changed after review'
 where id = (select id from mob005_fx where k = 'later_assignment');

set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$
declare
  v_answers jsonb;
  v_history_before bigint;
begin
  select count(*) into v_history_before from public.assignment_time_response_history;
  select jsonb_agg(jsonb_build_object(
    'assignment_id', i.assignment_id,
    'plan_time_id', scope.time_id,
    'status', 'declined',
    'reason', 'Atomic stale test'
  ) order by i.assignment_id, scope.time_id)
    into v_answers
    from public.assignment_request_snapshot_items i
    cross join lateral unnest(
      case when cardinality(i.plan_time_ids) = 0 then array[null::uuid] else i.plan_time_ids end
    ) scope(time_id)
   where i.snapshot_id = (select id from mob005_fx where k = 'stale_batch_snapshot');

  begin
    perform public.respond_to_assignment_snapshots(
      (select id from mob005_fx where k = 'org'),
      jsonb_build_array(jsonb_build_object(
        'snapshot_id', (select id from mob005_fx where k = 'stale_batch_snapshot'),
        'version', 1,
        'answers', v_answers
      )),
      'mob005-stale-batch'
    );
    raise exception 'stale batch succeeded';
  exception when sqlstate 'PT409' then null;
  end;

  if (select count(*) from public.assignment_time_response_history) <> v_history_before
     or (select consumed_at from public.assignment_request_snapshots
          where id = (select id from mob005_fx where k = 'stale_batch_snapshot')) is not null
     or exists (select 1 from public.assignment_response_operations where idempotency_key = 'mob005-stale-batch') then
    raise exception 'stale batch left answers, consumption, history, or idempotency state behind';
  end if;
end $$;

-- A declined answer is terminal until a scheduler issues a new request; the
-- snapshot path must not silently resurrect it to confirmed.
reset role;
reset request.jwt.claim.sub;
update public.assignments set status = 'declined'
 where id = (select id from mob005_fx where k = 'later_assignment');
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
select id from public.preview_assignment_responses(
  (select id from mob005_fx where k = 'org'),
  array[(select id from mob005_fx where k = 'later_assignment')]
);
insert into mob005_fx
select 'declined_snapshot', id from public.assignment_request_snapshots
 where person_id = (select id from mob005_fx where k = 'sam_person')
   and plan_id = (select id from mob005_fx where k = 'plan')
   and effect_id is null and consumed_at is null
 order by created_at desc limit 1;
do $$ begin
  begin
    perform public.respond_to_assignment_snapshots(
      (select id from mob005_fx where k = 'org'),
      jsonb_build_array(jsonb_build_object(
        'snapshot_id', (select id from mob005_fx where k = 'declined_snapshot'),
        'version', 1,
        'answers', jsonb_build_array(jsonb_build_object(
          'assignment_id', (select id from mob005_fx where k = 'later_assignment'),
          'plan_time_id', (select id from mob005_fx where k = 'late_service'),
          'status', 'confirmed', 'reason', null
        ))
      )), 'mob005-no-resurrection'
    );
    raise exception 'declined request was resurrected';
  exception when sqlstate 'PT409' then null;
  end;
  if (select status from public.assignments where id = (select id from mob005_fx where k = 'later_assignment')) <> 'declined' then
    raise exception 'declined request changed after rejected resurrection';
  end if;
end $$;

-- Exact conflict intervals include rehearsal/other attendance, use half-open
-- ranges at touching boundaries, preserve gaps between services, and exclude
-- only the named same-plan assignment rather than the entire plan.
reset role;
reset request.jwt.claim.sub;
insert into mob005_fx values
  ('overlap_plan', gen_random_uuid()),
  ('overlap_time', gen_random_uuid()),
  ('boundary_plan', gen_random_uuid()),
  ('boundary_time', gen_random_uuid()),
  ('same_plan_collision', gen_random_uuid());
insert into public.plans (id, organization_id, service_type_id, title, service_date, status) values
  ((select id from mob005_fx where k = 'overlap_plan'), (select id from mob005_fx where k = 'org'),
   'bbbbbbbb-0000-4000-8000-000000000001', 'Rehearsal overlap', now() + interval '28 days', 'published'),
  ((select id from mob005_fx where k = 'boundary_plan'), (select id from mob005_fx where k = 'org'),
   'bbbbbbbb-0000-4000-8000-000000000001', 'Touching boundary', now() + interval '30 days', 'published');
insert into public.plan_times (id, plan_id, kind, starts_at, ends_at) values
  ((select id from mob005_fx where k = 'overlap_time'), (select id from mob005_fx where k = 'overlap_plan'), 'rehearsal',
   (select starts_at + interval '30 minutes' from public.plan_times where id = (select id from mob005_fx where k = 'rehearsal')),
   (select starts_at + interval '90 minutes' from public.plan_times where id = (select id from mob005_fx where k = 'rehearsal'))),
  ((select id from mob005_fx where k = 'boundary_time'), (select id from mob005_fx where k = 'boundary_plan'), 'service',
   (select starts_at - interval '1 hour' from public.plan_times where id = (select id from mob005_fx where k = 'service')),
   (select starts_at from public.plan_times where id = (select id from mob005_fx where k = 'service')));
insert into public.assignments (
  plan_id, person_id, user_id, team_id, position_id, status, visibility, attendance_mode
)
select plan_id, (select id from mob005_fx where k = 'sam_person'), '33333333-3333-4333-8333-333333333333',
       (select id from mob005_fx where k = 'team'), null, 'confirmed', 'released', 'all'
  from (values
    ((select id from mob005_fx where k = 'overlap_plan')),
    ((select id from mob005_fx where k = 'boundary_plan'))
  ) plans(plan_id);
insert into public.assignments (
  id, plan_id, person_id, user_id, team_id, position_id, status, visibility, attendance_mode
) values (
  (select id from mob005_fx where k = 'same_plan_collision'),
  (select id from mob005_fx where k = 'plan'),
  (select id from mob005_fx where k = 'sam_person'),
  '33333333-3333-4333-8333-333333333333',
  'cccccccc-0000-4000-8000-000000000002',
  'dddddddd-0000-4000-8000-000000000007',
  'confirmed', 'released', 'selected'
);
insert into public.assignment_attendance_times (assignment_id, plan_time_id)
values ((select id from mob005_fx where k = 'same_plan_collision'), (select id from mob005_fx where k = 'service'));

set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
declare v_excluded uuid[];
begin
  select array_agg(id) into v_excluded from public.assignments
   where plan_id = (select id from mob005_fx where k = 'plan');
  if not exists (
    select 1 from public.scheduling_conflicts_for_people(
      (select id from mob005_fx where k = 'org'),
      array[(select id from mob005_fx where k = 'sam_person')],
      array[(select id from mob005_fx where k = 'rehearsal')],
      v_excluded
    ) where plan_id = (select id from mob005_fx where k = 'overlap_plan')
  ) then raise exception 'rehearsal-only overlap was missed'; end if;

  if exists (
    select 1 from public.scheduling_conflicts_for_people(
      (select id from mob005_fx where k = 'org'),
      array[(select id from mob005_fx where k = 'sam_person')],
      array[(select id from mob005_fx where k = 'service')],
      v_excluded
    ) where plan_id = (select id from mob005_fx where k = 'boundary_plan')
  ) then raise exception 'touching half-open boundary was treated as overlap'; end if;

  if (select count(*) from public.scheduling_conflicts_for_people(
      (select id from mob005_fx where k = 'org'),
      array[(select id from mob005_fx where k = 'sam_person')],
      array[(select id from mob005_fx where k = 'service')],
      array[(select id from mob005_fx where k = 'sam_assignment')]
    ) where plan_id = (select id from mob005_fx where k = 'plan')) <> 1 then
    raise exception 'same-plan exclusion hid another obligation or bridged the gap to the late service';
  end if;
end $$;

rollback;
