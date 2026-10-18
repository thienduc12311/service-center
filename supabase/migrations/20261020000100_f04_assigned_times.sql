-- F04 — Assignment-specific attendance times and accurate conflicts.
--
-- Builds on MOB-005 Pass B (stable `plan_times.id`, `attendance_mode`
-- all/selected, `assignment_attendance_times`, exact half-open conflicts).
-- This migration adds what was still missing:
--
--   * One attendance resolver (`private.assignment_attendance`) that every
--     consumer reads: conflicts, response snapshots, schedule, calendar, feed,
--     email ICS and impact previews. A plan with no times at all resolves to a
--     documented `untimed_fallback` interval (service_date + 2 hours) that is
--     always labelled as such, never presented as a real time.
--   * Typed, redacted conflict checks (`check_assignment_conflicts`) with a
--     separate `scheduling.override_conflicts` capability. Details of a plan
--     the caller cannot schedule or edit read "Another commitment"; blockout
--     reasons are never returned.
--   * Commit-time safety: every assignment writer takes per-Person advisory
--     locks (sorted, so no deadlock between writers) and a deferred constraint
--     trigger re-checks the committed scope. A stale preview therefore cannot
--     let two conflicting requests both commit. An override needs the
--     capability and a reason and is written to `assignment_conflict_overrides`.
--   * Time-edit impact preview/commit: added/removed/changed times, which
--     requests gain/lose/change attendance, orphaned selected requests (must
--     be resolved explicitly), live response requests that become stale, and a
--     hash that makes a commit fail when the impact changed since the preview.
--     Affected released requests are re-sent through the outbox in the same
--     transaction; answers are never rewritten.
--   * Recipient-specific calendar sequencing (`attendance_calendar_states`):
--     the UID stays `plan-time-<id>`; the SEQUENCE is the time's
--     `ics_sequence` plus a per-Person offset bumped whenever that Person's
--     applicability for the time flips, so a feed can publish CANCELLED for a
--     time someone no longer attends.
--
-- Time policy:
--   added time    — joins every `all` request; `selected` requests never
--                   acquire it silently.
--   removed time  — its selection links go; a `selected` request left with no
--                   time must be resolved (`all` or `remove`) in the commit;
--                   per-time answers for it go, history keeps a NULL time.
--   changed time  — start/end/kind change is material: live requests are
--                   superseded and affected people re-requested.

-- ====================================================== capability ======

alter table public.access_grants drop constraint access_grants_capability_scope;
alter table public.access_grants add constraint access_grants_capability_scope check (
  scope_type = 'organization'
  or (scope_type in ('folder', 'service_type')
      and capability in ('plans.edit', 'scheduling.manage', 'scheduling.override_conflicts', 'teams.manage'))
  or (scope_type = 'team'
      and capability in ('scheduling.manage', 'scheduling.override_conflicts', 'teams.manage'))
);

create or replace function private.can_override_conflicts(p_user uuid, p_plan uuid, p_team uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select private.capability_for(p_user, p.organization_id, 'scheduling.override_conflicts',
                                  p.service_type_id, p_team)
      from public.plans p where p.id = p_plan
  ), false);
$$;
revoke execute on function private.can_override_conflicts(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function private.can_override_conflicts(uuid, uuid, uuid) to authenticated, service_role;

-- ================================================= time deletion FKs =====
-- A removed time takes its current per-time answers with it; the append-only
-- history keeps the answer with a NULL time.

alter table public.assignment_time_responses
  drop constraint assignment_time_responses_plan_time_id_fkey,
  add constraint assignment_time_responses_plan_time_id_fkey
    foreign key (plan_time_id) references public.plan_times (id) on delete cascade;

-- MOB-005 made selection links ON DELETE RESTRICT, which is checked while
-- each cascade runs: deleting a whole plan failed when the cascade reached
-- plan_times before the assignments that reference them. The link now
-- cascades, and a guard refuses deleting a selected time directly while its
-- plan still exists (apply_plan_time_changes removes reviewed links first).
alter table public.assignment_attendance_times
  drop constraint assignment_attendance_times_plan_time_id_fkey,
  add constraint assignment_attendance_times_plan_time_id_fkey
    foreign key (plan_time_id) references public.plan_times (id) on delete cascade;

create or replace function private.guard_selected_time_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.assignment_attendance_times aat where aat.plan_time_id = old.id)
     and exists (select 1 from public.plans p where p.id = old.plan_id) then
    raise exception 'A selected attendance time is still assigned; review affected requests first'
      using errcode = 'PT409', hint = 'time_impact_required';
  end if;
  return old;
end;
$$;
revoke execute on function private.guard_selected_time_delete() from public, anon, authenticated;
create trigger plan_times_guard_selected_delete
  before delete on public.plan_times
  for each row execute function private.guard_selected_time_delete();

alter table public.assignment_time_response_history
  alter column plan_time_id drop not null,
  drop constraint assignment_time_response_history_plan_time_id_fkey,
  add constraint assignment_time_response_history_plan_time_id_fkey
    foreign key (plan_time_id) references public.plan_times (id) on delete set null;

-- ================================================ attendance resolver =====
-- security_invoker: callers keep their own RLS; security definer functions
-- read everything, as they already do.

create view private.assignment_attendance with (security_invoker = true) as
select a.id as assignment_id, a.person_id, a.plan_id, a.team_id, a.position_id,
       a.status, a.visibility, a.attendance_mode,
       pt.id as plan_time_id, pt.kind::text as kind, pt.name, pt.starts_at, pt.ends_at,
       'plan_time'::text as source
  from public.assignments a
  join public.plan_times pt on pt.plan_id = a.plan_id
 where a.attendance_mode = 'all'
    or exists (select 1 from public.assignment_attendance_times aat
                where aat.assignment_id = a.id and aat.plan_time_id = pt.id)
union all
select a.id, a.person_id, a.plan_id, a.team_id, a.position_id,
       a.status, a.visibility, a.attendance_mode,
       null::uuid, 'service'::text, null::text, p.service_date, p.service_date + interval '2 hours',
       'untimed_fallback'::text
  from public.assignments a
  join public.plans p on p.id = a.plan_id
 where not exists (select 1 from public.plan_times pt where pt.plan_id = a.plan_id);

comment on view private.assignment_attendance is
  'F04: the one definition of which intervals an assignment commits a Person to. untimed_fallback rows exist only for plans with no times.';
grant select on private.assignment_attendance to authenticated, service_role;

-- Snapshot scope keeps its MOB-005 meaning (real time ids only, empty for an
-- untimed plan) but now reads the shared resolver.
create or replace function private.assignment_time_ids(p_assignment uuid)
returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(v.plan_time_id order by v.starts_at, v.plan_time_id), '{}')
    from private.assignment_attendance v
   where v.assignment_id = p_assignment and v.plan_time_id is not null;
$$;

-- Caller-scoped reader for API surfaces (schedule, release review, calendar).
create or replace function public.assignment_attendance_for(p_assignment_ids uuid[])
returns table (
  assignment_id uuid,
  plan_time_id uuid,
  kind text,
  name text,
  starts_at timestamptz,
  ends_at timestamptz,
  source text
)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if coalesce(cardinality(p_assignment_ids), 0) > 2000 then
    raise exception 'Ask for at most 2000 requests at a time' using errcode = '22023';
  end if;
  return query
  select v.assignment_id, v.plan_time_id, v.kind, v.name, v.starts_at, v.ends_at, v.source
    from private.assignment_attendance v
   where v.assignment_id = any(coalesce(p_assignment_ids, '{}'))
   order by v.assignment_id, v.starts_at, v.plan_time_id;
end;
$$;
revoke execute on function public.assignment_attendance_for(uuid[]) from public, anon;
grant execute on function public.assignment_attendance_for(uuid[]) to authenticated, service_role;

-- The blockout preview's affected list now reads the resolver too.
create or replace function public.blockout_affected_assignments(
  p_organization_id uuid, p_person_id uuid, p_ranges jsonb
)
returns table(assignment_id uuid, plan_id uuid, plan_title text, assignment_status public.assignment_status,
  visibility text, team_name text, position_name text, time_id uuid, time_kind text, time_name text,
  starts_at timestamptz, ends_at timestamptz)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if jsonb_typeof(p_ranges) <> 'array' or jsonb_array_length(p_ranges) not between 1 and 120 then
    raise exception 'Provide 1 to 120 ranges' using errcode = '22023';
  end if;
  return query with ranges as (
    select * from jsonb_to_recordset(p_ranges) r(starts_at timestamptz, ends_at timestamptz)
  ) select distinct v.assignment_id, p.id, p.title, v.status, v.visibility::text, t.name, tp.name,
      v.plan_time_id, v.kind, v.name, v.starts_at, v.ends_at
    from private.assignment_attendance v
    join public.plans p on p.id = v.plan_id
    left join public.teams t on t.id = v.team_id
    left join public.team_positions tp on tp.id = v.position_id
    join ranges r on tstzrange(r.starts_at, r.ends_at, '[)') && tstzrange(v.starts_at, v.ends_at, '[)')
   where p.organization_id = p_organization_id and v.person_id = p_person_id and v.status <> 'declined'
   order by v.starts_at;
