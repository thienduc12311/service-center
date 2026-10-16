-- F01 Pass B — audience and response ownership.
--
-- Prepared/released visibility
--   An assignment is either `released` (its person and the organization can
--   see it — every row that existed before this migration, by explicit
--   policy) or `prepared`: a leader is still drafting it. A prepared row is
--   visible only to people who schedule that team on that plan. Its
--   recipient cannot find it through RLS, the API, joined counts, calendars,
--   feeds, respond links, notifications or email, because every path reads
--   through the policy below or filters on `visibility` explicitly
--   (service-role paths). Visibility is separate from the answer status, the
--   plan's draft/published status and whether anyone was notified.
--   Release is one-way and atomic with its notification effect; to withdraw
--   a released request a scheduler removes it.
--
-- Response owner
--   `response_owner_id` is who hears the answer. It defaults to the person
--   who scheduled the assignment (backfilled from `created_by`), may default
--   from the team, and may be reassigned to anyone who schedules that team on
--   that plan; every change is audited. Answer updates — app or respond link —
--   go to the owner, and the worker re-checks that the owner still schedules
--   that assignment before sending.
--
-- Private person details
--   Contact, address and personal fields on `people`, and email/phone on
--   `profiles`, are readable only with people.view_private (or by the person
--   themself). Everyone else in the organization reads the `people_directory`
--   projection and the non-contact profile columns. The medical note is
--   owner/admin only and is no longer selectable by API roles at all.

-- ====================================================== assignments =========

alter table public.assignments
  add column visibility text not null default 'released'
    check (visibility in ('prepared', 'released')),
  add column released_at timestamptz,
  add column released_by uuid references public.profiles (id) on delete set null,
  add column response_owner_id uuid references public.profiles (id) on delete set null;

-- Explicit migration policy: everything that exists is already released and
-- answered to whoever scheduled it.
update public.assignments
   set released_at = coalesce(notified_at, created_at),
       response_owner_id = created_by
 where released_at is null;

alter table public.assignments
  add constraint assignments_release_shape check ((visibility = 'released') = (released_at is not null));

create index assignments_prepared_idx on public.assignments (plan_id) where visibility = 'prepared';
create index assignments_released_by_idx on public.assignments (released_by);
create index assignments_response_owner_idx on public.assignments (response_owner_id);

-- Team defaults for new requests.
alter table public.teams
  add column default_visibility text not null default 'released'
    check (default_visibility in ('prepared', 'released')),
  add column default_response_owner_id uuid references public.profiles (id) on delete set null;
create index teams_default_response_owner_idx on public.teams (default_response_owner_id);

create table public.assignment_owner_changes (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  assignment_id      uuid not null references public.assignments (id) on delete cascade,
  previous_owner_id  uuid references public.profiles (id) on delete set null,
  new_owner_id       uuid references public.profiles (id) on delete set null,
  changed_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now()
);
create index assignment_owner_changes_assignment_idx on public.assignment_owner_changes (assignment_id, created_at);
create index assignment_owner_changes_org_idx on public.assignment_owner_changes (organization_id);
create index assignment_owner_changes_previous_idx on public.assignment_owner_changes (previous_owner_id);
create index assignment_owner_changes_new_idx on public.assignment_owner_changes (new_owner_id);
create index assignment_owner_changes_changed_by_idx on public.assignment_owner_changes (changed_by);

alter table public.assignment_owner_changes enable row level security;
create policy assignment_owner_changes_select on public.assignment_owner_changes
  for select to authenticated using ((select public.can_schedule_assignment(assignment_id)));
revoke insert, update, delete, truncate on public.assignment_owner_changes from anon, authenticated;

-- ---------------------------------------------------------------- RLS -----
-- A prepared row is the scheduler's draft: hidden from its recipient and
-- from everyone who does not schedule that team on that plan.
drop policy if exists assignments_select on public.assignments;
create policy assignments_select on public.assignments
  for select to authenticated using (
    (visibility = 'released' and (select public.is_org_member(public.org_of_plan(plan_id))))
    or (select public.can_schedule_on_plan(plan_id, team_id))
  );

