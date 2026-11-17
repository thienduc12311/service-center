-- QA wave 2 (W2-STAFF-D2): the staffing matrix, team candidates and the
-- proposal engine offered People whose organization membership is inactive
-- (or who are archived). Scheduling them then failed at commit, because
-- `private.resolve_scheduling_person` requires an active membership for a
-- Person with a login.
--
-- One rule, one place: a Person is schedulable when they are not archived and
-- either have no login or their login holds an active membership. The member
-- directory exposes it (appended column, so existing readers are unaffected)
-- and `team_candidates` filters on it.

create or replace function private.is_schedulable_person(p_person uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.people p
     where p.id = p_person and p.archived_at is null
       and (p.profile_id is null or exists (
             select 1 from public.organization_members m
              where m.organization_id = p.organization_id and m.user_id = p.profile_id
                and m.status = 'active'))
  );
$$;
revoke execute on function private.is_schedulable_person(uuid) from public, anon;
grant execute on function private.is_schedulable_person(uuid) to authenticated, service_role;

create or replace view public.people_directory
with (security_barrier = true) as
  select p.id, p.organization_id, p.profile_id, p.first_name, p.last_name,
         p.avatar_url, p.campus, p.person_type, p.created_at, p.updated_at,
         p.archived_at,
         (p.archived_at is null and (p.profile_id is null or exists (
            select 1 from public.organization_members m
             where m.organization_id = p.organization_id and m.user_id = p.profile_id
               and m.status = 'active'))) as schedulable
    from public.people p
   where public.is_org_member(p.organization_id);
comment on column public.people_directory.schedulable is
  'QA wave 2: not archived and, when the Person has a login, an active member. Only schedulable People are offered as candidates.';

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
       or public.has_capability(v_team.organization_id, 'scheduling.manage', v_team.service_type_id, p_team)) then
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