end $$;

-- ============================================ recipient calendar state ====

create table public.attendance_calendar_states (
  person_id uuid not null references public.people (id) on delete cascade,
  plan_time_id uuid not null references public.plan_times (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  applicable boolean not null,
  sequence_offset int not null default 0 check (sequence_offset >= 0),
  updated_at timestamptz not null default now(),
  primary key (person_id, plan_time_id)
);
create index attendance_calendar_states_time_idx on public.attendance_calendar_states (plan_time_id);
create index attendance_calendar_states_org_idx on public.attendance_calendar_states (organization_id);
comment on table public.attendance_calendar_states is
  'F04: per-Person ICS sequence offset for a plan time. SEQUENCE = plan_times.ics_sequence + sequence_offset; applicable=false publishes CANCELLED.';

alter table public.attendance_calendar_states enable row level security;
create policy attendance_calendar_states_select_own on public.attendance_calendar_states
  for select to authenticated
  using (exists (select 1 from public.people p
                  where p.id = attendance_calendar_states.person_id
                    and p.profile_id = (select auth.uid())));
revoke insert, update, delete on public.attendance_calendar_states from anon, authenticated;

create or replace function private.sync_attendance_calendar(p_person uuid, p_plan uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  if p_person is null or p_plan is null then return; end if;
  select organization_id into v_org from public.plans where id = p_plan;
  if v_org is null then return; end if;

  insert into public.attendance_calendar_states (person_id, plan_time_id, organization_id, applicable)
  select distinct p_person, v.plan_time_id, v_org, true
    from private.assignment_attendance v
   where v.person_id = p_person and v.plan_id = p_plan and v.plan_time_id is not null
     and v.status <> 'declined' and v.visibility = 'released'
  on conflict (person_id, plan_time_id) do update
     set applicable = true,
         sequence_offset = public.attendance_calendar_states.sequence_offset + 1,
         updated_at = now()
   where not public.attendance_calendar_states.applicable;

  update public.attendance_calendar_states s
     set applicable = false, sequence_offset = s.sequence_offset + 1, updated_at = now()
   where s.person_id = p_person and s.applicable
     and s.plan_time_id in (select pt.id from public.plan_times pt where pt.plan_id = p_plan)
     and not exists (
       select 1 from private.assignment_attendance v
        where v.person_id = p_person and v.plan_id = p_plan and v.plan_time_id = s.plan_time_id
          and v.status <> 'declined' and v.visibility = 'released');
end;
$$;
revoke execute on function private.sync_attendance_calendar(uuid, uuid) from public, anon, authenticated;

create or replace function private.attendance_calendar_on_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform private.sync_attendance_calendar(old.person_id, old.plan_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform private.sync_attendance_calendar(new.person_id, new.plan_id);
  end if;
  return null;
end;
$$;
revoke execute on function private.attendance_calendar_on_assignment() from public, anon, authenticated;
create trigger assignments_attendance_calendar
  after insert or delete or update of person_id, plan_id, status, visibility, attendance_mode
  on public.assignments
  for each row execute function private.attendance_calendar_on_assignment();

create or replace function private.attendance_calendar_on_selection()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_person uuid;
  v_plan uuid;
begin
  select a.person_id, a.plan_id into v_person, v_plan
    from public.assignments a where a.id = coalesce(new.assignment_id, old.assignment_id);
  perform private.sync_attendance_calendar(v_person, v_plan);
  return null;
end;
$$;
revoke execute on function private.attendance_calendar_on_selection() from public, anon, authenticated;
create trigger assignment_attendance_times_calendar
  after insert or delete on public.assignment_attendance_times
  for each row execute function private.attendance_calendar_on_selection();

-- A new time joins every all-times request on its plan.
create or replace function private.attendance_calendar_on_time()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_person uuid;
begin
  for v_person in
    select distinct a.person_id from public.assignments a
     where a.plan_id = new.plan_id and a.attendance_mode = 'all'
  loop
    perform private.sync_attendance_calendar(v_person, new.plan_id);
  end loop;
  return null;
end;
$$;
revoke execute on function private.attendance_calendar_on_time() from public, anon, authenticated;
create trigger plan_times_attendance_calendar
  after insert on public.plan_times
  for each row execute function private.attendance_calendar_on_time();

insert into public.attendance_calendar_states (person_id, plan_time_id, organization_id, applicable)
select distinct v.person_id, v.plan_time_id, p.organization_id, true
  from private.assignment_attendance v
  join public.plans p on p.id = v.plan_id
 where v.plan_time_id is not null and v.status <> 'declined' and v.visibility = 'released'
on conflict do nothing;

-- ================================================== conflict resolver =====
-- Candidates: [{key, person_id, plan_id, team_id?, position_id?,
--               attendance_mode?, time_ids?, intervals?}]. `intervals`
-- ([{plan_time_id, starts_at, ends_at}]) replaces the plan's stored times and
-- is used to preview a time edit before it is saved.
--
-- Excluded: the assignment ids passed, and the identical obligation (same
-- plan/team/position — scheduling it again is a no-op). Another position on
-- the same plan still conflicts when the times overlap.

create or replace function private.attendance_conflicts(
  p_organization_id uuid,
  p_viewer uuid,
  p_candidates jsonb,
  p_exclude_assignment_ids uuid[] default '{}'
)
returns table (
  candidate_key text,
  person_id uuid,
  candidate_plan_id uuid,
  candidate_team_id uuid,
  kind text,
  severity text,
  plan_time_id uuid,
  interval_source text,
  starts_at timestamptz,
  ends_at timestamptz,
  other_plan_id uuid,
  other_assignment_id uuid,
  other_plan_time_id uuid,
  other_time_kind text,
  detail text,
  redacted boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if jsonb_typeof(p_candidates) <> 'array' or jsonb_array_length(p_candidates) > 500 then
    raise exception 'Check at most 500 candidates at a time' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_candidates) as c(
        person_id uuid, plan_id uuid, team_id uuid, attendance_mode text, time_ids uuid[], intervals jsonb)
     where c.person_id is null or c.plan_id is null
        or not exists (select 1 from public.people pe
                        where pe.id = c.person_id and pe.organization_id = p_organization_id)
        or not exists (select 1 from public.plans pl
                        where pl.id = c.plan_id and pl.organization_id = p_organization_id)
        or (c.team_id is not null and not exists (
              select 1 from public.teams t where t.id = c.team_id and t.organization_id = p_organization_id))
        or coalesce(c.attendance_mode, 'all') not in ('all', 'selected')
        or (c.intervals is null and coalesce(c.attendance_mode, 'all') = 'selected'
            and coalesce(cardinality(c.time_ids), 0) = 0)
        or (c.intervals is not null and jsonb_typeof(c.intervals) <> 'array')
        or exists (select 1 from unnest(coalesce(c.time_ids, '{}')) t(id)
                    where not exists (select 1 from public.plan_times pt
                                       where pt.id = t.id and pt.plan_id = c.plan_id))
  ) then
    raise exception 'Conflict scope must name People, plans and times of this organization'
      using errcode = '22023';
  end if;

  return query
  with cand as (
    select coalesce(c.key, c.person_id::text || ':' || c.plan_id::text) ckey,
           c.person_id, c.plan_id, c.team_id, c.position_id,
           coalesce(c.attendance_mode, 'all') mode, coalesce(c.time_ids, '{}') time_ids, c.intervals
      from jsonb_to_recordset(p_candidates) as c(
        key text, person_id uuid, plan_id uuid, team_id uuid, position_id uuid,
        attendance_mode text, time_ids uuid[], intervals jsonb)
  ), req as (
    select c.ckey, c.person_id, c.plan_id, c.team_id, c.position_id,
           (i->>'plan_time_id')::uuid plan_time_id,
           case when i->>'plan_time_id' is null then 'untimed_fallback' else 'plan_time' end src,
           (i->>'starts_at')::timestamptz s, (i->>'ends_at')::timestamptz e
      from cand c cross join lateral jsonb_array_elements(c.intervals) i
     where c.intervals is not null
    union all
    select c.ckey, c.person_id, c.plan_id, c.team_id, c.position_id,
           pt.id, 'plan_time', pt.starts_at, pt.ends_at
      from cand c join public.plan_times pt on pt.plan_id = c.plan_id
     where c.intervals is null and (c.mode = 'all' or pt.id = any(c.time_ids))
    union all
    select c.ckey, c.person_id, c.plan_id, c.team_id, c.position_id,
           null::uuid, 'untimed_fallback', pl.service_date, pl.service_date + interval '2 hours'
      from cand c join public.plans pl on pl.id = c.plan_id
     where c.intervals is null
       and not exists (select 1 from public.plan_times pt where pt.plan_id = c.plan_id)
  ), existing as (
    select v.assignment_id, v.person_id, v.plan_id, v.team_id, v.position_id,
           v.plan_time_id, v.kind, v.name, v.starts_at, v.ends_at, pl.title
      from private.assignment_attendance v
      join public.plans pl on pl.id = v.plan_id
     where pl.organization_id = p_organization_id
       and v.person_id in (select c.person_id from cand c)
       and v.status <> 'declined'
       and not (v.assignment_id = any(coalesce(p_exclude_assignment_ids, '{}')))
       and (v.visibility = 'released' or p_viewer is null
            or private.can_schedule_on_plan(p_viewer, v.plan_id, v.team_id))
  )
  select r.ckey, r.person_id, r.plan_id, r.team_id, 'blockout'::text, 'blocking'::text,
         r.plan_time_id, r.src, greatest(r.s, b.starts_at), least(r.e, b.ends_at),
         null::uuid, null::uuid, null::uuid, null::text,
         'Unavailable'::text, false
    from req r
    join public.blockouts b
      on b.organization_id = p_organization_id and b.person_id = r.person_id
     and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(r.s, r.e, '[)')
  union all
  select r.ckey, r.person_id, r.plan_id, r.team_id, 'overlapping_commitment'::text,
         -- Two positions on the same plan is a deliberate double role: shown,
         -- never ignored, but not blocking. Other plans block.
         case when e.plan_id = r.plan_id then 'warning' else 'blocking' end,
         r.plan_time_id, r.src, greatest(r.s, e.starts_at), least(r.e, e.ends_at),
         case when x.visible then e.plan_id end,
         case when x.visible then e.assignment_id end,
         case when x.visible then e.plan_time_id end,
         e.kind,
         case when x.visible then e.title || coalesce(' · ' || e.name, '') else 'Another commitment' end,
         not x.visible
    from req r
    join existing e
      on e.person_id = r.person_id
     and tstzrange(e.starts_at, e.ends_at, '[)') && tstzrange(r.s, r.e, '[)')
     and not (e.plan_id = r.plan_id and r.team_id is not null and e.team_id = r.team_id
              and e.position_id is not distinct from r.position_id)
    cross join lateral (
      select (p_viewer is null
              or private.can_schedule_on_plan(p_viewer, e.plan_id, e.team_id)
              or private.can_edit_plan(p_viewer, e.plan_id)) as visible
    ) x
   order by 2, 9, 10;
end;
$$;
revoke execute on function private.attendance_conflicts(uuid, uuid, jsonb, uuid[]) from public, anon, authenticated;
grant execute on function private.attendance_conflicts(uuid, uuid, jsonb, uuid[]) to service_role;

-- Typed check for clients: kind, severity, intervals, redacted detail and
-- whether the caller may override for that candidate.
create or replace function public.check_assignment_conflicts(
  p_organization_id uuid,
  p_candidates jsonb,
  p_exclude_assignment_ids uuid[] default '{}'
)
returns table (
  candidate_key text,
  person_id uuid,
  kind text,
  severity text,
  plan_time_id uuid,
  interval_source text,
  starts_at timestamptz,
  ends_at timestamptz,
  other_plan_id uuid,
  other_assignment_id uuid,
  other_plan_time_id uuid,
  other_time_kind text,
  detail text,
  redacted boolean,
  override_permitted boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_capability_anywhere(p_organization_id, 'scheduling.manage') then
    raise exception 'Only a scheduler can check conflicts' using errcode = '42501';
  end if;
  return query
  select c.candidate_key, c.person_id, c.kind, c.severity, c.plan_time_id, c.interval_source,
         c.starts_at, c.ends_at, c.other_plan_id, c.other_assignment_id, c.other_plan_time_id,
         c.other_time_kind, c.detail, c.redacted,
         private.can_override_conflicts((select auth.uid()), c.candidate_plan_id, c.candidate_team_id)
    from private.attendance_conflicts(p_organization_id, (select auth.uid()), p_candidates,
                                      p_exclude_assignment_ids) c;
end;
$$;
revoke execute on function public.check_assignment_conflicts(uuid, jsonb, uuid[]) from public, anon;
grant execute on function public.check_assignment_conflicts(uuid, jsonb, uuid[]) to authenticated;

-- MOB-005 contract kept, now through the shared resolver (and redacted).
create or replace function public.scheduling_conflicts_for_people(
  p_organization_id uuid, p_person_ids uuid[], p_plan_time_ids uuid[], p_exclude_assignment_ids uuid[] default '{}'
)
returns table(person_id uuid, conflict_type text, detail text, starts_at timestamptz, ends_at timestamptz,
  plan_id uuid, assignment_id uuid, plan_time_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and not public.has_capability_anywhere(p_organization_id, 'scheduling.manage') then
    raise exception 'Only a scheduler can check conflicts' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(p_plan_time_ids) ids(id)
              where not exists (select 1 from public.plan_times pt join public.plans p on p.id = pt.plan_id
                                 where pt.id = ids.id and p.organization_id = p_organization_id)) then
    raise exception 'Conflict scope crosses organizations' using errcode = '22023';
  end if;
  return query
  select c.person_id,
         case c.kind when 'blockout' then 'blockout' else 'double_booked' end,
         c.detail, c.starts_at, c.ends_at, c.other_plan_id, c.other_assignment_id, c.plan_time_id
    from private.attendance_conflicts(
      p_organization_id, (select auth.uid()),
      (select coalesce(jsonb_agg(jsonb_build_object(
                'person_id', p.id, 'plan_id', g.plan_id,
                'attendance_mode', 'selected', 'time_ids', g.ids)), '[]'::jsonb)
         from unnest(p_person_ids) p(id)
         cross join (select pt.plan_id, array_agg(pt.id) ids from public.plan_times pt
                      where pt.id = any(p_plan_time_ids) group by pt.plan_id) g),
      p_exclude_assignment_ids) c;
end $$;

-- Legacy window check (POST /scheduling/conflicts): every applicable time,
-- not only services; other plans' titles only when the caller may see them.
create or replace function public.scheduling_conflicts(
  p_organization_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_user_ids uuid[] default null
)
returns table(user_id uuid, conflict_type text, detail text, starts_at timestamptz, ends_at timestamptz, plan_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_viewer uuid := (select auth.uid());
begin
  if v_viewer is not null and not public.has_capability_anywhere(p_organization_id, 'scheduling.manage') then
    raise exception 'Only a scheduler can check conflicts' using errcode = '42501';
  end if;
  return query with candidates as (
    select m.user_id from public.organization_members m where m.organization_id = p_organization_id
      and m.status = 'active' and (p_user_ids is null or m.user_id = any(p_user_ids))
  )
  select b.user_id, 'blockout'::text, 'Unavailable'::text, b.starts_at, b.ends_at, null::uuid
    from public.blockouts b join candidates c on c.user_id = b.user_id
   where b.organization_id = p_organization_id
     and tstzrange(b.starts_at,b.ends_at,'[)') && tstzrange(p_starts_at,p_ends_at,'[)')
  union all
  select pe.profile_id, 'double_booked',
         case when x.visible then p.title else 'Another commitment' end,
         v.starts_at, v.ends_at, case when x.visible then p.id end
    from private.assignment_attendance v
    join public.people pe on pe.id = v.person_id
    join candidates c on c.user_id = pe.profile_id
    join public.plans p on p.id = v.plan_id
    cross join lateral (
      select (v_viewer is null or private.can_schedule_on_plan(v_viewer, v.plan_id, v.team_id)
              or private.can_edit_plan(v_viewer, v.plan_id)) as visible
    ) x
   where p.organization_id = p_organization_id and v.status <> 'declined'
     and (v.visibility = 'released' or v_viewer is null
          or private.can_schedule_on_plan(v_viewer, v.plan_id, v.team_id))
     and tstzrange(v.starts_at,v.ends_at,'[)') && tstzrange(p_starts_at,p_ends_at,'[)');
end $$;

-- ================================================== commit-time safety ====

create table public.assignment_conflict_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  assignment_id uuid references public.assignments (id) on delete set null,
  person_id uuid not null references public.people (id) on delete cascade,
  plan_id uuid not null references public.plans (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  conflicts jsonb not null check (jsonb_typeof(conflicts) = 'array'),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  actor_id uuid references public.profiles (id) on delete set null,
  transaction_id bigint not null default txid_current(),
  created_at timestamptz not null default now(),
  constraint assignment_conflict_overrides_once_per_transaction unique (assignment_id, transaction_id)
);
create index assignment_conflict_overrides_org_idx on public.assignment_conflict_overrides (organization_id);
create index assignment_conflict_overrides_plan_idx on public.assignment_conflict_overrides (plan_id, created_at desc);
create index assignment_conflict_overrides_person_idx on public.assignment_conflict_overrides (person_id);
create index assignment_conflict_overrides_team_idx on public.assignment_conflict_overrides (team_id);
create index assignment_conflict_overrides_actor_idx on public.assignment_conflict_overrides (actor_id);
comment on table public.assignment_conflict_overrides is
  'F04 audit: a request committed despite a real conflict, by whom, why, and the (redacted) conflicts at that moment. Written only by the conflict trigger.';

alter table public.assignment_conflict_overrides enable row level security;
create policy assignment_conflict_overrides_select on public.assignment_conflict_overrides
  for select to authenticated
  using ((select private.can_schedule_on_plan((select auth.uid()), plan_id, team_id)));
revoke insert, update, delete on public.assignment_conflict_overrides from anon, authenticated;

-- Sorted per-Person transaction locks: every writer locks the People it is
-- about to commit before reading their commitments, so concurrent writers for
-- the same Person serialize and the second one sees the first one's rows.
create or replace function private.lock_scheduling_people(p_person_ids uuid[])
returns void
language plpgsql set search_path = '' as $$
declare
  v_person uuid;
begin
  for v_person in
    select distinct x from unnest(coalesce(p_person_ids, '{}')) x where x is not null order by x
  loop
    perform pg_advisory_xact_lock(hashtextextended('f04:person:' || v_person::text, 0));
  end loop;
end;
$$;
revoke execute on function private.lock_scheduling_people(uuid[]) from public, anon;
grant execute on function private.lock_scheduling_people(uuid[]) to authenticated, service_role;

-- Deferred re-check of what is actually committed. Writers set the
-- transaction-local `f04.conflict_override_reason` and finish with
-- `set constraints all immediate`, so a conflict surfaces as PT409 (hint
-- `scheduling_conflict`, detail = redacted conflicts JSON) from the call.
-- Runs only for signed-in callers; service-role maintenance and seed data
-- are not scheduling decisions.
create or replace function private.enforce_assignment_conflicts()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_a public.assignments;
  v_viewer uuid := (select auth.uid());
  v_reason text := nullif(btrim(coalesce(current_setting('f04.conflict_override_reason', true), '')), '');
  v_org uuid;
  v_intervals jsonb;
  v_conflicts jsonb;
begin
  if v_viewer is null then return null; end if;
  if tg_table_name = 'assignments' then
    if tg_op = 'UPDATE'
       and not ((old.status = 'declined' and new.status <> 'declined')
                or new.attendance_mode is distinct from old.attendance_mode) then
      return null;
    end if;
    v_id := new.id;
  else
    v_id := new.assignment_id;
  end if;

  select * into v_a from public.assignments where id = v_id;
  if not found or v_a.status = 'declined' then return null; end if;

  perform private.lock_scheduling_people(array[v_a.person_id]);

  select organization_id into v_org from public.plans where id = v_a.plan_id;
  select jsonb_agg(jsonb_build_object('plan_time_id', v.plan_time_id,
                                      'starts_at', v.starts_at, 'ends_at', v.ends_at))
    into v_intervals
    from private.assignment_attendance v where v.assignment_id = v_a.id;
  if v_intervals is null then return null; end if;

  select coalesce(jsonb_agg(to_jsonb(c) - 'candidate_plan_id' - 'candidate_team_id')
                    filter (where c.severity = 'blocking'), '[]'::jsonb)
    into v_conflicts
    from private.attendance_conflicts(
      v_org, v_viewer,
      jsonb_build_array(jsonb_build_object(
        'key', v_a.id, 'person_id', v_a.person_id, 'plan_id', v_a.plan_id,
        'team_id', v_a.team_id, 'position_id', v_a.position_id, 'intervals', v_intervals)),
      array[v_a.id]) c;
  if jsonb_array_length(v_conflicts) = 0 then return null; end if;

  if v_reason is null then
    raise exception 'This Person is unavailable or already scheduled at that time'
      using errcode = 'PT409', hint = 'scheduling_conflict', detail = v_conflicts::text;
  end if;
  if not private.can_override_conflicts(v_viewer, v_a.plan_id, v_a.team_id) then
    raise exception 'You cannot schedule over a conflict here' using errcode = '42501';
  end if;
  insert into public.assignment_conflict_overrides (
    organization_id, assignment_id, person_id, plan_id, team_id, conflicts, reason, actor_id
  ) values (v_org, v_a.id, v_a.person_id, v_a.plan_id, v_a.team_id, v_conflicts, left(v_reason, 500), v_viewer)
  on conflict (assignment_id, transaction_id) do update set conflicts = excluded.conflicts;
  return null;
end;
$$;
revoke execute on function private.enforce_assignment_conflicts() from public, anon, authenticated;

create constraint trigger assignments_conflict_check
  after insert or update of status, attendance_mode on public.assignments
  deferrable initially deferred
  for each row execute function private.enforce_assignment_conflicts();
create constraint trigger assignment_attendance_times_conflict_check
  after insert on public.assignment_attendance_times
  deferrable initially deferred
  for each row execute function private.enforce_assignment_conflicts();

-- Fires only the F04 checks queued so far (other deferred constraints, such
-- as plan copy keys, keep their own timing), then re-defers them for any
-- later statement in the same transaction.
create or replace function private.check_pending_conflicts()
returns void
language plpgsql set search_path = '' as $$
begin
  set constraints public.assignments_conflict_check, public.assignment_attendance_times_conflict_check immediate;
  set constraints public.assignments_conflict_check, public.assignment_attendance_times_conflict_check deferred;
end;
$$;
revoke execute on function private.check_pending_conflicts() from public, anon;
grant execute on function private.check_pending_conflicts() to authenticated, service_role;

-- ============================================================ writers =====

drop function if exists public.schedule_plan_assignments(uuid, jsonb, boolean, text, text, uuid);
create or replace function public.schedule_plan_assignments(
  p_plan_id uuid,
  p_assignments jsonb,
  p_notify boolean,
  p_effect_key text default null,
  p_visibility text default null,
  p_response_owner uuid default null,
  p_conflict_override_reason text default null
)
returns setof public.assignments
language plpgsql security invoker set search_path = '' as $$
declare
  v_org uuid;
  v_ids uuid[];
  v_released uuid[];
  v_invalid int;
  v_people uuid[];
begin
  select organization_id into v_org from public.plans where id = p_plan_id;
  if v_org is null then raise exception 'Plan not found' using errcode = 'P0002'; end if;
  if not public.can_manage_org(v_org) then
    raise exception 'Only a scheduler can schedule people' using errcode = '42501';
  end if;
  if jsonb_typeof(p_assignments) <> 'array' then
    raise exception 'Assignments must be a list' using errcode = '22023';
  end if;
  if p_visibility is not null and p_visibility not in ('prepared','released') then
    raise exception 'Visibility is prepared or released' using errcode = '22023';
  end if;

  with requested as (
    select r.*,
           p.person_id resolved_person_id,
           p.profile_id resolved_profile_id
      from jsonb_to_recordset(p_assignments) as r(
        person_id uuid, user_id uuid, team_id uuid, position_id uuid, notes text,
        visibility text, attendance_mode text, time_ids uuid[]
      )
      left join lateral private.resolve_scheduling_person(p_plan_id, r.person_id, r.user_id) p on true
  )
  select count(*) into v_invalid from requested r
   where r.resolved_person_id is null or r.team_id is null
      or r.attendance_mode not in ('all','selected')
      or (coalesce(r.attendance_mode, 'all') = 'selected' and coalesce(cardinality(r.time_ids), 0) = 0)
      or not exists (select 1 from public.teams t where t.id = r.team_id and t.organization_id = v_org)
      or (r.position_id is not null and not exists (
          select 1 from public.team_positions tp where tp.id = r.position_id and tp.team_id = r.team_id))
      or exists (select 1 from unnest(coalesce(r.time_ids, '{}')) tid
                  where not exists (select 1 from public.plan_times pt where pt.id = tid and pt.plan_id = p_plan_id));
  if v_invalid > 0 then
    raise exception 'Some People, teams, positions or times do not belong to this plan' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_assignments) as r(team_id uuid)
     where not public.can_schedule_on_plan(p_plan_id, r.team_id)
  ) then raise exception 'You cannot schedule one of those teams on this plan' using errcode = '42501'; end if;

  -- F04: lock everyone this call commits before anything is inserted.
  select coalesce(array_agg(distinct p.person_id), '{}') into v_people
    from jsonb_to_recordset(p_assignments) as r(person_id uuid, user_id uuid)
    cross join lateral private.resolve_scheduling_person(p_plan_id, r.person_id, r.user_id) p;
  perform private.lock_scheduling_people(v_people);
  perform set_config('f04.conflict_override_reason', coalesce(p_conflict_override_reason, ''), true);

  with requested as (
    select r.*, p.person_id resolved_person_id, p.profile_id resolved_profile_id, row_number() over () ord
      from jsonb_to_recordset(p_assignments) as r(
        person_id uuid, user_id uuid, team_id uuid, position_id uuid, notes text,
        visibility text, attendance_mode text, time_ids uuid[]
      )
      left join lateral private.resolve_scheduling_person(p_plan_id, r.person_id, r.user_id) p on true
  ), resolved as (
    select r.*,
           coalesce(r.visibility, p_visibility, t.default_visibility, 'released') eff_visibility,
           coalesce(p_response_owner,
             case when t.default_response_owner_id is not null
                       and private.can_schedule_on_plan(t.default_response_owner_id, p_plan_id, r.team_id)
                  then t.default_response_owner_id end,
             (select auth.uid())) eff_owner
      from requested r join public.teams t on t.id = r.team_id
  ), inserted as (
    insert into public.assignments (
      plan_id, person_id, user_id, team_id, position_id, notes, status, created_by,
      visibility, response_owner_id, attendance_mode
    )
    select distinct on (r.resolved_person_id, r.team_id, r.position_id)
      p_plan_id, r.resolved_person_id, r.resolved_profile_id, r.team_id, r.position_id,
      nullif(btrim(r.notes), ''), 'unconfirmed', (select auth.uid()),
      r.eff_visibility, r.eff_owner, coalesce(r.attendance_mode, 'all')
      from resolved r order by r.resolved_person_id, r.team_id, r.position_id, r.ord
    on conflict do nothing returning id, person_id, team_id, position_id, visibility
  )
  select coalesce(array_agg(id), '{}'),
         coalesce(array_agg(id) filter (where visibility = 'released'), '{}')
    into v_ids, v_released from inserted;

  insert into public.assignment_attendance_times (assignment_id, plan_time_id)
  select a.id, tid
    from public.assignments a
    join lateral (
      select r.time_ids from jsonb_to_recordset(p_assignments) as r(
        person_id uuid, user_id uuid, team_id uuid, position_id uuid, notes text,
        visibility text, attendance_mode text, time_ids uuid[]
      ) left join lateral private.resolve_scheduling_person(p_plan_id, r.person_id, r.user_id) p on true
      where p.person_id = a.person_id and r.team_id = a.team_id
        and r.position_id is not distinct from a.position_id
        and coalesce(r.attendance_mode, 'all') = 'selected'
      limit 1
    ) scope on true
    cross join unnest(scope.time_ids) tid
   where a.id = any(v_ids)
  on conflict do nothing;

  -- Conflicts are decided against what is committed, under the locks above.
  perform private.check_pending_conflicts();
  perform set_config('f04.conflict_override_reason', '', true);

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
revoke execute on function public.schedule_plan_assignments(uuid, jsonb, boolean, text, text, uuid, text) from public, anon;
grant execute on function public.schedule_plan_assignments(uuid, jsonb, boolean, text, text, uuid, text) to authenticated;

-- Change which times existing requests cover. Expected revisions make a stale
-- editor fail; the request revision bump (MOB-005 triggers) makes every older
-- response review or link for it stale. Released, undeclined requests whose
-- scope changed are re-sent to exactly those People.
create or replace function public.set_assignment_attendance(
  p_plan_id uuid,
  p_changes jsonb,
  p_conflict_override_reason text default null,
  p_notify boolean default true,
  p_effect_key text default null
)
returns setof public.assignments
language plpgsql security invoker set search_path = '' as $$
declare
  v_ids uuid[];
  v_people uuid[];
  v_notify uuid[];
begin
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) not between 1 and 200 then
    raise exception 'Change 1 to 200 requests at a time' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_changes) as r(
        assignment_id uuid, expected_request_revision bigint, attendance_mode text, time_ids uuid[])
     where r.assignment_id is null or r.expected_request_revision is null
        or coalesce(r.attendance_mode, '') not in ('all', 'selected')
        or (r.attendance_mode = 'selected' and coalesce(cardinality(r.time_ids), 0) = 0)
        or (r.attendance_mode = 'all' and coalesce(cardinality(r.time_ids), 0) > 0)
        or not exists (select 1 from public.assignments a
                        where a.id = r.assignment_id and a.plan_id = p_plan_id)
        or exists (select 1 from unnest(coalesce(r.time_ids, '{}')) t(id)
                    where not exists (select 1 from public.plan_times pt
                                       where pt.id = t.id and pt.plan_id = p_plan_id))
  ) or (select count(distinct r.assignment_id) <> count(*)
          from jsonb_to_recordset(p_changes) as r(assignment_id uuid)) then
    raise exception 'Some requests or times are not on this plan' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_changes) as r(assignment_id uuid)
      join public.assignments a on a.id = r.assignment_id
     where not public.can_schedule_on_plan(p_plan_id, a.team_id)
  ) then
    raise exception 'You cannot schedule one of those teams on this plan' using errcode = '42501';
  end if;

  select array_agg(r.assignment_id order by r.assignment_id) into v_ids
    from jsonb_to_recordset(p_changes) as r(assignment_id uuid);
  select array_agg(distinct a.person_id) into v_people
    from public.assignments a where a.id = any(v_ids);
  perform private.lock_scheduling_people(v_people);
  perform 1 from public.assignments a where a.id = any(v_ids) order by a.id for update;

  if exists (
    select 1 from jsonb_to_recordset(p_changes) as r(assignment_id uuid, expected_request_revision bigint)
      join public.assignments a on a.id = r.assignment_id
     where a.request_revision <> r.expected_request_revision
  ) then
    raise exception 'A request changed since you opened it; refresh and try again'
      using errcode = 'PT409', hint = 'assignment_changed';
  end if;

  perform set_config('f04.conflict_override_reason', coalesce(p_conflict_override_reason, ''), true);

  delete from public.assignment_attendance_times aat
   using jsonb_to_recordset(p_changes) as r(assignment_id uuid, attendance_mode text, time_ids uuid[])
   where aat.assignment_id = r.assignment_id
     and (r.attendance_mode = 'all' or not (aat.plan_time_id = any(r.time_ids)));
  insert into public.assignment_attendance_times (assignment_id, plan_time_id)
  select r.assignment_id, t.id
    from jsonb_to_recordset(p_changes) as r(assignment_id uuid, attendance_mode text, time_ids uuid[])
    cross join unnest(r.time_ids) t(id)
   where r.attendance_mode = 'selected'
  on conflict do nothing;
  update public.assignments a
     set attendance_mode = r.attendance_mode
    from jsonb_to_recordset(p_changes) as r(assignment_id uuid, attendance_mode text)
   where a.id = r.assignment_id and a.attendance_mode <> r.attendance_mode;

  perform private.check_pending_conflicts();
  perform set_config('f04.conflict_override_reason', '', true);

  select coalesce(array_agg(a.id order by a.id), '{}') into v_notify
    from public.assignments a
    join jsonb_to_recordset(p_changes) as r(assignment_id uuid, expected_request_revision bigint)
      on r.assignment_id = a.id
   where a.request_revision <> r.expected_request_revision
     and a.visibility = 'released' and a.status <> 'declined';
  if p_notify and cardinality(v_notify) > 0 then
    perform private.enqueue_assignment_requests(
      p_plan_id, 'assignment_request', v_notify,
      coalesce(p_effect_key, 'attendance-changed:' || gen_random_uuid()::text),
      (select auth.uid())
    );
  end if;
  return query select a.* from public.assignments a where a.id = any(v_ids) order by a.id;
