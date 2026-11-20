-- PERF-007: resolve the caller's access sets before filtering assignment rows.
-- The sets use parent keys so a SELECT check on INSERT/UPDATE ... RETURNING
-- also works for a row whose values are not yet in the assignments table.

create function private.my_assignment_person_ids()
returns setof uuid
language sql stable security definer set search_path = '' as $$
  -- Both people SELECT policies admit the caller's own linked Person, even
  -- without active organization membership.
  select p.id from public.people p where p.profile_id = (select auth.uid());
$$;

create function private.my_assignment_related_team_ids()
returns setof uuid
language sql stable security definer set search_path = '' as $$
  with my_teams as materialized (
    select distinct tm.team_id
      from public.team_memberships tm
     where tm.user_id = (select auth.uid())
  )
  select t.team_id from my_teams t
  union
  select r.related_team_id
    from my_teams t
    join public.team_related_visibility r on r.team_id = t.team_id;
$$;

create function private.my_released_assignment_plan_ids(p_all_teams boolean)
returns setof uuid
language sql stable security definer set search_path = '' as $$
  with visible_organizations as materialized (
    select o.id
      from public.organization_members m
      join public.organizations o on o.id = m.organization_id
     where m.user_id = (select auth.uid()) and m.status = 'active'
       and (not p_all_teams or o.assignment_visibility = 'organization' or public.can_manage_org(o.id))
  )
  select p.id from visible_organizations o
  join public.plans p on p.organization_id = o.id;
$$;

create function private.my_assignment_scheduling_targets()
returns table (plan_id uuid, team_id uuid)
language sql stable security definer set search_path = '' as $$
  -- The effective access resolver expands inherited folder grants into
  -- service-type rows and preserves owner/admin and legacy scheduler access.
  with scheduling_scopes as materialized (
    select m.organization_id, a.scope_type, a.scope_id
      from public.organization_members m
      cross join lateral private.effective_access_rows(m.user_id, m.organization_id) a
     where m.user_id = (select auth.uid()) and m.status = 'active'
       and a.capability = 'scheduling.manage'
       and a.scope_type in ('organization', 'service_type', 'team')
  )
  select distinct p.id, t.id
    from scheduling_scopes s
    join public.plans p on p.organization_id = s.organization_id
      and (s.scope_type <> 'service_type' or s.scope_id = p.service_type_id)
    join public.teams t on t.organization_id = s.organization_id
      and (s.scope_type <> 'team' or s.scope_id = t.id);
$$;

revoke all on function private.my_assignment_person_ids(),
  private.my_assignment_related_team_ids(), private.my_released_assignment_plan_ids(boolean),
  private.my_assignment_scheduling_targets() from public, anon, service_role;
grant execute on function private.my_assignment_person_ids(),
  private.my_assignment_related_team_ids(), private.my_released_assignment_plan_ids(boolean),
  private.my_assignment_scheduling_targets() to authenticated;

alter policy assignments_select on public.assignments using (
  (visibility = 'released' and (
    person_id in (select private.my_assignment_person_ids())
    or plan_id in (select private.my_released_assignment_plan_ids(true))
    or (
      plan_id in (select private.my_released_assignment_plan_ids(false))
      and (user_id = (select auth.uid()) or team_id in (select private.my_assignment_related_team_ids()))
    )
  ))
  or (plan_id, team_id) in (select s.plan_id, s.team_id from private.my_assignment_scheduling_targets() s)
);

-- Uncorrelated lookup keeps assignments RLS as the source of child access.
alter policy assignment_time_responses_select on public.assignment_time_responses using (
  assignment_id in (select a.id from public.assignments a)
);
alter policy assignment_attendance_times_select on public.assignment_attendance_times using (
  assignment_id in (select a.id from public.assignments a)
);

-- The old FOR ALL policy added the same scheduling access to SELECT that the
-- parent lookup already supplies. Keep its write expressions on their own
-- commands so reading selected links does not invoke a per-row write check.
drop policy assignment_attendance_times_write on public.assignment_attendance_times;
create policy assignment_attendance_times_insert on public.assignment_attendance_times
  for insert to authenticated with check ((select public.can_schedule_assignment(assignment_id)));
create policy assignment_attendance_times_update on public.assignment_attendance_times
  for update to authenticated
  using ((select public.can_schedule_assignment(assignment_id)))
  with check ((select public.can_schedule_assignment(assignment_id)));
create policy assignment_attendance_times_delete on public.assignment_attendance_times
  for delete to authenticated using ((select public.can_schedule_assignment(assignment_id)));

-- Resolve assignment visibility once for both timed and fallback rows. Keep
-- invoker RLS on plans, times and selected links, including for direct readers
-- of the view. A fallback requires a visible plan and no visible times.
create or replace view private.assignment_attendance with (security_invoker = true) as
select a.id as assignment_id, a.person_id, a.plan_id, a.team_id, a.position_id,
       a.status, a.visibility, a.attendance_mode,
       pt.id as plan_time_id, coalesce(pt.kind::text, 'service') as kind, pt.name,
       coalesce(pt.starts_at, p.service_date) as starts_at,
       coalesce(pt.ends_at, p.service_date + interval '2 hours') as ends_at,
       case when pt.id is null then 'untimed_fallback' else 'plan_time' end as source
  from public.assignments a
  left join public.plan_times pt on pt.plan_id = a.plan_id
  left join public.plans p on p.id = a.plan_id and pt.id is null
  left join public.assignment_attendance_times aat
    on aat.assignment_id = a.id and aat.plan_time_id = pt.id and a.attendance_mode = 'selected'
 where (pt.id is not null and (a.attendance_mode = 'all' or aat.assignment_id is not null))
    or (pt.id is null and p.id is not null);