drop policy if exists assignments_update on public.assignments;
create policy assignments_update on public.assignments
  for update to authenticated
  using (
    (select public.can_schedule_on_plan(plan_id, team_id))
    or (user_id = (select auth.uid()) and visibility = 'released')
  )
  with check (
    (select public.can_schedule_on_plan(plan_id, team_id))
    or (user_id = (select auth.uid()) and visibility = 'released')
  );

-- The assignee may change only their answer; visibility, ownership and
-- release bookkeeping are scheduler-owned. Releasing goes through
-- release_plan_assignments() so it is always paired with its effect.
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

  if new.visibility = 'prepared' and old.visibility = 'released' then
    raise exception 'A released request cannot be made private again; remove it instead'
      using errcode = 'PT409';
  end if;
  if new.visibility = 'released' and old.visibility = 'prepared'
     and coalesce(current_setting('app.releasing_assignments', true), '') <> 'on' then
    raise exception 'Release requests with release_plan_assignments()' using errcode = '42501';
  end if;

  if (select auth.uid()) is not null
     and public.can_schedule_on_plan(old.plan_id, old.team_id) then
    return new;
  end if;

  if new.plan_id            is distinct from old.plan_id
     or new.user_id           is distinct from old.user_id
     or new.team_id           is distinct from old.team_id
     or new.position_id       is distinct from old.position_id
     or new.notes             is distinct from old.notes
     or new.notified_at       is distinct from old.notified_at
     or new.created_by        is distinct from old.created_by
     or new.created_at        is distinct from old.created_at
     or new.visibility        is distinct from old.visibility
     or new.released_at       is distinct from old.released_at
     or new.released_by       is distinct from old.released_by
     or new.response_owner_id is distinct from old.response_owner_id then
    raise exception 'Only a scheduler can change this assignment'
      using errcode = '42501';
  end if;

  if new.status is distinct from old.status
     and (old.status = 'declined' or new.status = 'unconfirmed') then
    raise exception 'A % assignment cannot be changed to %; ask a scheduler to request you again',
      old.status, new.status
      using errcode = 'PT409';
  end if;

  return new;
end;
$$;
revoke execute on function public.guard_assignment_self_response() from public, anon, authenticated;

-- Every insert lands in a consistent release state, whoever writes it.
create or replace function private.stamp_assignment_release()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.visibility = 'released' then
    new.released_at := coalesce(new.released_at, now());
    new.released_by := coalesce(new.released_by, new.created_by);
  else
    new.released_at := null;
    new.released_by := null;
  end if;
  new.response_owner_id := coalesce(new.response_owner_id, new.created_by);
  return new;
end;
$$;
revoke execute on function private.stamp_assignment_release() from public, anon, authenticated;

create trigger assignments_stamp_release
  before insert on public.assignments
  for each row execute function private.stamp_assignment_release();

-- ===================================================== scheduling ===========
-- Replaces F00's version: per-row (or call, or team-default) visibility and
-- response owner. Prepared rows are never notified here.
drop function if exists public.schedule_plan_assignments(uuid, jsonb, boolean, text);

create or replace function public.schedule_plan_assignments(
  p_plan_id        uuid,
  p_assignments    jsonb,
  p_notify         boolean,
  p_effect_key     text default null,
  p_visibility     text default null,
  p_response_owner uuid default null
)
returns setof public.assignments
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org      uuid;
  v_ids      uuid[];
  v_released uuid[];
  v_invalid  int;
