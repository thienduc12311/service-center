-- Assignment response history and self-response transition policy.
--
-- A scheduled person answers their own assignment directly under the
-- `assignments_update` policy, so the rules below live in the database rather
-- than only in the API: a client calling PostgREST with its own token gets the
-- same answer as the route does.
--
--   * The assignee (and the public respond-link path, which runs as
--     service_role without a user) may move unconfirmed -> confirmed/declined
--     and confirmed -> declined (a deliberate withdrawal). A declined
--     assignment cannot be re-accepted and nothing they do can reset an answer
--     to unconfirmed; a scheduler re-requests or reassigns instead.
--   * The assignee may change only the answer itself: status and responded_at.
--     Plan, person, team, position, scheduler notes and delivery bookkeeping
--     stay scheduler-owned.
--   * Every status change, by anyone, appends an assignment_responses row, so
--     the original answer survives a later withdrawal or re-request.
--   * A decline reason lives only in that history. Every organization member
--     can read `assignments`; the reason is for the person and the
--     organization's schedulers.

create table public.assignment_responses (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  assignment_id    uuid not null references public.assignments (id) on delete cascade,
  -- Denormalised so the read policy is a plain column comparison.
  assignee_id      uuid not null references public.profiles (id) on delete cascade,
  -- Null when the change came from a respond link (no signed-in user).
  actor_id         uuid references public.profiles (id) on delete set null,
  previous_status  public.assignment_status not null,
  status           public.assignment_status not null,
  response_note    text check (response_note is null or char_length(response_note) <= 500),
  created_at       timestamptz not null default now(),
  constraint assignment_responses_changed check (previous_status <> status)
);

create index assignment_responses_assignment_idx
  on public.assignment_responses (assignment_id, created_at);
create index assignment_responses_organization_idx
  on public.assignment_responses (organization_id);
create index assignment_responses_assignee_idx
  on public.assignment_responses (assignee_id);
create index assignment_responses_actor_idx
  on public.assignment_responses (actor_id);

alter table public.assignment_responses enable row level security;

-- Readable by the person it concerns and by the organization's schedulers.
-- Rows are written only by the trigger below; no client role may insert,
-- update or delete history.
create policy assignment_responses_select on public.assignment_responses
  for select to authenticated using (
    assignee_id = (select auth.uid())
    or (select public.can_manage_org(organization_id))
  );

revoke insert, update, delete, truncate on public.assignment_responses from anon, authenticated;

-- ------------------------------------------------------------- guard -------
-- Security invoker so current_user is the API role making the change. The
-- rules bind the API roles only; migrations and maintenance run as owner.
create or replace function public.guard_assignment_self_response()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon', 'service_role') then
    return new;
  end if;

  -- Schedulers keep full control, including re-requesting a declined answer.
  if (select auth.uid()) is not null
     and public.can_manage_org(public.org_of_plan(old.plan_id)) then
    return new;
  end if;

  if new.plan_id      is distinct from old.plan_id
     or new.user_id     is distinct from old.user_id
     or new.team_id     is distinct from old.team_id
     or new.position_id is distinct from old.position_id
     or new.notes       is distinct from old.notes
     or new.notified_at is distinct from old.notified_at
     or new.created_by  is distinct from old.created_by
     or new.created_at  is distinct from old.created_at then
    raise exception 'Only a scheduler can change this assignment'
      using errcode = '42501';
  end if;

  -- PT409 makes PostgREST answer a direct table call with HTTP 409.
  if new.status is distinct from old.status
     and (old.status = 'declined' or new.status = 'unconfirmed') then
    raise exception 'A % assignment cannot be changed to %; ask a scheduler to request you again',
      old.status, new.status
      using errcode = 'PT409';
  end if;

  return new;
end;
$$;

create trigger assignments_guard_self_response
  before update on public.assignments
  for each row execute function public.guard_assignment_self_response();

-- ----------------------------------------------------------- history -------
-- The reason, when there is one, arrives through a transaction-local setting
-- that only respond_to_own_assignment() sets; PostgREST does not expose
-- set_config, so a client cannot attach text to someone else's change.
create or replace function public.record_assignment_response()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.assignment_responses (
    organization_id, assignment_id, assignee_id, actor_id,
    previous_status, status, response_note
  )
  values (
    public.org_of_plan(new.plan_id), new.id, new.user_id, (select auth.uid()),
    old.status, new.status,
    nullif(current_setting('app.assignment_response_note', true), '')
  );
  return null;
end;
$$;

create trigger assignments_record_response
  after update of status on public.assignments
  for each row
  when (old.status is distinct from new.status)
  execute function public.record_assignment_response();

-- ---------------------------------------------------- answer with reason ---
-- One short transaction: compare-and-set the caller's own assignment from the
-- status they saw, and record the reason with the history row. Security
-- invoker, so RLS and the guard above apply exactly as for a direct update.
-- Returns no row when the assignment is not theirs or no longer has
-- p_expected_status.
create or replace function public.respond_to_own_assignment(
  p_assignment_id   uuid,
  p_status          public.assignment_status,
  p_expected_status public.assignment_status,
  p_reason          text default null
)
returns setof public.assignments
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_status = 'unconfirmed' then
    raise exception 'An answer is either confirmed or declined' using errcode = '22023';
  end if;
  if p_reason is not null and p_status <> 'declined' then
    raise exception 'A reason can only accompany a decline' using errcode = '22023';
  end if;
  if char_length(p_reason) > 500 then
    raise exception 'Keep the reason under 500 characters' using errcode = '22001';
  end if;

  perform set_config('app.assignment_response_note', coalesce(p_reason, ''), true);

  return query
    update public.assignments
    set status = p_status, responded_at = now()
    where id = p_assignment_id
      and user_id = (select auth.uid())
      and status = p_expected_status
    returning *;

  perform set_config('app.assignment_response_note', '', true);
end;
$$;

-- Trigger functions are invoked by the trigger, never called directly.
revoke execute on function public.guard_assignment_self_response() from public, anon, authenticated;
revoke execute on function public.record_assignment_response() from public, anon, authenticated;
revoke execute on function public.respond_to_own_assignment(uuid, public.assignment_status, public.assignment_status, text) from public, anon;
grant execute on function public.respond_to_own_assignment(uuid, public.assignment_status, public.assignment_status, text) to authenticated;

comment on table public.assignment_responses is
  'Append-only history of assignment status changes, written by trigger. Holds decline reasons.';
comment on function public.respond_to_own_assignment(uuid, public.assignment_status, public.assignment_status, text) is
  'Compare-and-set answer to the caller''s own assignment, recording an optional decline reason.';
