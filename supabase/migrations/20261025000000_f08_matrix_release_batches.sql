-- F08 gate: the F05 staffing matrix releases through F08 release batches.
--
-- Before this, commit_staffing_matrix released each `release` cell with its
-- own release_plan_assignments_versioned call (one outbox effect, so one
-- email, per cell), and an `assign`/`copy` cell created as released with
-- notify sent its own per-cell effect too. Now every notifying release in a
-- matrix commit goes into ONE release batch keyed by the matrix operation id,
-- so a Person gets one message with a separate response link per plan
-- (private.enqueue_release_batch_requests: one snapshot per Person per plan,
-- one delivery per Person per channel).
--
--   * `release` cells with notify      -> batch 'matrix:<operation_id>' (notify)
--   * `assign`/`copy` cells created as released with notify are inserted
--     prepared and join that same batch, which releases them
--   * `release` cells without notify   -> batch 'matrix:<operation_id>:silent'
--     (no effect, but the same exact-scope checks and release history)
--   * cells created as released without notify are unchanged (no message)
--
-- The batches run after every other action, in the same transaction, so a
-- stale reviewed scope still aborts the whole matrix commit with PT409
-- matrix_changed. The result keeps its shape: delivery_effect_ids now holds
-- the batch's single effect (or nothing), and release_batch_ids is added.
--
-- Lock order: release advisory locks for every matrix plan (sorted) are taken
-- before the plan rows, matching release_plan_assignments/execute_release_batch
-- (advisory lock, then the plan row via the staffing-revision trigger), so a
-- matrix commit and a Release review batch on the same plans cannot deadlock.
--
-- Additive: only commit_staffing_matrix is replaced; no table changes.

