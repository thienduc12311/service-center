-- A signed-in person answers one of their own assignments in one call.
--
-- `respond_to_own_assignment` left the decision to the API: it pre-read the
-- row, worked out the transition, and the route then guessed which scheduler
-- update the answer had recorded. `respond_as_self` decides everything in the
-- same transaction as the write, and returns what it recorded:
--
--   * unchanged  — the assignment already holds that answer (a retry of an
--                  answer that committed). Checked before staleness, so a
--                  retry is a success. Nothing is written.
--   * stale      — `p_expected_status` was given and the row has moved on.
--                  PT409, hint `assignment_response_stale`, the current status
--                  in DETAIL.
--   * forbidden  — the same rule as `selfResponseTransition` in
--                  @service-center/shared: a declined assignment is never
--                  re-accepted by its assignee. PT409, hint
--                  `assignment_response_forbidden`.
--   * otherwise  — a compare-and-set on the status read, restricted to the
--                  caller's own Person; the history row (and any decline
--                  reason) via the existing trigger; the scheduler update
--                  enqueued in the outbox. Returns the updated row, the
--                  transition (`answer` | `withdrawal`) and the effect id.
--
-- Security invoker: RLS decides what the caller can see and update.
-- `respond_to_own_assignment` stays until a later cleanup so either deploy
-- order of API and database works.

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
  v_current public.assignment_status;
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

  -- The history trigger reads the reason from this setting.
  perform set_config('app.assignment_response_note', coalesce(p_reason, ''), true);
  update public.assignments a set status = p_status, responded_at = now()
   where a.id = v_row.id and a.status = v_row.status
     and exists (select 1 from public.people pe where pe.id = a.person_id and pe.profile_id = v_actor)
  returning a.* into v_updated;
  perform set_config('app.assignment_response_note', '', true);

  if v_updated.id is null then
    -- Changed between the read and the write.
    select a.status into v_current from public.assignments a where a.id = v_row.id;
    raise exception 'This assignment changed since you opened it. Refresh and review it again.'
      using errcode = 'PT409', hint = 'assignment_response_stale',
            detail = coalesce(v_current, v_row.status)::text;
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

revoke execute on function public.respond_as_self(uuid, uuid, public.assignment_status, public.assignment_status, text) from public, anon;
grant execute on function public.respond_as_self(uuid, uuid, public.assignment_status, public.assignment_status, text) to authenticated;
