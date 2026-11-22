-- W10-CD-D1 (product decision: block): a plan time edit or bulk reschedule
-- that would put an assigned Person in two overlapping commitments is refused
-- like creating that assignment would be.
--
-- Before: apply_plan_time_changes moved plan_times without re-checking the
-- requests riding on them (the F04 conflict trigger fires on assignment and
-- selected-time writes only), so PATCH /plans/:id times and
-- POST /plans/reschedule double-booked people with only a preview warning.
--
-- Now:
--   * private.enforce_time_change_conflicts re-checks each moved request with
--     the same rules and audit as private.enforce_assignment_conflicts:
--     blocking conflicts -> PT409 hint scheduling_conflict (409, detail = the
--     redacted conflicts, message names the People); with
--     `f04.conflict_override_reason` set it needs scheduling.override_conflicts
--     (else 42501 -> 403) and writes assignment_conflict_overrides.
--   * apply_plan_time_changes calls it for the requests whose attendance moved.
--   * reschedule_plans defers the check until every plan in the batch has
--     moved, then checks each moved plan's requests with its reason.
--   * update_plan_with_times takes p_conflict_override_reason (PATCH
--     /plans/:id `conflict_override_reason`). The old 8-argument signature is
--     dropped; the new parameter defaults to null so older API builds keep
--     working (and are refused on a conflict, as intended).
-- Bodies otherwise identical to 20261020000100 (apply_plan_time_changes),
-- 20261027000100 (reschedule_plans) and 20261127000800 (update_plan_with_times).

