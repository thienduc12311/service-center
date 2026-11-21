-- QA wave 7, assignment responses.
--
-- W7-RESP-D2: a signed-in assignee could change the status of their own
-- released assignment with a plain PostgREST PATCH. The member branch of
-- `assignments_update` lets the row through and the history trigger records
-- it, but nothing enqueues the scheduler update, so a confirmed person could
-- withdraw without anyone being told. An answer now has to come through one
-- of the response paths, each of which records the history row and the
-- scheduler effect in the same change:
--   * `respond_as_self` / legacy `respond_to_own_assignment` (security
--     invoker) set the transaction-local `app.responding_self` flag around
--     their own compare-and-set;
--   * snapshot commit, delegate and response-link answers run as SECURITY
--     DEFINER functions owned by `postgres`, which the guard already lets
--     through (`app.responding_snapshot` stays honoured as well);
--   * schedulers who may schedule the plan/team keep their direct edit.
-- PostgREST cannot set `app.*` settings, so a direct PATCH of `status` by a
-- non-scheduler is refused with 42501 / hint `assignment_response_path`.
--
-- W7-RESP-D4 (= W2-RESP-D3): an identical answer racing the one that
-- committed first was refused as stale, although the `respond_as_self`
-- contract says a retry of a committed answer is a success.
--   * `respond_as_self`: when the compare-and-set misses, re-read the row; if
--     it already holds the requested answer, return it as `unchanged` (no
--     second history row, no second effect).
--   * `respond_to_assignment_snapshots`: callers with the same Person and
--     idempotency key are serialised on a transaction advisory lock before the
--     key lookup, so the loser reads the stored result instead of finding the
--     snapshot already advanced.

-- ------------------------------------------------------- the guard (D2) ---
create or replace function public.guard_assignment_self_response()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon', 'service_role') then return new; end if;
  if new.visibility = 'prepared' and old.visibility = 'released' then
    raise exception 'A released request cannot be made private again; remove it instead' using errcode = 'PT409';
  end if;
  if new.visibility = 'released' and old.visibility = 'prepared'
     and coalesce(current_setting('app.releasing_assignments', true), '') <> 'on' then
    raise exception 'Release requests with release_plan_assignments()' using errcode = '42501';
  end if;
  if (select auth.uid()) is not null and public.can_schedule_on_plan(old.plan_id, old.team_id) then return new; end if;

  if new.plan_id is distinct from old.plan_id
     or new.person_id is distinct from old.person_id
     or new.user_id is distinct from old.user_id
     or new.team_id is distinct from old.team_id
     or new.position_id is distinct from old.position_id
     or new.notes is distinct from old.notes
     or new.notified_at is distinct from old.notified_at
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.visibility is distinct from old.visibility
     or new.released_at is distinct from old.released_at
     or new.released_by is distinct from old.released_by
     or new.response_owner_id is distinct from old.response_owner_id
     or new.attendance_mode is distinct from old.attendance_mode
     or new.request_revision is distinct from old.request_revision then
    raise exception 'Only a scheduler can change this assignment' using errcode = '42501';
  end if;
  if new.status is distinct from old.status
     and coalesce(current_setting('app.responding_snapshot', true), '') <> 'on'
     and (old.status = 'declined' or new.status = 'unconfirmed') then
    raise exception 'A % assignment cannot be changed to %; ask a scheduler to request you again',
      old.status, new.status using errcode = 'PT409';
  end if;
  if new.status is distinct from old.status
     and coalesce(current_setting('app.responding_self', true), '') <> 'on'
     and coalesce(current_setting('app.responding_snapshot', true), '') <> 'on' then
    raise exception 'Answer this assignment through the app so the scheduler is told'
      using errcode = '42501', hint = 'assignment_response_path';
  end if;
  return new;
end;
$$;

-- ---------------------------------------- respond_as_self (D2 + D4) ---
create or replace function public.respond_as_self(
  p_organization_id uuid,
  p_assignment_id uuid,
  p_status public.assignment_status,
  p_expected_status public.assignment_status default null,
  p_reason text default null
)
returns table (assignment public.assignments, transition text, effect_id uuid)
language plpgsql security invoker set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_row public.assignments;
  v_updated public.assignments;
  v_latest public.assignments;
  v_transition text;
  v_history uuid;
  v_effect uuid;