end;
$$;
revoke execute on function public.set_assignment_attendance(uuid, jsonb, text, boolean, text) from public, anon;
grant execute on function public.set_assignment_attendance(uuid, jsonb, text, boolean, text) to authenticated;

-- Copy keeps each request's attendance scope. Duplicating maps every source
-- time to its shifted copy. Importing into an existing plan maps a selected
-- time to the target time of the same kind, label and offset from the
-- service date; a selected request whose times have no counterpart is not
-- copied (rather than silently widened to all times). Copied People are
-- locked and re-checked like any other writer; a conflict refuses the copy.
create or replace function private.copy_plan_children(
  p_source       uuid,
  p_target       uuid,
  p_items        boolean,
  p_needs        boolean,
  p_assignments  boolean,
  p_time_offset  interval
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_base int;
  v_map jsonb := '{}'::jsonb;
  v_source_date timestamptz;
  v_target_date timestamptz;
  v_people uuid[];
  v_selected jsonb;
begin
  if p_items then
    select coalesce(max(sort_order) + 1, 0) into v_base from public.plan_items where plan_id = p_target;
    insert into public.plan_items (
      plan_id, item_type, title, song_id, arrangement_id, key_override,
      length_seconds, description, sort_order
    )
    select p_target, i.item_type, i.title, i.song_id, i.arrangement_id, i.key_override,
           i.length_seconds, i.description,
           v_base + (row_number() over (order by i.sort_order, i.created_at, i.id))::int - 1
      from public.plan_items i
     where i.plan_id = p_source;
  end if;

  if p_time_offset is not null then
    with source_times as (
      select t.*, gen_random_uuid() new_id from public.plan_times t where t.plan_id = p_source
    ), copied as (
      insert into public.plan_times (id, plan_id, kind, name, starts_at, ends_at, sort_order)
      select s.new_id, p_target, s.kind, s.name, s.starts_at + p_time_offset, s.ends_at + p_time_offset, s.sort_order
        from source_times s
      returning id
    )
    select coalesce(jsonb_object_agg(s.id::text, s.new_id), '{}'::jsonb) into v_map
      from source_times s where s.new_id in (select id from copied);
  else
    select service_date into v_source_date from public.plans where id = p_source;
    select service_date into v_target_date from public.plans where id = p_target;
    select coalesce(jsonb_object_agg(s.id::text, m.id), '{}'::jsonb) into v_map
      from public.plan_times s
      cross join lateral (
        select t.id from public.plan_times t
         where t.plan_id = p_target and t.kind = s.kind
           and coalesce(t.name, '') = coalesce(s.name, '')
           and t.starts_at - v_target_date = s.starts_at - v_source_date
           and t.ends_at - t.starts_at = s.ends_at - s.starts_at
         order by t.sort_order, t.id limit 1
      ) m
     where s.plan_id = p_source;
  end if;

  if p_needs then
    insert into public.plan_position_needs (plan_id, position_id, needed)
    select p_target, n.position_id, n.needed
      from public.plan_position_needs n
      join public.team_positions tp on tp.id = n.position_id and tp.plan_id is null
     where n.plan_id = p_source and n.needed > 0
       and (public.can_edit_plan(p_target)
            or public.can_schedule_on_plan(p_target, private.position_team(n.position_id)))
    on conflict (plan_id, position_id) do nothing;
  end if;

  if p_assignments then
    select coalesce(array_agg(distinct a.person_id), '{}') into v_people
      from public.assignments a where a.plan_id = p_source;
    perform private.lock_scheduling_people(v_people);

    with eligible as (
      select a.*,
             case when a.attendance_mode = 'selected' then array(
               select (v_map->>aat.plan_time_id::text)::uuid
                 from public.assignment_attendance_times aat
                where aat.assignment_id = a.id and v_map ? aat.plan_time_id::text
             ) end mapped_times
        from public.assignments a
       where a.plan_id = p_source
         and exists (select 1 from private.resolve_scheduling_person(p_target, a.person_id, null))
         and (a.position_id is null
              or exists (select 1 from public.team_positions tp where tp.id = a.position_id and tp.plan_id is null))
         and public.can_schedule_on_plan(p_target, a.team_id)
    ), inserted as (
      insert into public.assignments (plan_id, person_id, team_id, position_id, status, created_by, attendance_mode)
      select p_target, e.person_id, e.team_id, e.position_id, 'unconfirmed', (select auth.uid()), e.attendance_mode
        from eligible e
       where e.attendance_mode = 'all' or cardinality(e.mapped_times) > 0
      on conflict do nothing
      returning id, person_id, team_id, position_id
    )
    select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'times', to_jsonb(e.mapped_times))), '[]'::jsonb)
      into v_selected
      from inserted i
      join eligible e on e.person_id = i.person_id and e.team_id = i.team_id
                     and e.position_id is not distinct from i.position_id
     where e.attendance_mode = 'selected';

    -- A separate statement: the policy on selections must see the new rows.
    insert into public.assignment_attendance_times (assignment_id, plan_time_id)
    select (x->>'id')::uuid, t.id::uuid
      from jsonb_array_elements(v_selected) x
      cross join jsonb_array_elements_text(x->'times') t(id)
    on conflict do nothing;

    perform private.check_pending_conflicts();
  end if;
