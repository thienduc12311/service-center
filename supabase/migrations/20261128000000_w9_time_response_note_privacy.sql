-- W9-JRN-D1: a per-time decline reason is private.
--
-- `assignment_time_responses.response_note` is the free-text reason a member
-- gives when they decline one time of a request (snapshot answer flow). The
-- row's SELECT policy follows the parent assignment, so every member who can
-- read the roster could also read that reason. The per-time *status* must
-- stay readable by that same audience (staffing/roster views), but the note
-- is for the assignee, the response owner and whoever schedules the
-- assignment only — the audience of `assignment_time_response_history`
-- plus the response owner who receives the answer.
--
-- Design: column privileges, not a data move. Nothing is dropped or
-- rewritten, and every writer (security definer functions that run as the
-- table owner) keeps writing the note unchanged.
--   1. `authenticated` and `anon` keep SELECT on every column except
--      `response_note` (anon still has no policy, so it reads zero rows).
--      A direct read of `response_note` or `select *` is now a permission
--      error, so callers must name columns.
--   2. `public.assignment_time_response_notes(uuid[])` returns notes only for
--      rows the caller may see under the private audience above.
-- `service_role` is unchanged (verified link-token review reads with it).

revoke select on public.assignment_time_responses from anon, authenticated;
grant select (assignment_id, plan_time_id, status, actor_id, responded_at)
  on public.assignment_time_responses to anon, authenticated;

comment on column public.assignment_time_responses.response_note is
  'W9-JRN-D1: private decline reason. Not selectable by anon or authenticated; read it through assignment_time_response_notes().';

-- Notes for the given assignments that the caller may read: the assignee
-- (linked Person's profile), the assignment's response owner, or a scheduler
-- of that assignment — always as an active member of the plan's organization.
-- Rows without a note are omitted.
create or replace function public.assignment_time_response_notes(p_assignment_ids uuid[])
returns table (assignment_id uuid, plan_time_id uuid, response_note text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.assignment_id, r.plan_time_id, r.response_note
    from public.assignment_time_responses r
    join public.assignments a on a.id = r.assignment_id
    join public.plans p on p.id = a.plan_id
   where r.assignment_id = any(p_assignment_ids)
     and r.response_note is not null
     and private.is_active_member((select auth.uid()), p.organization_id)
     and (
       exists (
         select 1 from public.people pe
          where pe.id = a.person_id and pe.profile_id = (select auth.uid())
       )
       or a.response_owner_id = (select auth.uid())
       or private.can_schedule_assignment((select auth.uid()), a.id)
     )
   order by r.assignment_id, r.plan_time_id;
$$;
revoke execute on function public.assignment_time_response_notes(uuid[]) from public, anon;
grant execute on function public.assignment_time_response_notes(uuid[]) to authenticated, service_role;
comment on function public.assignment_time_response_notes(uuid[]) is
  'W9-JRN-D1: per-time decline reasons for the assignee, response owner and schedulers only.';