begin
  if v_actor is null then
    raise exception 'Sign in to answer an assignment' using errcode = '42501';
  end if;
  if p_status = 'unconfirmed' then raise exception 'An answer is either confirmed or declined' using errcode = '22023'; end if;
  if p_reason is not null and p_status <> 'declined' then raise exception 'A reason can only accompany a decline' using errcode = '22023'; end if;
  if char_length(p_reason) > 500 then raise exception 'Keep the reason under 500 characters' using errcode = '22001'; end if;

  select a.* into v_row
    from public.assignments a
    join public.plans p on p.id = a.plan_id
   where a.id = p_assignment_id and p.organization_id = p_organization_id;
  if v_row.id is null then
    raise exception 'Assignment not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.people pe where pe.id = v_row.person_id and pe.profile_id = v_actor
  ) then
    raise exception 'You can only respond to your own assignments'
      using errcode = '42501', hint = 'assignment_not_own';
  end if;

  if v_row.status = p_status then
    return query select v_row, 'unchanged'::text, null::uuid;
    return;
  end if;
  if p_expected_status is not null and v_row.status <> p_expected_status then
    raise exception 'This assignment changed since you opened it. Refresh and review it again.'
      using errcode = 'PT409', hint = 'assignment_response_stale', detail = v_row.status::text;
  end if;
  if not (v_row.status = 'unconfirmed' or (v_row.status = 'confirmed' and p_status = 'declined')) then
    raise exception 'You declined this position. Ask a scheduler if you can serve after all.'
      using errcode = 'PT409', hint = 'assignment_response_forbidden';
  end if;
  v_transition := case when v_row.status = 'confirmed' then 'withdrawal' else 'answer' end;

  -- The history trigger reads the reason from this setting; the guard admits
  -- the status change only while `app.responding_self` is on.
  perform set_config('app.assignment_response_note', coalesce(p_reason, ''), true);
  perform set_config('app.responding_self', 'on', true);
  update public.assignments a set status = p_status, responded_at = now()
   where a.id = v_row.id and a.status = v_row.status
     and exists (select 1 from public.people pe where pe.id = a.person_id and pe.profile_id = v_actor)
  returning a.* into v_updated;
  perform set_config('app.responding_self', '', true);
  perform set_config('app.assignment_response_note', '', true);

  if v_updated.id is null then
    -- Changed between the read and the write. A concurrent identical answer
    -- that committed first is this call's answer too: report it unchanged.
    select a.* into v_latest from public.assignments a where a.id = v_row.id;
    if v_latest.id is not null and v_latest.status = p_status then
      return query select v_latest, 'unchanged'::text, null::uuid;
      return;
    end if;
    raise exception 'This assignment changed since you opened it. Refresh and review it again.'
      using errcode = 'PT409', hint = 'assignment_response_stale',
            detail = coalesce(v_latest.status, v_row.status)::text;
  end if;

  -- The history row this update just wrote. Matching the transition keeps
  -- the key exact even when one transaction answers the same row twice.
  select h.id into v_history
    from public.assignment_responses h
   where h.assignment_id = v_updated.id
     and h.previous_status = v_row.status and h.status = v_updated.status
   order by h.created_at desc, h.id desc
   limit 1;
  v_effect := private.enqueue_scheduler_responses(
    array[v_updated.id], v_actor, p_status,
    case when v_transition = 'withdrawal' then 'withdrawal' else 'response' end,
    'assignment-response:' || v_history::text
  );

  return query select v_updated, v_transition, v_effect;
end;
$$;

-- ------------------------------- legacy respond_to_own_assignment (D2) ---
-- Kept until a later cleanup (see 20261123000000_respond_as_self.sql); it
-- already enqueues the scheduler update, so it is a sanctioned path too.
create or replace function public.respond_to_own_assignment(
  p_assignment_id uuid,
  p_status public.assignment_status,
  p_expected_status public.assignment_status,
  p_reason text default null
)
returns setof public.assignments
language plpgsql
set search_path = ''
as $$
declare v_row public.assignments; v_history uuid;
begin
  if p_status = 'unconfirmed' then raise exception 'An answer is either confirmed or declined' using errcode = '22023'; end if;
  if p_reason is not null and p_status <> 'declined' then raise exception 'A reason can only accompany a decline' using errcode = '22023'; end if;
  if char_length(p_reason) > 500 then raise exception 'Keep the reason under 500 characters' using errcode = '22001'; end if;
  perform set_config('app.assignment_response_note', coalesce(p_reason, ''), true);
  perform set_config('app.responding_self', 'on', true);
  update public.assignments a set status = p_status, responded_at = now()
   where a.id = p_assignment_id and a.status = p_expected_status
     and exists (select 1 from public.people p where p.id = a.person_id and p.profile_id = (select auth.uid()))
  returning * into v_row;
  perform set_config('app.responding_self', '', true);
  perform set_config('app.assignment_response_note', '', true);
  if v_row.id is null then return; end if;
  -- Match the transition, as respond_as_self does, so two answers in one
  -- transaction (same created_at) each key their own effect.
  select id into v_history from public.assignment_responses
   where assignment_id = v_row.id and previous_status = p_expected_status and status = p_status
   order by created_at desc, id desc limit 1;
  perform private.enqueue_scheduler_responses(
    array[v_row.id], v_row.user_id, p_status,
    case when p_expected_status = 'confirmed' and p_status = 'declined' then 'withdrawal' else 'response' end,
    'assignment-response:' || v_history::text
  );
  return next v_row;