end;
$$;

-- ======================================================= time changes =====

-- Re-sent requests after a plan edit may reach teams the editor does not
-- schedule: the plan changed under them. Set only by apply_plan_time_changes.
create or replace function private.enqueue_assignment_requests(
  p_plan_id uuid,
  p_template public.delivery_template,
  p_assignment_ids uuid[],
  p_effect_key text,
  p_actor uuid
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_effect uuid;
  v_ids uuid[];
  v_recipient record;
  v_plan_change boolean := coalesce(current_setting('f04.plan_change_notify', true), '') = 'on';
begin
  if p_template not in ('assignment_request', 'assignment_reminder') then
    raise exception 'Not an assignment request template' using errcode = '22023';
  end if;
  select organization_id into v_org from public.plans where id = p_plan_id;
  if v_org is null then raise exception 'Plan not found' using errcode = 'P0002'; end if;
  if (select auth.uid()) is not null and not v_plan_change and not public.can_manage_org(v_org) then
    raise exception 'Only a scheduler can notify this plan' using errcode = '42501';
  end if;

  select coalesce(array_agg(a.id order by a.id), '{}') into v_ids
    from public.assignments a
   where a.plan_id = p_plan_id and a.id = any(p_assignment_ids)
     and a.visibility = 'released'
     and ((select auth.uid()) is null or v_plan_change
          or private.can_schedule_on_plan((select auth.uid()), a.plan_id, a.team_id));

  insert into public.delivery_effects (
    organization_id, effect_key, template, plan_id, assignment_ids, created_by
  ) values (v_org, p_effect_key, p_template, p_plan_id, v_ids, p_actor)
  on conflict (organization_id, effect_key) do nothing
  returning id into v_effect;
  if v_effect is null then
    select id into v_effect from public.delivery_effects
     where organization_id = v_org and effect_key = p_effect_key;
    return v_effect;
  end if;

  for v_recipient in
    select a.person_id, p.profile_id, array_agg(a.id order by a.id) assignment_ids
      from public.assignments a
      join public.people p on p.id = a.person_id
     where a.id = any(v_ids)
     group by a.person_id, p.profile_id
  loop
    perform private.create_assignment_request_snapshot(
      v_effect, v_recipient.person_id, p_plan_id, v_recipient.assignment_ids, p_actor
    );
    insert into public.deliveries (
      organization_id, effect_id, recipient_id, recipient_person_id, channel
    ) values (v_org, v_effect, v_recipient.profile_id, v_recipient.person_id, 'email');
    if v_recipient.profile_id is not null then
      insert into public.deliveries (
        organization_id, effect_id, recipient_id, recipient_person_id, channel
      ) values
        (v_org, v_effect, v_recipient.profile_id, v_recipient.person_id, 'in_app'),
        (v_org, v_effect, v_recipient.profile_id, v_recipient.person_id, 'push');
    end if;
  end loop;
  return v_effect;
end;
$$;

-- What a proposed full time list would do. `p_times` must carry an id for
-- every time (new ones too); the API's legacy adapter fills them. Requests
-- the viewer cannot schedule are counted but not described.
create or replace function private.plan_time_change_impact(p_plan uuid, p_times jsonb, p_viewer uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_revision bigint;
  v_result jsonb;
begin
  select content_revision into v_revision from public.plans where id = p_plan;

  with proposed as (
    select r.id, r.kind, nullif(btrim(r.name), '') name, r.starts_at, r.ends_at
      from jsonb_to_recordset(p_times) as r(id uuid, kind text, name text,
        starts_at timestamptz, ends_at timestamptz)
  ), current_times as (
    select pt.id, pt.kind::text kind, pt.name, pt.starts_at, pt.ends_at
      from public.plan_times pt where pt.plan_id = p_plan
  ), time_changes as (
    select coalesce(p.id, c.id) id,
           case when c.id is null then 'added'
                when p.id is null then 'removed'
                when p.kind <> c.kind or p.starts_at <> c.starts_at or p.ends_at <> c.ends_at then 'changed'
                when p.name is distinct from c.name then 'renamed'
                else 'unchanged' end change,
           coalesce(p.kind, c.kind) kind,
           coalesce(p.name, c.name) name,
           coalesce(p.starts_at, c.starts_at) starts_at,
           coalesce(p.ends_at, c.ends_at) ends_at,
           c.starts_at previous_starts_at,
           c.ends_at previous_ends_at
      from proposed p full join current_times c on c.id = p.id
  ), scope as (
    select a.id, a.person_id, a.team_id, a.position_id, a.status, a.visibility,
           a.attendance_mode, a.request_revision,
           coalesce(array(select v.plan_time_id from private.assignment_attendance v
                           where v.assignment_id = a.id and v.plan_time_id is not null
                           order by 1), '{}') before_ids,
           case when a.attendance_mode = 'all'
                then coalesce(array(select p.id from proposed p order by 1), '{}')
                else coalesce(array(select aat.plan_time_id from public.assignment_attendance_times aat
                                     where aat.assignment_id = a.id
                                       and aat.plan_time_id in (select p.id from proposed p)
                                     order by 1), '{}') end after_ids
      from public.assignments a
     where a.plan_id = p_plan and a.status <> 'declined'
  ), impact as (
    select s.*,
           array(select x from unnest(s.after_ids) x except select y from unnest(s.before_ids) y order by 1) gains,
           array(select x from unnest(s.before_ids) x except select y from unnest(s.after_ids) y order by 1) loses,
           array(select x from unnest(s.after_ids) x
                 intersect select tc.id from time_changes tc where tc.change = 'changed' order by 1) changed,
           (s.attendance_mode = 'selected' and cardinality(s.after_ids) = 0) orphaned,
           (p_viewer is null or private.can_schedule_on_plan(p_viewer, p_plan, s.team_id)) visible
      from scope s
  ), affected as (
    select * from impact
     where cardinality(gains) > 0 or cardinality(loses) > 0 or cardinality(changed) > 0 or orphaned
  )
  select jsonb_build_object(
    'plan_id', p_plan,
    'content_revision', v_revision,
    'becomes_untimed', (select count(*) from proposed) = 0 and (select count(*) from current_times) > 0,
    'was_untimed', (select count(*) from current_times) = 0,
    'times', coalesce((select jsonb_agg(jsonb_build_object(
        'id', tc.id, 'change', tc.change, 'kind', tc.kind, 'name', tc.name,
        'starts_at', tc.starts_at, 'ends_at', tc.ends_at,
        'previous_starts_at', tc.previous_starts_at, 'previous_ends_at', tc.previous_ends_at)
        order by tc.starts_at, tc.id) from time_changes tc), '[]'::jsonb),
    'assignments', coalesce((select jsonb_agg(jsonb_build_object(
        'assignment_id', af.id, 'person_id', af.person_id, 'team_id', af.team_id,
        'position_id', af.position_id, 'status', af.status, 'visibility', af.visibility,
        'attendance_mode', af.attendance_mode, 'request_revision', af.request_revision,
        'gains', to_jsonb(af.gains), 'loses', to_jsonb(af.loses), 'changed', to_jsonb(af.changed),
        'after', to_jsonb(af.after_ids), 'orphaned', af.orphaned)
        order by af.person_id, af.id) from affected af where af.visible), '[]'::jsonb),
    'hidden_affected', (select count(*) from affected af where not af.visible),
    'live_requests', (select count(distinct s.id)
                        from public.assignment_request_snapshots s
                        join public.assignment_request_snapshot_items i on i.snapshot_id = s.id
                       where s.consumed_at is null and s.superseded_at is null
                         and i.assignment_id in (select af.id from affected af)),
    'notify_people', (select count(distinct af.person_id) from affected af
                       where af.visibility = 'released' and not af.orphaned),
    'impact_hash', md5(jsonb_build_array(
        v_revision,
        coalesce((select jsonb_agg(jsonb_build_array(tc.id, tc.change, tc.kind, tc.name, tc.starts_at, tc.ends_at)
                                   order by tc.id) from time_changes tc where tc.change <> 'unchanged'), '[]'::jsonb),
        coalesce((select jsonb_agg(jsonb_build_array(af.id, af.request_revision, af.gains, af.loses,
                                                     af.changed, af.orphaned, af.visibility)
                                   order by af.id) from affected af), '[]'::jsonb)
      )::text)
  ) into v_result;
  return v_result;
end;
$$;
revoke execute on function private.plan_time_change_impact(uuid, jsonb, uuid) from public, anon, authenticated;

create or replace function private.validate_plan_times(p_plan uuid, p_times jsonb)
returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if jsonb_typeof(p_times) <> 'array' or jsonb_array_length(p_times) > 20 then
    raise exception 'Times must be a list of at most 20' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_times) as r(id uuid, kind text, starts_at timestamptz, ends_at timestamptz)
     where r.kind is null or r.kind not in ('service', 'rehearsal', 'other')
        or r.starts_at is null or r.ends_at is null or r.ends_at <= r.starts_at
  ) then
    raise exception 'Every time needs a kind and must end after it starts' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_times) as r(id uuid)
     where r.id is null
        or exists (select 1 from public.plan_times pt where pt.id = r.id and pt.plan_id <> p_plan)
  ) or (select count(distinct r.id) <> count(*) from jsonb_to_recordset(p_times) as r(id uuid)) then
    raise exception 'Refresh before editing times; every existing time needs its stable id'
      using errcode = 'PT409', hint = 'time_identity';
  end if;