-- Re-checks requests whose attendance a time change moved, exactly as the
-- assignment conflict trigger (private.enforce_assignment_conflicts) does for
-- a new or widened request: blocking conflicts from private.attendance_conflicts,
-- the transaction-local `f04.conflict_override_reason`, the
-- scheduling.override_conflicts capability and the assignment_conflict_overrides
-- audit row. Every conflicting request is collected first so one 409 names
-- everyone; nothing is kept (the caller's transaction rolls back).
-- `p_time_ids` limits the check to the plan times that moved or were added,
-- so an overlap that already stood (and may have been overridden) on an
-- untouched time does not block an unrelated edit; null checks every time.
create or replace function private.enforce_time_change_conflicts(p_plan uuid, p_assignment_ids uuid[], p_time_ids uuid[] default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_viewer    uuid := (select auth.uid());
  v_reason    text := nullif(btrim(coalesce(current_setting('f04.conflict_override_reason', true), '')), '');
  v_org       uuid;
  v_a         public.assignments;
  v_intervals jsonb;
  v_conflicts jsonb;
  v_all       jsonb := '[]'::jsonb;
  v_found     uuid[] := '{}';
  v_names     text;
  v_more      int;
begin
  -- Service-role maintenance is not a scheduling decision (as the trigger).
  if v_viewer is null or coalesce(cardinality(p_assignment_ids), 0) = 0 then return; end if;
  if current_setting('w10.defer_time_conflicts', true) = 'on' then return; end if;
  select organization_id into v_org from public.plans where id = p_plan;
  if v_org is null then return; end if;

  perform private.lock_scheduling_people(array(
    select a.person_id from public.assignments a where a.id = any(p_assignment_ids)));

  for v_a in
    select * from public.assignments a
     where a.id = any(p_assignment_ids) and a.plan_id = p_plan and a.status <> 'declined'
     order by a.id
  loop
    select jsonb_agg(jsonb_build_object('plan_time_id', v.plan_time_id,
                                        'starts_at', v.starts_at, 'ends_at', v.ends_at))
      into v_intervals
      from private.assignment_attendance v where v.assignment_id = v_a.id;
    continue when v_intervals is null;

    select coalesce(jsonb_agg(to_jsonb(c) - 'candidate_plan_id' - 'candidate_team_id')
                      filter (where c.severity = 'blocking'
                                and (p_time_ids is null or c.plan_time_id = any(p_time_ids))), '[]'::jsonb)
      into v_conflicts
      from private.attendance_conflicts(
        v_org, v_viewer,
        jsonb_build_array(jsonb_build_object(
          'key', v_a.id, 'person_id', v_a.person_id, 'plan_id', v_a.plan_id,
          'team_id', v_a.team_id, 'position_id', v_a.position_id, 'intervals', v_intervals)),
        array[v_a.id]) c;
    continue when jsonb_array_length(v_conflicts) = 0;

    v_all := v_all || v_conflicts;
    v_found := v_found || v_a.id;
    if v_reason is not null then
      if not private.can_override_conflicts(v_viewer, v_a.plan_id, v_a.team_id) then
        raise exception 'You cannot schedule over a conflict here' using errcode = '42501';
      end if;
      insert into public.assignment_conflict_overrides (
        organization_id, assignment_id, person_id, plan_id, team_id, conflicts, reason, actor_id
      ) values (v_org, v_a.id, v_a.person_id, v_a.plan_id, v_a.team_id, v_conflicts, left(v_reason, 500), v_viewer)
      on conflict (assignment_id, transaction_id) do update set conflicts = excluded.conflicts;
    end if;
  end loop;

  if cardinality(v_found) = 0 or v_reason is not null then return; end if;

  -- The People named are on this plan, which the caller edits; anything about
  -- other plans stays in the (redacted) conflict detail.
  select string_agg(n.name, ', ' order by n.name) filter (where n.rn <= 5), greatest(count(*) - 5, 0)
    into v_names, v_more
    from (
      select x.name, row_number() over (order by x.name) rn
        from (
          select distinct p.id,
                 coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'Unnamed') as name
            from public.assignments a join public.people p on p.id = a.person_id
           where a.id = any(v_found)
        ) x
    ) n;
  raise exception '%', format(
      'These times would double-book %s%s. Choose other times, or give a reason to override if you may.',
      v_names, case when v_more > 0 then format(' and %s more', v_more) else '' end)
    using errcode = 'PT409', hint = 'scheduling_conflict', detail = v_all::text;
end;
$$;
revoke execute on function private.enforce_time_change_conflicts(uuid, uuid[], uuid[]) from public, anon, authenticated;
grant execute on function private.enforce_time_change_conflicts(uuid, uuid[], uuid[]) to authenticated, service_role;

create or replace function public.apply_plan_time_changes(
  p_plan_id uuid,
  p_times jsonb,
  p_expected_revision bigint,
  p_impact_hash text default null,
  p_orphan_resolutions jsonb default '[]',
  p_notify boolean default true,
  p_effect_key text default null
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_viewer uuid := (select auth.uid());
  v_plan public.plans;
  v_impact jsonb;
  v_affected uuid[];
  v_people uuid[];
  v_removed uuid[];
  v_orphans uuid[];
  v_invalidated int := 0;
  v_notify uuid[];
  v_effect uuid;
begin
  select * into v_plan from public.plans where id = p_plan_id for update;
  if not found or not private.can_edit_plan(v_viewer, p_plan_id) then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;
  if p_expected_revision is not null and p_expected_revision <> v_plan.content_revision then
    raise exception 'The plan changed since you opened it' using errcode = 'PT409', hint = 'plan_changed';
  end if;
  perform private.validate_plan_times(p_plan_id, p_times);
  if jsonb_typeof(coalesce(p_orphan_resolutions, '[]'::jsonb)) <> 'array' then
    raise exception 'Resolutions must be a list' using errcode = '22023';
  end if;

  v_impact := private.plan_time_change_impact(p_plan_id, p_times, v_viewer);
  if p_impact_hash is not null and p_impact_hash <> v_impact->>'impact_hash' then
    raise exception 'Who this change affects has changed; review it again'
      using errcode = 'PT409', hint = 'time_impact_stale';
  end if;

  with proposed as (
    select r.id from jsonb_to_recordset(p_times) as r(id uuid)
  ), removed as (
    select pt.id from public.plan_times pt
     where pt.plan_id = p_plan_id and pt.id not in (select id from proposed)
  )
  select coalesce(array_agg(id), '{}') into v_removed from removed;

  select coalesce(array_agg(distinct a.id), '{}') into v_orphans
    from public.assignments a
   where a.plan_id = p_plan_id and a.status <> 'declined' and a.attendance_mode = 'selected'
     and exists (select 1 from public.assignment_attendance_times aat where aat.assignment_id = a.id)
     and not exists (select 1 from public.assignment_attendance_times aat
                      where aat.assignment_id = a.id and not (aat.plan_time_id = any(v_removed)));

  if p_impact_hash is null and exists (
    select 1 from public.assignment_attendance_times aat
      join public.assignments a on a.id = aat.assignment_id
     where a.plan_id = p_plan_id and aat.plan_time_id = any(v_removed)
  ) then
    raise exception 'A selected attendance time is still assigned; review affected requests first'
      using errcode = 'PT409', hint = 'time_impact_required';
  end if;

  if exists (
    select 1 from unnest(v_orphans) o(id)
     where not exists (
       select 1 from jsonb_to_recordset(coalesce(p_orphan_resolutions, '[]'::jsonb)) as r(assignment_id uuid, action text)
        where r.assignment_id = o.id and r.action in ('all', 'remove'))
  ) then
    raise exception 'Choose what happens to requests that only had removed times'
      using errcode = 'PT409', hint = 'orphan_resolution_required';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(coalesce(p_orphan_resolutions, '[]'::jsonb)) as r(assignment_id uuid, action text)
     where not (r.assignment_id = any(v_orphans)) or r.action not in ('all', 'remove')
  ) then
    raise exception 'Resolutions may only name requests left without a time' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.assignments a where a.id = any(v_orphans)
       and not private.can_schedule_on_plan(v_viewer, p_plan_id, a.team_id)
  ) then
    raise exception 'Someone who schedules that team must resolve its requests first' using errcode = '42501';
  end if;

  -- Every request whose attendance moves, including hidden ones.
  select coalesce(array_agg(a.id order by a.id), '{}') into v_affected
    from public.assignments a
   where a.plan_id = p_plan_id and a.status <> 'declined'
     and (
       (a.attendance_mode = 'all' and (
          exists (select 1 from jsonb_array_elements(v_impact->'times') t where t->>'change' in ('added', 'removed', 'changed'))))
       or exists (select 1 from public.assignment_attendance_times aat
                   where aat.assignment_id = a.id
                     and (aat.plan_time_id = any(v_removed)
                          or aat.plan_time_id in (select (t->>'id')::uuid from jsonb_array_elements(v_impact->'times') t
                                                   where t->>'change' = 'changed')))
     );
  select coalesce(array_agg(distinct a.person_id), '{}') into v_people
    from public.assignments a where a.id = any(v_affected);
  perform private.lock_scheduling_people(v_people);
  perform 1 from public.assignments a where a.id = any(v_affected) order by a.id for update;

  update public.plan_times pt
     set kind = r.kind::public.plan_time_kind,
         name = nullif(btrim(r.name), ''),
         starts_at = r.starts_at,
         ends_at = r.ends_at,
         sort_order = coalesce(r.sort_order, pt.sort_order)
    from jsonb_to_recordset(p_times) as r(id uuid, kind text, name text,
      starts_at timestamptz, ends_at timestamptz, sort_order int)
   where pt.id = r.id and pt.plan_id = p_plan_id;

  insert into public.plan_times (id, plan_id, kind, name, starts_at, ends_at, sort_order)
  select r.id, p_plan_id, r.kind::public.plan_time_kind, nullif(btrim(r.name), ''), r.starts_at, r.ends_at,
         coalesce(r.sort_order, 0)
    from jsonb_to_recordset(p_times) as r(id uuid, kind text, name text,
      starts_at timestamptz, ends_at timestamptz, sort_order int)
   where not exists (select 1 from public.plan_times pt where pt.id = r.id);

  delete from public.assignment_attendance_times aat
   using public.assignments a
   where a.id = aat.assignment_id and a.plan_id = p_plan_id and aat.plan_time_id = any(v_removed);

  update public.assignments a set attendance_mode = 'all'
    from jsonb_to_recordset(coalesce(p_orphan_resolutions, '[]'::jsonb)) as r(assignment_id uuid, action text)
   where a.id = r.assignment_id and r.action = 'all';
  delete from public.assignments a
   using jsonb_to_recordset(coalesce(p_orphan_resolutions, '[]'::jsonb)) as r(assignment_id uuid, action text)
   where a.id = r.assignment_id and r.action = 'remove';

  delete from public.plan_times pt where pt.plan_id = p_plan_id and pt.id = any(v_removed);

  -- A materially changed promise: live requests for those People on this plan
  -- become stale (links answer `stale`, reviews get 409).
  with stale as (
    update public.assignment_request_snapshots s
       set superseded_at = now(), version = s.version + 1
     where s.plan_id = p_plan_id and s.consumed_at is null and s.superseded_at is null
       and s.person_id = any(v_people)
    returning s.id
  )
  select count(*) into v_invalidated from stale;

  -- W10-CD-D1: moving a request's times into someone else's commitment is a
  -- scheduling decision like creating it: refused (PT409) unless overridden.
  perform private.enforce_time_change_conflicts(p_plan_id, v_affected, array(
    select (t->>'id')::uuid from jsonb_array_elements(v_impact->'times') t
     where t->>'change' in ('added', 'changed') and t->>'id' is not null));
  perform private.check_pending_conflicts();

  select coalesce(array_agg(a.id order by a.id), '{}') into v_notify
    from public.assignments a
   where a.plan_id = p_plan_id and a.person_id = any(v_people)
     and a.visibility = 'released' and a.status <> 'declined';
  if p_notify and cardinality(v_notify) > 0 then
    perform set_config('f04.plan_change_notify', 'on', true);
    v_effect := private.enqueue_assignment_requests(
      p_plan_id, 'assignment_request', v_notify,
      coalesce(p_effect_key, 'plan-times:' || p_plan_id::text || ':' || gen_random_uuid()::text),
      v_viewer
    );
    perform set_config('f04.plan_change_notify', '', true);
  end if;

  return jsonb_build_object(
    'impact', v_impact,
    'invalidated_requests', v_invalidated,
    'notified_assignment_ids', to_jsonb(case when p_notify then v_notify else '{}'::uuid[] end),
    'effect_id', v_effect
  );