begin
  select organization_id into v_org from public.plans where id = p_plan_id;
  if v_org is null then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;
  if not public.can_manage_org(v_org) then
    raise exception 'Only a scheduler can schedule people' using errcode = '42501';
  end if;
  if jsonb_typeof(p_assignments) <> 'array' then
    raise exception 'Assignments must be a list' using errcode = '22023';
  end if;
  if p_visibility is not null and p_visibility not in ('prepared', 'released') then
    raise exception 'Visibility is prepared or released' using errcode = '22023';
  end if;

  select count(*) into v_invalid
    from jsonb_to_recordset(p_assignments) as r(user_id uuid, team_id uuid, position_id uuid, notes text, visibility text)
   where r.user_id is null or r.team_id is null
      or (r.visibility is not null and r.visibility not in ('prepared', 'released'))
      or not exists (select 1 from public.teams t where t.id = r.team_id and t.organization_id = v_org)
      or (r.position_id is not null and not exists (
            select 1 from public.team_positions tp where tp.id = r.position_id and tp.team_id = r.team_id))
      or not exists (select 1 from public.organization_members m
                      where m.organization_id = v_org and m.user_id = r.user_id);
  if v_invalid > 0 then
    raise exception 'Some people, teams or positions do not belong to this organization'
      using errcode = '22023';
  end if;

  -- Each team the caller asks for must be one they schedule on this plan;
  -- RLS would refuse the insert anyway, this names the problem.
  if exists (
    select 1 from jsonb_to_recordset(p_assignments) as r(team_id uuid)
     where not public.can_schedule_on_plan(p_plan_id, r.team_id)
  ) then
    raise exception 'You cannot schedule one of those teams on this plan' using errcode = '42501';
  end if;

  -- An explicit response owner must be able to act on what they receive.
  if p_response_owner is not null and exists (
    select 1 from jsonb_to_recordset(p_assignments) as r(team_id uuid)
     where not private.can_schedule_on_plan(p_response_owner, p_plan_id, r.team_id)
  ) then
    raise exception 'The response owner does not schedule one of those teams' using errcode = '22023';
  end if;

  with requested as (
    select r.*, row_number() over () as ord
      from jsonb_to_recordset(p_assignments) as r(user_id uuid, team_id uuid, position_id uuid, notes text, visibility text)
  ), resolved as (
    select r.*,
           coalesce(r.visibility, p_visibility, t.default_visibility, 'released') as eff_visibility,
           coalesce(
             p_response_owner,
             case when t.default_response_owner_id is not null
                       and private.can_schedule_on_plan(t.default_response_owner_id, p_plan_id, r.team_id)
                  then t.default_response_owner_id end,
             (select auth.uid())
           ) as eff_owner
      from requested r
      join public.teams t on t.id = r.team_id
  ), inserted as (
    insert into public.assignments (
      plan_id, user_id, team_id, position_id, notes, status, created_by, visibility, response_owner_id
    )
    select distinct on (r.user_id, r.team_id, r.position_id)
           p_plan_id, r.user_id, r.team_id, r.position_id, nullif(btrim(r.notes), ''), 'unconfirmed',
           (select auth.uid()), r.eff_visibility, r.eff_owner
      from resolved r
     order by r.user_id, r.team_id, r.position_id, r.ord
    on conflict do nothing
    returning id, visibility
  )
  select coalesce(array_agg(id), '{}'),
         coalesce(array_agg(id) filter (where visibility = 'released'), '{}')
    into v_ids, v_released
    from inserted;

  if p_notify and cardinality(v_released) > 0 then
    perform private.enqueue_assignment_requests(
      p_plan_id, 'assignment_request', v_released,
      coalesce(p_effect_key, 'assignments-scheduled:' || gen_random_uuid()::text),
      (select auth.uid())
    );
  end if;

  return query select a.* from public.assignments a where a.id = any(v_ids);
end;
$$;
revoke execute on function public.schedule_plan_assignments(uuid, jsonb, boolean, text, text, uuid) from public, anon;
grant execute on function public.schedule_plan_assignments(uuid, jsonb, boolean, text, text, uuid) to authenticated;