end;
$$;
revoke execute on function private.validate_plan_times(uuid, jsonb) from public, anon, authenticated;

create or replace function public.preview_plan_time_changes(p_plan_id uuid, p_times jsonb)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_edit_plan((select auth.uid()), p_plan_id) then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;
  perform private.validate_plan_times(p_plan_id, p_times);
  return private.plan_time_change_impact(p_plan_id, p_times, (select auth.uid()));
end;
$$;
revoke execute on function public.preview_plan_time_changes(uuid, jsonb) from public, anon;
grant execute on function public.preview_plan_time_changes(uuid, jsonb) to authenticated;

-- Commits a previewed time list. `p_impact_hash` NULL is the legacy path: it
-- is allowed only when no selected request would lose a time (MOB-005's
-- refusal), so an old editor can never delete someone's selected time.
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

-- MOB-005 entry point kept for old callers: same refusal, no notification
-- (those callers notified separately).
create or replace function public.replace_plan_times(
  p_plan_id uuid,
  p_times jsonb,
  p_expected_revision bigint default null
)
returns setof public.plan_times
language plpgsql security invoker set search_path = '' as $$
begin
  perform public.apply_plan_time_changes(p_plan_id, p_times, p_expected_revision, null, '[]'::jsonb, false, null);
  return query select * from public.plan_times where plan_id = p_plan_id order by sort_order, starts_at, id;
