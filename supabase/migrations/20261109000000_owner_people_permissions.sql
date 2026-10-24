-- Personal information and roster management are reserved to active owners.

create or replace function private.capability_for(
  p_user          uuid,
  p_org           uuid,
  p_cap           public.access_capability,
  p_service_type  uuid default null,
  p_team          uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and p_org is not null
    and (p_cap not in ('people.manage', 'people.view_private') or exists (
      select 1 from public.organization_members owner_membership
       where owner_membership.organization_id = p_org
         and owner_membership.user_id = p_user
         and owner_membership.status = 'active' and owner_membership.role = 'owner'
    )) and (
    exists (
      select 1 from public.organization_members m
       where m.organization_id = p_org and m.user_id = p_user and m.status = 'active'
         and (m.role in ('owner', 'admin') or (m.role = 'scheduler' and m.access_mode = 'legacy'))
    )
    or exists (
      select 1
        from public.access_grants g
        join public.organization_members m
          on m.organization_id = g.organization_id and m.user_id = g.user_id and m.status = 'active'
       where g.organization_id = p_org and g.user_id = p_user and g.capability = p_cap
         and (g.scope_type = 'organization'
              or (g.scope_type = 'service_type' and g.service_type_id = p_service_type)
              or (g.scope_type = 'team' and g.team_id = p_team)
              or (g.scope_type = 'folder' and p_service_type is not null and g.folder_id in (
                    select fp.folder_id
                      from public.service_types st
                     cross join lateral private.folder_path(st.folder_id) fp
                     where st.id = p_service_type and st.organization_id = p_org)))
    )
  );
$$;

create or replace function private.capability_anywhere(
  p_user uuid,
  p_org  uuid,
  p_cap  public.access_capability
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and p_org is not null
    and (p_cap not in ('people.manage', 'people.view_private') or exists (
      select 1 from public.organization_members owner_membership
       where owner_membership.organization_id = p_org
         and owner_membership.user_id = p_user
         and owner_membership.status = 'active' and owner_membership.role = 'owner'
    )) and (
    exists (
      select 1 from public.organization_members m
       where m.organization_id = p_org and m.user_id = p_user and m.status = 'active'
         and (m.role in ('owner', 'admin') or (m.role = 'scheduler' and m.access_mode = 'legacy'))
    )
    or exists (
      select 1
        from public.access_grants g
        join public.organization_members m
          on m.organization_id = g.organization_id and m.user_id = g.user_id and m.status = 'active'
       where g.organization_id = p_org and g.user_id = p_user and g.capability = p_cap
    )
  );
$$;

-- No broad FOR ALL write policy may also expose private rows to non-owners.
create policy people_owner_privacy on public.people as restrictive
  for select to authenticated using (
    profile_id = (select auth.uid())
    or exists (select 1 from public.organization_members m
      where m.organization_id = people.organization_id
        and m.user_id = (select auth.uid()) and m.status = 'active' and m.role = 'owner')
  );

create or replace function public.person_medical_note(p_person uuid)
returns text language sql stable security definer set search_path = '' as $$
  select p.medical_note from public.people p
   where p.id = p_person and exists (
     select 1 from public.organization_members m
      where m.organization_id = p.organization_id and m.user_id = (select auth.uid())
        and m.status = 'active' and m.role = 'owner');
$$;

-- Reuse an identity-bound check without recursing through membership RLS.
create or replace function private.is_people_owner(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.organization_members m
    where m.organization_id = p_org and m.user_id = (select auth.uid())
      and m.status = 'active' and m.role = 'owner');
$$;
revoke all on function private.is_people_owner(uuid) from public, anon;
grant execute on function private.is_people_owner(uuid) to authenticated;

create policy members_owner_update on public.organization_members as restrictive
  for update to authenticated using (private.is_people_owner(organization_id))
  with check (private.is_people_owner(organization_id));
create policy members_owner_delete on public.organization_members as restrictive
  for delete to authenticated using (private.is_people_owner(organization_id));
create policy invitations_owner_only on public.person_invitations as restrictive
  for all to authenticated using (private.is_people_owner(organization_id))
  with check (private.is_people_owner(organization_id));

create or replace function private.effective_access_rows(p_user uuid, p_org uuid)
returns table (
  capability  public.access_capability,
  scope_type  text,
  scope_id    uuid,
  source      text,
  grant_id    uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  with member as (
    select m.role, m.access_mode from public.organization_members m
     where m.organization_id = p_org and m.user_id = p_user and m.status = 'active'
  ), grants as (
    select g.* from public.access_grants g join member on true
     where g.organization_id = p_org and g.user_id = p_user
       and (member.role = 'owner' or g.capability not in ('people.manage', 'people.view_private'))
  )
  select c.capability, 'organization'::text, null::uuid,
         case when member.role in ('owner', 'admin') then 'role:' || member.role::text
              else 'role:scheduler_legacy' end,
         null::uuid
    from member
   cross join unnest(enum_range(null::public.access_capability)) as c(capability)
   where (member.role in ('owner', 'admin') or (member.role = 'scheduler' and member.access_mode = 'legacy'))
     and (member.role = 'owner' or c.capability not in ('people.manage', 'people.view_private'))
  union all
  select g.capability, g.scope_type, coalesce(g.service_type_id, g.team_id, g.folder_id), 'grant', g.id
    from grants g
  union all
  select g.capability, 'service_type', fst.service_type_id, 'grant:folder', g.id
    from grants g
   cross join lateral private.folder_service_types(g.folder_id) fst
   where g.scope_type = 'folder';
$$;