-- Release reviewed prepared requests and, optionally, record their request
-- effect in the same transaction. p_assignment_ids is exactly what the
-- leader reviewed; rows already released are an idempotent no-op, rows the
-- caller does not schedule are refused. Returns the rows now released by
-- this call (empty on a repeat).
create or replace function public.release_plan_assignments(
  p_plan_id        uuid,
  p_assignment_ids uuid[],
  p_notify         boolean,
  p_effect_key     text
)
returns setof public.assignments
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org      uuid;
  v_ids      uuid[];
  v_unknown  int;
begin
  -- Serializes releases of the same plan. (Not FOR UPDATE: a team-scoped
  -- scheduler may release without being allowed to edit the plan row.)
  perform pg_advisory_xact_lock(hashtextextended('release:' || p_plan_id::text, 0));
  select organization_id into v_org from public.plans where id = p_plan_id;
  if v_org is null or not public.can_manage_org(v_org) then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;
  if p_assignment_ids is null or cardinality(p_assignment_ids) = 0 then
    raise exception 'Choose the requests to release' using errcode = '22023';
  end if;

  -- Every reviewed id must be a row on this plan the caller schedules.
  select count(*) into v_unknown
    from unnest(p_assignment_ids) as ids(id)
   where not exists (
     select 1 from public.assignments a
      where a.id = ids.id and a.plan_id = p_plan_id
        and public.can_schedule_on_plan(a.plan_id, a.team_id));
  if v_unknown > 0 then
    raise exception 'Some of those requests are not on this plan or not yours to release'
      using errcode = '22023';
  end if;

  perform set_config('app.releasing_assignments', 'on', true);
  with released as (
    update public.assignments a
       set visibility = 'released', released_at = now(), released_by = (select auth.uid())
     where a.id = any(p_assignment_ids) and a.plan_id = p_plan_id and a.visibility = 'prepared'
    returning a.id
  )
  select coalesce(array_agg(id), '{}') into v_ids from released;
  perform set_config('app.releasing_assignments', '', true);

  if p_notify and cardinality(v_ids) > 0 then
    perform private.enqueue_assignment_requests(
      p_plan_id, 'assignment_request', v_ids,
      coalesce(p_effect_key, 'assignments-released:' || gen_random_uuid()::text),
      (select auth.uid())
    );
  end if;

  return query select a.* from public.assignments a where a.id = any(v_ids);
end;
$$;
revoke execute on function public.release_plan_assignments(uuid, uuid[], boolean, text) from public, anon;
grant execute on function public.release_plan_assignments(uuid, uuid[], boolean, text) to authenticated;

-- Reassign who receives answers. The caller must schedule each assignment
-- and the new owner must schedule it too, so a reply never lands with
-- someone who cannot act on it. Audited per assignment.
create or replace function public.set_assignment_response_owner(
  p_assignment_ids uuid[],
  p_owner          uuid
)
returns setof public.assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_bad    int;
begin
  if v_caller is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_assignment_ids is null or cardinality(p_assignment_ids) = 0 or p_owner is null then
    raise exception 'Choose the requests and their new owner' using errcode = '22023';
  end if;

  select count(*) into v_bad
    from unnest(p_assignment_ids) as ids(id)
    left join public.assignments a on a.id = ids.id
   where a.id is null or not private.can_schedule_on_plan(v_caller, a.plan_id, a.team_id);
  if v_bad > 0 then
    raise exception 'Assignment not found' using errcode = 'P0002';
  end if;

  select count(*) into v_bad
    from public.assignments a
   where a.id = any(p_assignment_ids)
     and not private.can_schedule_on_plan(p_owner, a.plan_id, a.team_id);
  if v_bad > 0 then
    raise exception 'The new owner does not schedule those requests' using errcode = '22023';
  end if;

  insert into public.assignment_owner_changes (organization_id, assignment_id, previous_owner_id, new_owner_id, changed_by)
  select p.organization_id, a.id, a.response_owner_id, p_owner, v_caller
    from public.assignments a
    join public.plans p on p.id = a.plan_id
   where a.id = any(p_assignment_ids) and a.response_owner_id is distinct from p_owner;

  return query
    update public.assignments a
       set response_owner_id = p_owner
     where a.id = any(p_assignment_ids)
    returning a.*;