end;
$$;

-- ================================================ copy entry points =====
-- Copies re-check like every writer. An authorized scheduler may copy over a
-- conflict with a reason (audited per request); otherwise the copy refuses.

drop function if exists public.duplicate_plan(uuid, timestamptz, text, boolean, text);
create or replace function public.duplicate_plan(
  p_source_plan_id uuid,
  p_service_date timestamptz,
  p_title text default null,
  p_copy_assignments boolean default true,
  p_idempotency_key text default null,
  p_conflict_override_reason text default null
)
returns uuid
language plpgsql set search_path = '' as $$
declare
  v_source   public.plans;
  v_target   uuid := gen_random_uuid();
  v_existing uuid;
begin
  select * into v_source from public.plans where id = p_source_plan_id;
  if not found or not public.can_manage_org(v_source.organization_id) then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;

  v_existing := private.claim_plan_copy_key(
    v_source.organization_id, p_idempotency_key, 'duplicate', v_source.id, v_target);
  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.plans (id, organization_id, service_type_id, title, service_date, location, status, notes, created_by)
  values (v_target, v_source.organization_id, v_source.service_type_id,
          coalesce(nullif(btrim(p_title), ''), v_source.title), p_service_date,
          v_source.location, 'draft', v_source.notes, (select auth.uid()));

  perform set_config('f04.conflict_override_reason', coalesce(p_conflict_override_reason, ''), true);
  perform private.copy_plan_children(
    v_source.id, v_target, true, true, coalesce(p_copy_assignments, true),
    p_service_date - v_source.service_date);
  perform set_config('f04.conflict_override_reason', '', true);
  return v_target;
