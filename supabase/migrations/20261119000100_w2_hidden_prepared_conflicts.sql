-- QA wave 2 (W2-STAFF-D1): the conflict engine only considered prepared
-- (unreleased) requests the *viewer* could schedule. A scoped scheduler could
-- therefore double-book a Person who already had a prepared request outside
-- their scope, both in the preview and in the commit-time trigger (which uses
-- the same resolver with the acting user as viewer).
--
-- Every committed, non-declined request now takes part in the overlap check.
-- What the viewer may *see* is decided per row: plan/assignment/time ids and
-- the plan title are returned only when the viewer can schedule on that plan
-- and team (or, for released requests, edit the plan); otherwise the row is
-- reported as "Another commitment" with `redacted = true`, the same way
-- blockouts are reported as "Unavailable".

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
           v.plan_time_id, v.kind, v.name, v.starts_at, v.ends_at, pl.title, v.visibility
      from private.assignment_attendance v
      join public.plans pl on pl.id = v.plan_id
     where pl.organization_id = p_organization_id
       and v.person_id in (select c.person_id from cand c)
       and v.status <> 'declined'
       and not (v.assignment_id = any(coalesce(p_exclude_assignment_ids, '{}')))
       -- Prepared requests the viewer cannot see still block (redacted below).
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
              or (e.visibility = 'released' and private.can_edit_plan(p_viewer, e.plan_id))) as visible
    ) x
   order by 2, 9, 10;
end;
$$;
revoke execute on function private.attendance_conflicts(uuid, uuid, jsonb, uuid[]) from public, anon, authenticated;
grant execute on function private.attendance_conflicts(uuid, uuid, jsonb, uuid[]) to service_role;

-- Legacy window check: same rule.
CREATE OR REPLACE FUNCTION public.scheduling_conflicts(p_organization_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_user_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(user_id uuid, conflict_type text, detail text, starts_at timestamp with time zone, ends_at timestamp with time zone, plan_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
              or (v.visibility = 'released' and private.can_edit_plan(v_viewer, v.plan_id))) as visible
    ) x
   where p.organization_id = p_organization_id and v.status <> 'declined'
     and tstzrange(v.starts_at,v.ends_at,'[)') && tstzrange(p_starts_at,p_ends_at,'[)');
end $function$;
