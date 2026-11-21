-- W8-NAT-D1: a non-owner reading a team roster saw "Unknown" for every
-- teammate, because People rows are owner-only (people_owner_privacy,
-- 20261109000000) and the roster embedded `people`.
--
-- Product decision (2026-11-21): any active member who can view a team sees
-- each rostered person's name, avatar, email, phone and date of birth. Every
-- other private People field (address, notes, medical note, custom fields,
-- gender, marital status, ...) stays owner-only; this function has an
-- explicit column list and nothing else is exposed, and `people` RLS is NOT
-- loosened.
--
-- Scope: teams are readable by every active member of their organization, so
-- the same member sees these fields for people on teams they are not on.
-- Inactive/removed members, members of other organizations and anon get no
-- rows. Email/phone prefer the login profile (as member_contacts did), then
-- the roster entry's own value.

create or replace function public.team_roster_people(p_org uuid)
returns table (
  team_id    uuid,
  person_id  uuid,
  first_name text,
  last_name  text,
  avatar_url text,
  email      text,
  phone      text,
  birthdate  date
)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (tm.team_id, p.id)
         tm.team_id, p.id, p.first_name, p.last_name, p.avatar_url,
         coalesce(pr.email, p.email), coalesce(pr.phone, p.phone), p.birthdate
    from public.team_memberships tm
    join public.teams t on t.id = tm.team_id and t.organization_id = p_org
    join public.people p on p.id = tm.person_id and p.organization_id = p_org
    left join public.profiles pr on pr.id = p.profile_id
   where public.is_org_member(p_org);
$$;
revoke execute on function public.team_roster_people(uuid) from public, anon;
grant execute on function public.team_roster_people(uuid) to authenticated;

comment on function public.team_roster_people(uuid) is
  'W8-NAT-D1: name, avatar, email, phone and birthdate of every rostered person, for any active member of the organization. Other People fields stay owner-only.';