end;
$$;
revoke execute on function public.duplicate_plan(uuid, timestamptz, text, boolean, text, text) from public, anon;
grant execute on function public.duplicate_plan(uuid, timestamptz, text, boolean, text, text) to authenticated;

drop function if exists public.import_plan_contents(uuid, uuid, boolean, boolean, boolean, bigint, text);
create or replace function public.import_plan_contents(
  p_target_plan_id uuid,
  p_source_plan_id uuid,
  p_items boolean,
  p_needs boolean,
  p_assignments boolean,
  p_expected_revision bigint default null,
  p_idempotency_key text default null,
  p_conflict_override_reason text default null
)
returns bigint
language plpgsql set search_path = '' as $$
declare
  v_target   public.plans;
  v_source   uuid;
  v_existing uuid;
  v_revision bigint;
begin
  select * into v_target from public.plans where id = p_target_plan_id for update;
  if not found or not public.can_manage_org(v_target.organization_id) then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;
  select id into v_source from public.plans
   where id = p_source_plan_id and organization_id = v_target.organization_id;
  if v_source is null or v_source = v_target.id then
    raise exception 'Plan to copy from not found' using errcode = 'P0002';
  end if;

  v_existing := private.claim_plan_copy_key(v_target.organization_id, p_idempotency_key, 'import', v_source, v_target.id);
  if v_existing is not null then
    select content_revision into v_revision from public.plans where id = v_target.id;
    return v_revision;
  end if;

  if p_expected_revision is not null and p_expected_revision <> v_target.content_revision then
    raise exception 'This plan changed since you opened it' using errcode = 'PT409';
  end if;

  perform set_config('f04.conflict_override_reason', coalesce(p_conflict_override_reason, ''), true);
  perform private.copy_plan_children(v_source, v_target.id, p_items, p_needs, p_assignments, null);
  perform set_config('f04.conflict_override_reason', '', true);

  select content_revision into v_revision from public.plans where id = v_target.id;
  return v_revision;
