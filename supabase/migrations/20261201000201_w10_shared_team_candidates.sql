-- W10-CD-D8: a scheduler scoped to a service type (or folder) gets the
-- candidates of a shared team (no service type) they schedule on their plans.
--
-- team_candidates checked scheduling.manage against the team's own service
-- type, which is NULL for a shared team, so service-type and folder grants
-- never matched and the caller got 404 "Team not found" although
-- assignments_insert (private.can_schedule_on_plan, which checks the plan's
-- service type) lets them schedule that team. The check now also accepts a
-- shared team when the caller holds scheduling.manage for some service type
-- of the organization — exactly the plans they could put the team on. A
-- team-scoped team still requires a grant matching its own type or the team.
-- Nobody else gains access; the function stays security definer and returns
-- only schedulable People (unchanged body). create or replace keeps grants.

create or replace function public.team_candidates(p_team uuid)
returns table (person_id uuid, profile_id uuid, display_name text, source text, eligible boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_team public.teams;
begin
  select * into v_team from public.teams where id = p_team;
  if not found or not (
       public.can_manage_team(p_team)
       or public.has_capability(v_team.organization_id, 'scheduling.manage', v_team.service_type_id, p_team)
       -- A shared team is scheduled on the plans of any service type
       -- (private.can_schedule_on_plan checks the plan's type), so a
       -- scheduler scoped to one of those types may list its candidates.
       or (v_team.service_type_id is null and exists (
             select 1 from public.service_types st
              where st.organization_id = v_team.organization_id
                and private.capability_for((select auth.uid()), v_team.organization_id, 'scheduling.manage', st.id, p_team)))) then
    raise exception 'Team not found' using errcode = 'P0002';
  end if;

  return query
  with members as (
    select distinct tm.person_id from public.team_memberships tm where tm.team_id = p_team
  ), tagged as (
    select distinct pt.person_id
      from public.team_tag_rules r
      join public.person_tags pt on pt.organization_id = r.organization_id and pt.tag = r.tag
     where r.team_id = p_team
       and pt.person_id not in (select m.person_id from members m)
  ), candidates as (
    select m.person_id, 'membership'::text as source from members m
    union all
    select t.person_id, 'tag'::text from tagged t
  )
  select p.id, p.profile_id,
         coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'Unnamed'),
         c.source,
         coalesce(private.is_eligible_for_team(p.profile_id, p_team), false)
    from candidates c
    join public.people p on p.id = c.person_id
   where private.is_schedulable_person(p.id);
end;
$$;