end;
$$;
revoke execute on function public.apply_plan_time_changes(uuid, jsonb, bigint, text, jsonb, boolean, text) from public, anon;
grant execute on function public.apply_plan_time_changes(uuid, jsonb, bigint, text, jsonb, boolean, text) to authenticated;

create or replace function public.reschedule_plans(
  p_organization_id          uuid,
  p_mode                     text,
  p_preview_hash             text,
  p_idempotency_key          text,
  p_moves                    jsonb default null,
  p_order                    jsonb default null,
  p_reset_responses          boolean default false,
  p_notify                   boolean default true,
  p_conflict_override_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_request  text;
  v_existing public.plan_reschedule_operations;
  v_preview  jsonb;
  v_row      jsonb;
  v_ids      uuid[];
  v_op       uuid := gen_random_uuid();
  v_change   jsonb;
  v_effects  uuid[] := '{}';
  v_reset    int := 0;
  v_n        int;
  v_result   jsonb;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 200 then
    perform private.f10_bad('A request key of 8 to 200 characters is required');
  end if;
  v_request := md5(jsonb_build_object(
    'mode', p_mode, 'moves', p_moves, 'order', p_order,
    'reset', coalesce(p_reset_responses, false), 'notify', coalesce(p_notify, true))::text);
  perform pg_advisory_xact_lock(hashtextextended('f10:' || p_organization_id || ':' || p_idempotency_key, 0));
  select * into v_existing from public.plan_reschedule_operations
   where organization_id = p_organization_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_request then
      raise exception 'That request key was used for a different change' using errcode = 'PT409', hint = 'idempotency_key_reused';
    end if;
    return v_existing.result || jsonb_build_object('operation_id', v_existing.id, 'replayed', true);
  end if;

  -- Sorted plan locks: two overlapping reschedules cannot deadlock.
  if p_mode = 'shift' then
    select array_agg(distinct (m ->> 'plan_id')::uuid order by (m ->> 'plan_id')::uuid) into v_ids
      from jsonb_array_elements(coalesce(p_moves, '[]'::jsonb)) m;
  else
    select array_agg(x order by x) into v_ids from unnest(array[
      (p_order ->> 'source_plan_id')::uuid, (p_order ->> 'destination_plan_id')::uuid]) x;
  end if;
  perform 1 from public.plans where id = any(coalesce(v_ids, '{}')) and organization_id = p_organization_id
   order by id for update;

  -- The hash exists only because this review once succeeded, so a review
  -- that no longer validates means the plans changed: stale, not invalid.
  begin
    v_preview := private.plan_reschedule_preview(
      p_organization_id, p_mode, p_moves, p_order, p_reset_responses, p_notify);
  exception when invalid_parameter_value then
    raise exception 'The plans changed since you reviewed them. Review again.'
      using errcode = 'PT409', hint = 'template_preview_changed';
  end;
  if p_preview_hash is null or p_preview_hash <> md5(v_preview::text) then
    raise exception 'The plans changed since you reviewed them. Review again.'
      using errcode = 'PT409', hint = 'template_preview_changed';
  end if;

  if p_mode = 'shift' then
    -- W10-CD-D1: plans moved in one batch are checked together once all of
    -- them sit at their new times, so swapping two plans is not a conflict.
    perform set_config('w10.defer_time_conflicts', 'on', true);
    for v_row in select value from jsonb_array_elements(v_preview -> 'plans') loop
      if p_reset_responses then
        -- An explicit, audited reset: history records the scheduler as actor.
        perform set_config('app.assignment_response_note', 'Reset because the plan was rescheduled', true);
        update public.assignments
           set status = 'unconfirmed'
         where plan_id = (v_row ->> 'plan_id')::uuid and visibility = 'released' and status <> 'unconfirmed';
        get diagnostics v_n = row_count;
        v_reset := v_reset + v_n;
        perform set_config('app.assignment_response_note', '', true);
      end if;
      update public.plans set service_date = (v_row ->> 'service_date')::timestamptz
       where id = (v_row ->> 'plan_id')::uuid;
      perform set_config('f04.conflict_override_reason', coalesce(p_conflict_override_reason, ''), true);
      v_change := public.apply_plan_time_changes(
        (v_row ->> 'plan_id')::uuid,
        coalesce((select jsonb_agg(jsonb_build_object(
                    'id', t ->> 'id', 'kind', t ->> 'kind', 'name', t ->> 'name', 'sort_order', (t ->> 'sort_order')::int,
                    'starts_at', t ->> 'starts_at', 'ends_at', t ->> 'ends_at'))
                    from jsonb_array_elements(v_row -> 'times') t), '[]'::jsonb),
        null, null, '[]'::jsonb, coalesce(p_notify, true),
        'reschedule:' || v_op || ':' || (v_row ->> 'plan_id'));
      perform set_config('f04.conflict_override_reason', '', true);
      if (v_change ->> 'effect_id') is not null then
        v_effects := v_effects || (v_change ->> 'effect_id')::uuid;
      end if;
    end loop;
    perform set_config('w10.defer_time_conflicts', '', true);
    perform set_config('f04.conflict_override_reason', coalesce(p_conflict_override_reason, ''), true);
    for v_row in select value from jsonb_array_elements(v_preview -> 'plans') loop
      perform private.enforce_time_change_conflicts(
        (v_row ->> 'plan_id')::uuid,
        array(select a.id from public.assignments a
               where a.plan_id = (v_row ->> 'plan_id')::uuid and a.status <> 'declined'));
    end loop;
    perform set_config('f04.conflict_override_reason', '', true);
    v_result := jsonb_build_object('mode', 'shift', 'plan_ids', to_jsonb(v_ids),
                                   'responses_reset', v_reset, 'effect_ids', to_jsonb(v_effects));
  else
    if (v_preview ->> 'items_mode') = 'replace' then
      delete from public.plan_items where plan_id = (v_preview #>> '{destination,plan_id}')::uuid;
    end if;
    perform private.copy_plan_children(
      (v_preview #>> '{source,plan_id}')::uuid, (v_preview #>> '{destination,plan_id}')::uuid,
      true, false, false, null);
    if (v_preview ->> 'remove_from_source')::boolean then
      delete from public.plan_items where plan_id = (v_preview #>> '{source,plan_id}')::uuid;
    end if;
    v_result := jsonb_build_object('mode', 'order_only', 'plan_ids', to_jsonb(v_ids),
                                   'responses_reset', 0, 'effect_ids', '[]'::jsonb);
  end if;

  insert into public.plan_reschedule_operations (
    id, organization_id, idempotency_key, request_hash, mode, plan_ids, reset_responses, result, created_by
  ) values (
    v_op, p_organization_id, p_idempotency_key, v_request, p_mode, v_ids,
    coalesce(p_reset_responses, false), v_result, v_uid
  );
  return v_result || jsonb_build_object('operation_id', v_op, 'replayed', false);
end;
$$;

drop function if exists public.update_plan_with_times(uuid, jsonb, jsonb, bigint, text, jsonb, boolean, text);
create or replace function public.update_plan_with_times(
  p_plan_id              uuid,
  p_fields               jsonb,
  p_times                jsonb default null,
  p_expected_revision    bigint default null,
  p_impact_hash          text default null,
  p_orphan_resolutions   jsonb default '[]',
  p_notify               boolean default true,
  p_effect_key           text default null,
  p_conflict_override_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_fields       jsonb := coalesce(p_fields, '{}'::jsonb);
  v_result       jsonb := '{}'::jsonb;
  v_has_service  boolean;
  v_set          text;
  v_updated      uuid;
begin
  if p_times is not null then
    -- W10-CD-D1: the reason lets a caller with scheduling.override_conflicts
    -- move people's times into an overlap; it is recorded like an assignment's.
    perform set_config('f04.conflict_override_reason', coalesce(p_conflict_override_reason, ''), true);
    v_result := public.apply_plan_time_changes(
      p_plan_id, p_times, p_expected_revision, p_impact_hash,
      coalesce(p_orphan_resolutions, '[]'::jsonb), coalesce(p_notify, true), p_effect_key);
    perform set_config('f04.conflict_override_reason', '', true);
    v_has_service := exists (
      select 1 from jsonb_array_elements(p_times) t
       where coalesce(t->>'kind', 'service') = 'service');
    if v_has_service then
      v_fields := v_fields - 'service_date';
    end if;
  end if;

  select string_agg(format('%I = %s', f.col, f.expr), ', ' order by f.ord) into v_set
    from (values
      (1, 'title',           '$1->>''title'''),
      (2, 'service_type_id', '($1->>''service_type_id'')::uuid'),
      (3, 'service_date',    '($1->>''service_date'')::timestamptz'),
      (4, 'location',        '$1->>''location'''),
      (5, 'status',          '($1->>''status'')::public.plan_status'),
      (6, 'notes',           '$1->>''notes''')
    ) as f(ord, col, expr)
   where v_fields ? f.col;

  if v_set is not null then
    execute format('update public.plans p set %s where p.id = $2 returning p.id', v_set)
       into v_updated
      using v_fields, p_plan_id;
    if v_updated is null then
      raise exception 'Plan not found' using errcode = 'P0002';
    end if;
  end if;
  return v_result;
end;
$$;
revoke execute on function public.update_plan_with_times(uuid, jsonb, jsonb, bigint, text, jsonb, boolean, text, text) from public, anon;
grant execute on function public.update_plan_with_times(uuid, jsonb, jsonb, bigint, text, jsonb, boolean, text, text) to authenticated;