end;
$$;

-- ------------------------------------ snapshot commit idempotency (D4) ---
create or replace function public.respond_to_assignment_snapshots(
  p_organization_id uuid,
  p_responses jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid := (select auth.uid());
  v_person uuid;
  v_org uuid;
  v_hash text := encode(extensions.digest(p_responses::text, 'sha256'), 'hex');
  v_existing public.assignment_response_operations;
  v_item record;
  v_result jsonb := jsonb_build_object('snapshots', '[]'::jsonb, 'effect_ids', '[]'::jsonb);
  v_apply record;
begin
  if v_profile is null or char_length(p_idempotency_key) not between 8 and 200
     or jsonb_typeof(p_responses) <> 'array' or jsonb_array_length(p_responses) = 0 then
    raise exception 'A reviewed response and idempotency key are required' using errcode = '22023';
  end if;
  select p.id, p.organization_id into v_person, v_org
    from public.people p
    join public.assignment_request_snapshots s on s.person_id = p.id
   where p.profile_id = v_profile
     and p.organization_id = p_organization_id
     and s.organization_id = p_organization_id
     and s.id = ((p_responses->0)->>'snapshot_id')::uuid;
  if v_person is null then raise exception 'Response snapshot not found' using errcode = 'P0002'; end if;

  -- Concurrent retries of one operation wait here for the first to commit,
  -- then read its stored result below instead of a moved-on snapshot.
  perform pg_advisory_xact_lock(hashtextextended(
    'assignment-response-operation:' || v_org::text || ':' || v_person::text || ':' || p_idempotency_key, 0));

  select * into v_existing from public.assignment_response_operations
   where organization_id = v_org and person_id = v_person and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then
      raise exception 'That idempotency key was used for another response' using errcode = 'PT409';
    end if;
    return v_existing.result;
  end if;

  -- Every selected snapshot must belong to the same signed-in Person. Locking
  -- happens inside apply in stable assignment order.
  if exists (
    select 1 from jsonb_array_elements(p_responses) r
    left join public.assignment_request_snapshots s on s.id = (r->>'snapshot_id')::uuid
    left join public.people p on p.id = s.person_id
    where s.id is null
       or s.organization_id is distinct from p_organization_id
       or s.person_id is distinct from v_person
       or p.profile_id is distinct from v_profile
  ) then
    raise exception 'Response snapshot not found' using errcode = 'P0002';
  end if;

  for v_item in
    select r->>'snapshot_id' snapshot_id,
           (r->>'version')::bigint version,
           r->'answers' answers
      from jsonb_array_elements(p_responses) r
     order by r->>'snapshot_id'
  loop
    select * into v_apply from private.apply_assignment_snapshot_response(
      v_item.snapshot_id::uuid, v_item.version, v_item.answers, v_profile,
      'assignment-batch-response:' || p_idempotency_key
    );
    v_result := jsonb_set(v_result, '{snapshots}',
      (v_result->'snapshots') || jsonb_build_array(jsonb_build_object(
        'snapshot_id', v_item.snapshot_id,
        'assignments_updated', v_apply.assignments_updated
      )));
    v_result := jsonb_set(v_result, '{effect_ids}',
      (v_result->'effect_ids') || to_jsonb(v_apply.effect_ids));
  end loop;

  insert into public.assignment_response_operations (
    organization_id, person_id, idempotency_key, request_hash, result
  ) values (v_org, v_person, p_idempotency_key, v_hash, v_result);
  return v_result;
end;
$$;