end;
$$;
revoke execute on function public.set_assignment_response_owner(uuid[], uuid) from public, anon;
grant execute on function public.set_assignment_response_owner(uuid[], uuid) to authenticated;

-- Requests only ever go out for released rows the caller schedules.
create or replace function private.enqueue_assignment_requests(
  p_plan_id        uuid,
  p_template       public.delivery_template,
  p_assignment_ids uuid[],
  p_effect_key     text,
  p_actor          uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org    uuid;
  v_effect uuid;
  v_ids    uuid[];
begin
  if p_template not in ('assignment_request', 'assignment_reminder') then
    raise exception 'Not an assignment request template' using errcode = '22023';
  end if;

  select organization_id into v_org from public.plans where id = p_plan_id;
  if v_org is null then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;
  if (select auth.uid()) is not null and not public.can_manage_org(v_org) then
    raise exception 'Only a scheduler can notify this plan' using errcode = '42501';
  end if;

  select coalesce(array_agg(a.id order by a.id), '{}')
    into v_ids
    from public.assignments a
   where a.plan_id = p_plan_id and a.id = any(p_assignment_ids)
     and a.visibility = 'released'
     and ((select auth.uid()) is null
          or private.can_schedule_on_plan((select auth.uid()), a.plan_id, a.team_id));

  insert into public.delivery_effects (organization_id, effect_key, template, plan_id, assignment_ids, created_by)
  values (v_org, p_effect_key, p_template, p_plan_id, v_ids, p_actor)
  on conflict (organization_id, effect_key) do nothing
  returning id into v_effect;

  if v_effect is null then
    select id into v_effect from public.delivery_effects
     where organization_id = v_org and effect_key = p_effect_key;
    return v_effect;
  end if;

  insert into public.deliveries (organization_id, effect_id, recipient_id, channel)
  select v_org, v_effect, r.user_id, c.channel
    from (select distinct user_id from public.assignments where id = any(v_ids)) r
   cross join unnest(array['in_app', 'push', 'email']::public.delivery_channel[]) as c(channel);

  return v_effect;
end;
$$;

-- Answers go to each position's response owner (falling back to whoever
-- scheduled it), never to the responder themself.
create or replace function private.enqueue_scheduler_responses(
  p_assignment_ids uuid[],
  p_responder      uuid,
  p_status         public.assignment_status,
  p_transition     text,
  p_effect_key     text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org     uuid;
  v_plan    uuid;
  v_plans   int;
  v_effect  uuid;
begin
  select min(p.organization_id::text)::uuid, min(a.plan_id::text)::uuid, count(distinct a.plan_id)
    into v_org, v_plan, v_plans
    from public.assignments a
    join public.plans p on p.id = a.plan_id
   where a.id = any(p_assignment_ids) and a.user_id = p_responder;

  if v_plans = 0 then
    return null;
  end if;
  if v_plans > 1 then
    raise exception 'One response covers one plan' using errcode = '22023';
  end if;
  if (select auth.uid()) is not null and (select auth.uid()) <> p_responder then
    raise exception 'Only the assignee can answer' using errcode = '42501';
  end if;

  insert into public.delivery_effects (
    organization_id, effect_key, template, plan_id, assignment_ids,
    responder_id, response_status, response_transition, created_by
  )
  select v_org, p_effect_key, 'scheduler_response', v_plan,
         array_agg(a.id order by a.id), p_responder, p_status, p_transition, p_responder
    from public.assignments a
   where a.id = any(p_assignment_ids) and a.user_id = p_responder
  on conflict (organization_id, effect_key) do nothing
  returning id into v_effect;

  if v_effect is null then
    select id into v_effect from public.delivery_effects
     where organization_id = v_org and effect_key = p_effect_key;
    return v_effect;
  end if;

  insert into public.deliveries (organization_id, effect_id, recipient_id, channel)
  select v_org, v_effect, s.owner_id, c.channel
    from (
      select distinct coalesce(a.response_owner_id, a.created_by) as owner_id
        from public.assignments a
       where a.id = any(p_assignment_ids)
         and coalesce(a.response_owner_id, a.created_by) is not null
         and coalesce(a.response_owner_id, a.created_by) <> p_responder
    ) s
   cross join unnest(
     case when p_status = 'declined'
          then array['in_app', 'push', 'email']::public.delivery_channel[]
          else array['in_app', 'push']::public.delivery_channel[]
     end
   ) as c(channel);

  return v_effect;
end;
$$;

-- The public respond link answers only released positions.
create or replace function public.respond_via_assignment_link(
  p_token_hash text,
  p_status     public.assignment_status
)
returns table (outcome text, assignments_updated int, effect_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_link       public.assignment_notifications;
  v_ids        uuid[];
  v_withdrawal boolean;
  v_effect     uuid;
begin
  if p_status not in ('confirmed', 'declined') then
    raise exception 'An answer is either confirmed or declined' using errcode = '22023';
  end if;

  select * into v_link from public.assignment_notifications
   where token_hash = p_token_hash
   for update;
  if not found then
    return query select 'not_found'::text, 0, null::uuid;
    return;
  end if;
  if v_link.responded_at is not null then
    return query select 'used'::text, 0, null::uuid;
    return;
  end if;
  if v_link.expires_at <= now() then
    return query select 'expired'::text, 0, null::uuid;
    return;
  end if;

  select coalesce(array_agg(l.id), '{}'), coalesce(bool_and(l.status = 'confirmed'), false)
    into v_ids, v_withdrawal
    from (
      select a.id, a.status
        from public.assignments a
       where a.plan_id = v_link.plan_id
         and a.user_id = v_link.user_id
         and a.visibility = 'released'
         and a.status = any(
           case when p_status = 'confirmed'
                then array['unconfirmed']::public.assignment_status[]
                else array['unconfirmed', 'confirmed']::public.assignment_status[]
           end)
       for update
    ) l;

  update public.assignments
     set status = p_status, responded_at = now()
   where id = any(v_ids);

  update public.assignment_notifications set responded_at = now() where id = v_link.id;

  if cardinality(v_ids) > 0 then
    v_effect := private.enqueue_scheduler_responses(
      v_ids, v_link.user_id, p_status,
      case when p_status = 'declined' and v_withdrawal then 'withdrawal' else 'response' end,
      'assignment-link-response:' || v_link.id::text
    );
  end if;

  return query select 'ok'::text, cardinality(v_ids), v_effect;
end;
$$;

-- Conflicts: a prepared request is still a commitment the scheduler is
-- making, so it counts — but only rows the caller could see are described.
create or replace function public.scheduling_conflicts(
  p_organization_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_user_ids uuid[] default null
)
returns table (
  user_id uuid,
  conflict_type text,
  detail text,
  starts_at timestamptz,
  ends_at timestamptz,
  plan_id uuid
)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null
     and not public.has_capability_anywhere(p_organization_id, 'scheduling.manage') then
    raise exception 'Only a scheduler can check conflicts' using errcode = '42501';
  end if;

  return query
  with candidates as (
    select m.user_id
    from public.organization_members m
    where m.organization_id = p_organization_id
      and m.status = 'active'
      and (p_user_ids is null or m.user_id = any (p_user_ids))
  )
  select b.user_id,
         'blockout'::text,
         coalesce(b.reason, 'Unavailable'),
         b.starts_at,
         b.ends_at,
         null::uuid
  from public.blockouts b
  join candidates c on c.user_id = b.user_id
  where b.organization_id = p_organization_id
    and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')

  union all

  select a.user_id,
         'double_booked'::text,
         p.title,
         pt.starts_at,
         pt.ends_at,
         p.id
  from public.assignments a
  join candidates c   on c.user_id = a.user_id
  join public.plans p on p.id = a.plan_id
  join public.plan_times pt on pt.plan_id = p.id and pt.kind = 'service'
  where p.organization_id = p_organization_id
    and a.status <> 'declined'
    and (a.visibility = 'released' or auth.uid() is null
         or public.can_schedule_on_plan(a.plan_id, a.team_id))
    and tstzrange(pt.starts_at, pt.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)');
end;
$$;

-- ============================================== private person details =====

-- people: full rows only with people.view_private / people.manage, or self.
drop policy if exists people_select on public.people;
create policy people_select on public.people
  for select to authenticated using (
    profile_id = (select auth.uid())
    or (select public.has_capability(organization_id, 'people.view_private'))
    or (select public.has_capability(organization_id, 'people.manage'))
  );

-- The medical note is not selectable by API roles; owners/admins read it
-- through person_medical_note().
revoke select on public.people from anon, authenticated;
grant select (
  id, organization_id, profile_id, first_name, last_name, avatar_url,
  email, phone, phone_carrier, address_line1, address_line2, city, state_province,
  postal_code, country, campus, person_type, gender, birthdate, marital_status,
  anniversary_date, school, created_by, created_at, updated_at
) on public.people to authenticated;

create or replace function public.person_medical_note(p_person uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.medical_note from public.people p
   where p.id = p_person and public.is_org_admin(p.organization_id);
$$;
revoke execute on function public.person_medical_note(uuid) from public, anon;
grant execute on function public.person_medical_note(uuid) to authenticated, service_role;

-- What every member may see of the roster: name, picture, campus.
create or replace view public.people_directory
with (security_barrier = true) as
  select p.id, p.organization_id, p.profile_id, p.first_name, p.last_name,
         p.avatar_url, p.campus, p.person_type, p.created_at, p.updated_at
    from public.people p
   where public.is_org_member(p.organization_id);
revoke all on public.people_directory from anon, public;
grant select on public.people_directory to authenticated, service_role;

-- profiles: contact columns are not selectable by API roles. Names and
-- pictures stay visible to co-members as before.
revoke select on public.profiles from anon, authenticated;
grant select (id, full_name, avatar_url, created_at, updated_at) on public.profiles to authenticated;

-- The signed-in user's own profile, contact included.
create or replace function public.my_profile()
returns public.profiles
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.profiles where id = (select auth.uid());
$$;
revoke execute on function public.my_profile() from public, anon;
grant execute on function public.my_profile() to authenticated;

-- Contact details of members of one organization: people.view_private, or
-- your own. Other rows are simply absent.
create or replace function public.member_contacts(p_org uuid, p_user_ids uuid[])
returns table (user_id uuid, email text, phone text)
language sql
stable
security definer
set search_path = ''
as $$
  select pr.id, pr.email, pr.phone
    from public.profiles pr
    join public.organization_members m on m.user_id = pr.id and m.organization_id = p_org
   where pr.id = any(p_user_ids)
     and (pr.id = (select auth.uid()) or public.has_capability(p_org, 'people.view_private'));
$$;
revoke execute on function public.member_contacts(uuid, uuid[]) from public, anon;
grant execute on function public.member_contacts(uuid, uuid[]) to authenticated;

comment on column public.assignments.visibility is
  'F01: prepared rows are visible only to schedulers of that team on that plan; released rows to the organization.';
comment on column public.assignments.response_owner_id is
  'F01: who receives answer updates; defaults to the scheduler, reassigned with set_assignment_response_owner().';
comment on view public.people_directory is
  'F01: non-private roster projection readable by every organization member.';