end;
$$;
revoke execute on function public.import_plan_contents(uuid, uuid, boolean, boolean, boolean, bigint, text, text) from public, anon;
grant execute on function public.import_plan_contents(uuid, uuid, boolean, boolean, boolean, bigint, text, text) to authenticated;

drop function if exists public.create_plan(uuid, jsonb, jsonb, uuid, boolean, text);
create or replace function public.create_plan(
  p_organization_id uuid,
  p_plan jsonb,
  p_times jsonb default '[]',
  p_copy_from uuid default null,
  p_copy_assignments boolean default false,
  p_idempotency_key text default null,
  p_conflict_override_reason text default null
)
returns uuid
language plpgsql set search_path = '' as $$
declare
  v_target   uuid := gen_random_uuid();
  v_existing uuid;
  v_source   uuid;
begin
  if not public.can_manage_org(p_organization_id) then
    raise exception 'Only a scheduler can create plans' using errcode = '42501';
  end if;
  if p_copy_from is not null then
    select id into v_source from public.plans
     where id = p_copy_from and organization_id = p_organization_id;
    if v_source is null then
      raise exception 'Plan to copy from not found' using errcode = 'P0002';
    end if;
  end if;

  v_existing := private.claim_plan_copy_key(p_organization_id, p_idempotency_key, 'create', v_source, v_target);
  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.plans (id, organization_id, service_type_id, title, service_date, location, status, notes, created_by)
  select v_target, p_organization_id, (p_plan->>'service_type_id')::uuid, p_plan->>'title',
         (p_plan->>'service_date')::timestamptz, p_plan->>'location',
         coalesce((p_plan->>'status')::public.plan_status, 'draft'), p_plan->>'notes', (select auth.uid());

  insert into public.plan_times (plan_id, kind, name, starts_at, ends_at, sort_order)
  select v_target, coalesce(t.kind, 'service'), t.name, t.starts_at, t.ends_at, (e.ord - 1)::int
    from jsonb_array_elements(coalesce(p_times, '[]')) with ordinality as e(value, ord)
    cross join lateral jsonb_to_record(e.value) as t(
      kind public.plan_time_kind, name text, starts_at timestamptz, ends_at timestamptz);

  if v_source is not null then
    perform set_config('f04.conflict_override_reason', coalesce(p_conflict_override_reason, ''), true);
    perform private.copy_plan_children(v_source, v_target, true, true, coalesce(p_copy_assignments, false), null);
    perform set_config('f04.conflict_override_reason', '', true);
  end if;
  return v_target;
end;
$$;
revoke execute on function public.create_plan(uuid, jsonb, jsonb, uuid, boolean, text, text) from public, anon;
grant execute on function public.create_plan(uuid, jsonb, jsonb, uuid, boolean, text, text) to authenticated;

-- Replaced functions keep their original audience.
revoke execute on function public.blockout_affected_assignments(uuid, uuid, jsonb) from public, anon;
grant execute on function public.blockout_affected_assignments(uuid, uuid, jsonb) to authenticated;
revoke execute on function public.scheduling_conflicts_for_people(uuid, uuid[], uuid[], uuid[]) from public, anon;
grant execute on function public.scheduling_conflicts_for_people(uuid, uuid[], uuid[], uuid[]) to authenticated, service_role;
revoke execute on function public.scheduling_conflicts(uuid, timestamptz, timestamptz, uuid[]) from public, anon;
grant execute on function public.scheduling_conflicts(uuid, timestamptz, timestamptz, uuid[]) to authenticated, service_role;

-- ============================================ F03 readers, one resolver ====
-- The delegated schedule, the combined schedule and cross-organization busy
-- intervals read the same resolver as conflicts and calendars. Real times
-- only where the output has no way to label an approximate window.

create or replace function public.delegated_schedule(p_organization_id uuid, p_person_id uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS TABLE(assignment_id uuid, status assignment_status, plan_id uuid, plan_title text, service_date timestamp with time zone, location text, team_name text, position_name text, times jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (select 1 from public.people p where p.id = p_person_id and p.organization_id = p_organization_id)
     or not private.delegation_allows((select auth.uid()), p_person_id, 'view_schedule') then
    raise exception 'Schedule not found' using errcode = 'P0002';
  end if;
  return query
  select a.id, a.status, p.id, p.title, p.service_date, p.location, t.name, tp.name,
         coalesce((
           select jsonb_agg(jsonb_build_object('id', pt.plan_time_id, 'kind', pt.kind, 'name', pt.name,
                                               'starts_at', pt.starts_at, 'ends_at', pt.ends_at)
                            order by pt.starts_at, pt.plan_time_id)
             from private.assignment_attendance pt
            where pt.assignment_id = a.id and pt.plan_time_id is not null
         ), '[]'::jsonb)
    from public.assignments a
    join public.plans p on p.id = a.plan_id
    left join public.teams t on t.id = a.team_id
    left join public.team_positions tp on tp.id = a.position_id
   where a.person_id = p_person_id
     and p.organization_id = p_organization_id
     and a.visibility = 'released'
     and p.service_date >= coalesce(p_from, current_date - 1)
     and p.service_date < coalesce(p_to, current_date + 366) + 1
   order by p.service_date, p.title;
end;
$function$;

create or replace function public.my_organization_schedule(p_organization_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(kind text, item_id uuid, title text, status text, starts_at timestamp with time zone, ends_at timestamp with time zone, plan_id uuid)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare v_person uuid;
begin
  if p_to <= p_from or p_to - p_from > interval '92 days' then
    raise exception 'Choose a window of at most 92 days' using errcode = '22023';
  end if;
  if not coalesce((select s.combined_schedule from public.user_schedule_settings s
                    where s.user_id = (select auth.uid())), false) then
    raise exception 'Turn on the combined schedule first' using errcode = '42501';
  end if;
  if not public.is_org_member(p_organization_id) then
    raise exception 'Not a member of this organization' using errcode = '42501';
  end if;
  select p.id into v_person from public.people p
   where p.organization_id = p_organization_id and p.profile_id = (select auth.uid());
  if v_person is null then return; end if;

  return query
  select 'assignment'::text, a.id, p.title, a.status::text, pt.starts_at, pt.ends_at, p.id
    from public.assignments a
    join public.plans p on p.id = a.plan_id
    join private.assignment_attendance pt on pt.assignment_id = a.id and pt.plan_time_id is not null
   where a.person_id = v_person and p.organization_id = p_organization_id
     and a.visibility = 'released' and a.status <> 'declined'
     and pt.starts_at < p_to and pt.ends_at > p_from
  union all
  select 'blockout'::text, b.id, coalesce(b.reason, 'Unavailable'), null::text, b.starts_at, b.ends_at, null::uuid
    from public.blockouts b
   where b.person_id = v_person and b.organization_id = p_organization_id
     and b.starts_at < p_to and b.ends_at > p_from
   order by 5;
end;
$function$;

create or replace function public.cross_organization_busy(p_organization_id uuid, p_person_ids uuid[], p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(person_id uuid, starts_at timestamp with time zone, ends_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if (select auth.uid()) is not null
     and not public.has_capability_anywhere(p_organization_id, 'scheduling.manage') then
    raise exception 'Only a scheduler can check conflicts' using errcode = '42501';
  end if;
  if p_to <= p_from or p_to - p_from > interval '92 days' then
    raise exception 'Choose a window of at most 92 days' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select p.id person_id, p.profile_id
      from public.people p
      join public.user_schedule_settings s on s.user_id = p.profile_id and s.share_busy_across_orgs
     where p.id = any (p_person_ids) and p.organization_id = p_organization_id
       and exists (select 1 from public.organization_members m
                    where m.organization_id = p_organization_id and m.user_id = p.profile_id and m.status = 'active')
  ), elsewhere as (
    select c.person_id, op.id other_person_id, op.organization_id
      from candidates c
      join public.people op on op.profile_id = c.profile_id and op.organization_id <> p_organization_id
      join public.organization_members m
        on m.organization_id = op.organization_id and m.user_id = c.profile_id and m.status = 'active'
  )
  select distinct e.person_id, b.starts_at, b.ends_at
    from elsewhere e
    join public.blockouts b on b.person_id = e.other_person_id
   where b.starts_at < p_to and b.ends_at > p_from
  union
  select distinct e.person_id, pt.starts_at, pt.ends_at
    from elsewhere e
    join public.assignments a on a.person_id = e.other_person_id
    join private.assignment_attendance pt on pt.assignment_id = a.id
   where a.visibility = 'released' and a.status <> 'declined'
     and pt.starts_at < p_to and pt.ends_at > p_from;
end;
$function$;