create or replace function public.commit_staffing_matrix(
  p_organization_id uuid,
  p_operation_id text,
  p_actions jsonb,
  p_base_revisions jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_existing public.staffing_matrix_commits;
  v_plan_ids uuid[];
  v_plan uuid;
  v_person_ids uuid[];
  v_action jsonb;
  v_index integer := 0;
  v_assignment public.assignments;
  v_created public.assignments;
  v_assignment_ids uuid[] := '{}';
  v_notify_release_ids uuid[] := '{}';
  v_silent_release_ids uuid[] := '{}';
  v_effect_ids uuid[] := '{}';
  v_batch_ids uuid[] := '{}';
  v_batch public.release_batches;
  v_visibility text;
  v_batched boolean;
  v_result jsonb;
  v_before_count integer;
begin
  if v_actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_actions) <> 'array' or jsonb_array_length(p_actions) not between 1 and 200 then
    raise exception 'Choose 1 to 200 matrix changes' using errcode = '22023';
  end if;
  if jsonb_typeof(p_base_revisions) <> 'array' then
    raise exception 'Base revisions must be a list' using errcode = '22023';
  end if;
  if char_length(p_idempotency_key) not between 8 and 200 then
    raise exception 'Invalid idempotency key' using errcode = '22023';
  end if;
  if p_operation_id <> public.staffing_matrix_operation_id(p_actions, p_base_revisions) then
    raise exception 'The staffing preview does not match this commit' using errcode = 'PT409', hint = 'matrix_changed';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'staffing-matrix:' || p_organization_id::text || ':' || v_actor::text || ':' || p_idempotency_key, 0
  ));
  select * into v_existing from public.staffing_matrix_commits
   where organization_id = p_organization_id and actor_id = v_actor and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.operation_id <> p_operation_id then
      raise exception 'That idempotency key belongs to another staffing operation'
        using errcode = 'PT409', hint = 'matrix_changed';
    end if;
    return v_existing.result;
  end if;

  select coalesce(array_agg(distinct plan_id order by plan_id), '{}') into v_plan_ids
  from (
    select case
      when action->>'kind' in ('assign','remove','release') then (action->>'plan_id')::uuid
      when action->>'kind' = 'copy' then (action->>'destination_plan_id')::uuid
    end plan_id
    from jsonb_array_elements(p_actions) action
    union
    select a.plan_id from jsonb_array_elements(p_actions) action
      join public.assignments a on a.id = (action->>'source_assignment_id')::uuid
     where action->>'kind' = 'copy'
  ) plans where plan_id is not null;
  if cardinality(v_plan_ids) not between 1 and 12 then
    raise exception 'A staffing matrix contains 1 to 12 plans' using errcode = '22023';
  end if;

  -- Release locks first (sorted), then plan rows: the same order every
  -- release path uses.
  foreach v_plan in array v_plan_ids loop
    perform pg_advisory_xact_lock(hashtextextended('release:' || v_plan::text, 0));
  end loop;
  perform 1 from public.plans p where p.id = any(v_plan_ids) order by p.id for update;
  if (select count(*) from public.plans p where p.id = any(v_plan_ids) and p.organization_id = p_organization_id)
       <> cardinality(v_plan_ids)
     or (select count(*) from jsonb_to_recordset(p_base_revisions)
           as r(plan_id uuid, staffing_revision bigint)) <> cardinality(v_plan_ids)
     or exists (
       select 1 from unnest(v_plan_ids) u(plan_id)
       left join jsonb_to_recordset(p_base_revisions) as r(plan_id uuid, staffing_revision bigint) using (plan_id)
       left join public.plans p on p.id = u.plan_id
       where r.plan_id is null or p.staffing_revision <> r.staffing_revision
     ) then
    raise exception 'Staffing changed since the preview. Refresh and review again.'
      using errcode = 'PT409', hint = 'matrix_changed';
  end if;

  -- Validate every declared cell before the first write. No operation may be
  -- silently skipped, including an assignment that appeared after preview.
  for v_action in select value from jsonb_array_elements(p_actions) loop
    if v_action->>'kind' = 'assign' then
      if not public.can_schedule_on_plan((v_action->>'plan_id')::uuid, (v_action->>'team_id')::uuid) then
        raise exception 'You cannot schedule one of those cells' using errcode = '42501';
      end if;
      if exists (
        select 1 from public.assignments a where a.plan_id = (v_action->>'plan_id')::uuid
          and a.person_id = (v_action->>'person_id')::uuid
          and a.team_id = (v_action->>'team_id')::uuid
          and a.position_id is not distinct from nullif(v_action->>'position_id', '')::uuid
      ) then raise exception 'A selected cell is already staffed' using errcode = 'PT409', hint = 'matrix_changed'; end if;
    elsif v_action->>'kind' in ('remove','release') then
      select * into v_assignment from public.assignments a
       where a.id = (v_action->>'assignment_id')::uuid and a.plan_id = (v_action->>'plan_id')::uuid;
      if v_assignment.id is null or v_assignment.request_revision <> (v_action->>'expected_request_revision')::bigint
         or (v_action->>'kind' = 'release' and v_assignment.visibility <> 'prepared') then
        raise exception 'A selected request changed since the preview' using errcode = 'PT409', hint = 'matrix_changed';
      end if;
      if not public.can_schedule_on_plan(v_assignment.plan_id, v_assignment.team_id) then
        raise exception 'You cannot change one of those cells' using errcode = '42501';
      end if;
    elsif v_action->>'kind' = 'copy' then
      select * into v_assignment from public.assignments a where a.id = (v_action->>'source_assignment_id')::uuid;
      if v_assignment.id is null or v_assignment.request_revision <> (v_action->>'expected_source_revision')::bigint then
        raise exception 'The source request changed since the preview' using errcode = 'PT409', hint = 'matrix_changed';
      end if;
      if not public.can_schedule_on_plan(v_assignment.plan_id, v_assignment.team_id)
         or not public.can_schedule_on_plan((v_action->>'destination_plan_id')::uuid, v_assignment.team_id) then
        raise exception 'You cannot copy one of those cells' using errcode = '42501';
      end if;
      if exists (
        select 1 from public.assignments a where a.plan_id = (v_action->>'destination_plan_id')::uuid
          and a.person_id = v_assignment.person_id and a.team_id = v_assignment.team_id
          and a.position_id is not distinct from v_assignment.position_id
      ) then raise exception 'A copied cell is already staffed' using errcode = 'PT409', hint = 'matrix_changed'; end if;
    else
      raise exception 'Unknown staffing matrix action' using errcode = '22023';
    end if;
  end loop;

  select coalesce(array_agg(distinct person_id), '{}') into v_person_ids from (
    select (action->>'person_id')::uuid person_id from jsonb_array_elements(p_actions) action
      where action->>'kind' = 'assign'
    union
    select a.person_id from jsonb_array_elements(p_actions) action join public.assignments a
      on a.id = coalesce(nullif(action->>'assignment_id',''), nullif(action->>'source_assignment_id',''))::uuid
      where action->>'kind' in ('remove','release','copy')
  ) people;
  perform private.lock_scheduling_people(v_person_ids);

  for v_action in select value from jsonb_array_elements(p_actions) loop
    v_index := v_index + 1;
    if v_action->>'kind' in ('assign','copy') then
      -- A cell created as released with notify is created prepared and
      -- released by the consolidated batch below.
      v_batched := v_action->>'visibility' = 'released' and coalesce((v_action->>'notify')::boolean, false);
      v_visibility := case when v_batched then 'prepared' else v_action->>'visibility' end;
      v_before_count := cardinality(v_assignment_ids);
      if v_action->>'kind' = 'assign' then
        for v_created in select * from public.schedule_plan_assignments(
          (v_action->>'plan_id')::uuid,
          jsonb_build_array(jsonb_build_object(
            'person_id', v_action->>'person_id', 'team_id', v_action->>'team_id',
            'position_id', v_action->>'position_id', 'notes', null,
            'visibility', v_visibility, 'attendance_mode', v_action->>'attendance_mode',
            'time_ids', coalesce(v_action->'time_ids', '[]'::jsonb)
          )),
          false,
          'matrix:' || p_operation_id || ':' || v_index::text,
          v_visibility, null, null
        ) loop v_assignment_ids := array_append(v_assignment_ids, v_created.id);
          if v_batched then v_notify_release_ids := array_append(v_notify_release_ids, v_created.id); end if;
        end loop;
        if cardinality(v_assignment_ids) = v_before_count then
          raise exception 'A selected cell changed before it was staffed' using errcode = 'PT409', hint = 'matrix_changed';
        end if;
      else
        select * into v_assignment from public.assignments where id = (v_action->>'source_assignment_id')::uuid;
        for v_created in select * from public.schedule_plan_assignments(
          (v_action->>'destination_plan_id')::uuid,
          jsonb_build_array(jsonb_build_object(
            'person_id', v_assignment.person_id, 'team_id', v_assignment.team_id,
            'position_id', v_assignment.position_id, 'notes', v_assignment.notes,
            'visibility', v_visibility, 'attendance_mode', v_action->>'destination_attendance_mode',
            'time_ids', coalesce(v_action->'destination_time_ids', '[]'::jsonb)
          )),
          false,
          'matrix:' || p_operation_id || ':' || v_index::text,
          v_visibility, null, null
        ) loop v_assignment_ids := array_append(v_assignment_ids, v_created.id);
          if v_batched then v_notify_release_ids := array_append(v_notify_release_ids, v_created.id); end if;
        end loop;
        if cardinality(v_assignment_ids) = v_before_count then
          raise exception 'A copied cell changed before it was staffed' using errcode = 'PT409', hint = 'matrix_changed';
        end if;
      end if;
    elsif v_action->>'kind' = 'remove' then
      delete from public.assignments where id = (v_action->>'assignment_id')::uuid;
    elsif v_action->>'kind' = 'release' then
      v_assignment_ids := array_append(v_assignment_ids, (v_action->>'assignment_id')::uuid);
      if coalesce((v_action->>'notify')::boolean, true) then
        v_notify_release_ids := array_append(v_notify_release_ids, (v_action->>'assignment_id')::uuid);
      else
        v_silent_release_ids := array_append(v_silent_release_ids, (v_action->>'assignment_id')::uuid);
      end if;
    end if;
  end loop;

  -- Release cells were validated above against their reviewed revision and
  -- nothing in this commit changes them, so the batch pins the current
  -- revision. A batch that is refused aborts the whole commit, and so does a
  -- release cell that this commit also removed or named twice.
  if (select count(*) from public.assignments a
       where a.id = any(v_notify_release_ids || v_silent_release_ids))
     <> cardinality(v_notify_release_ids || v_silent_release_ids) then
    raise exception 'A selected request changed since the preview' using errcode = 'PT409', hint = 'matrix_changed';
  end if;
  begin
    if cardinality(v_notify_release_ids) > 0 then
      v_batch := public.create_release_batch(
        p_organization_id,
        (select jsonb_agg(jsonb_build_object('assignment_id', a.id, 'request_revision', a.request_revision) order by a.id)
           from public.assignments a where a.id = any(v_notify_release_ids)),
        true, null, 'matrix:' || p_operation_id
      );
      if v_batch.status <> 'released' then
        raise exception 'Prepared requests changed since the release review' using errcode = 'PT409';
      end if;
      v_batch_ids := array_append(v_batch_ids, v_batch.id);
      if v_batch.effect_id is not null then v_effect_ids := array_append(v_effect_ids, v_batch.effect_id); end if;
    end if;
    if cardinality(v_silent_release_ids) > 0 then
      v_batch := public.create_release_batch(
        p_organization_id,
        (select jsonb_agg(jsonb_build_object('assignment_id', a.id, 'request_revision', a.request_revision) order by a.id)
           from public.assignments a where a.id = any(v_silent_release_ids)),
        false, null, 'matrix:' || p_operation_id || ':silent'
      );
      if v_batch.status <> 'released' then
        raise exception 'Prepared requests changed since the release review' using errcode = 'PT409';
      end if;
      v_batch_ids := array_append(v_batch_ids, v_batch.id);
    end if;
  exception when sqlstate 'PT409' or sqlstate 'P0002' then
    raise exception 'A selected request changed since the preview' using errcode = 'PT409', hint = 'matrix_changed';
  end;

  v_result := jsonb_build_object(
    'operation_id', p_operation_id,
    'committed_at', now(),
    'assignment_ids', to_jsonb(v_assignment_ids),
    'affected_plan_ids', to_jsonb(v_plan_ids),
    'delivery_effect_ids', to_jsonb(v_effect_ids),
    'release_batch_ids', to_jsonb(v_batch_ids)
  );
  insert into public.staffing_matrix_commits
    (organization_id, actor_id, idempotency_key, operation_id, result)
  values (p_organization_id, v_actor, p_idempotency_key, p_operation_id, v_result);
  return v_result;
end;
$$;
revoke execute on function public.commit_staffing_matrix(uuid, text, jsonb, jsonb, text) from public, anon;
grant execute on function public.commit_staffing_matrix(uuid, text, jsonb, jsonb, text) to authenticated;

comment on function public.commit_staffing_matrix(uuid, text, jsonb, jsonb, text) is
  'F05 atomic reviewed staffing batch. Locks plans and People in sorted order; stale/invalid scope aborts the whole batch. '
  'Releases go through one F08 release batch per commit (matrix:<operation_id>), so each Person gets one message.';
