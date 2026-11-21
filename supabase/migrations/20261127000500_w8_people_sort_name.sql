-- W8 People list paging: a stored, indexed sort/search key so the People list
-- can be keyset-paged in SQL (`order by sort_name, id`) and searched by name
-- without loading every person.
--
-- sort_name = lower("first last"), the same text the list displays. It is a
-- generated column, so it can never drift from first_name/last_name.
-- Privacy: `people` has column-level SELECT grants for API roles (F01), so the
-- new column is granted explicitly; it holds nothing beyond the name that
-- people_directory already exposes. people_directory is re-created with the
-- column appended (create or replace keeps owner, grants and security_barrier
-- as set here; writes stay revoked per 20261119000400).

alter table public.people
  add column sort_name text generated always as (lower(btrim(first_name || ' ' || coalesce(last_name, '')))) stored;

grant select (sort_name) on public.people to authenticated;

-- Serves the keyset order within an organization (also the RLS org filter).
create index people_org_sort_name_idx on public.people (organization_id, sort_name, id);

create or replace view public.people_directory
with (security_barrier = true) as
  select p.id, p.organization_id, p.profile_id, p.first_name, p.last_name,
         p.avatar_url, p.campus, p.person_type, p.created_at, p.updated_at,
         p.archived_at,
         (p.archived_at is null and (p.profile_id is null or exists (
            select 1 from public.organization_members m
             where m.organization_id = p.organization_id and m.user_id = p.profile_id
               and m.status = 'active'))) as schedulable,
         p.sort_name
    from public.people p
   where public.is_org_member(p.organization_id);

revoke insert, update, delete, truncate, trigger, references
  on public.people_directory from authenticated, anon, public, service_role;
grant select on public.people_directory to authenticated, service_role;
