-- SEC-003: memberships are created only by SECURITY DEFINER functions, and a
-- direct update may change only the role, status and access mode.
--
-- `members_owner_insert` (20261125000000) still let an active owner insert a
-- membership row for ANY user id through PostgREST. That enrolled people of
-- other churches without their consent, copied their profile email into the
-- owner's roster (the member -> Person trigger), and exposed their email and
-- phone through `member_contacts`, whose join did not check the row's status.
-- A direct UPDATE could likewise repoint an existing row's `user_id`.
--
-- Every legitimate join already runs as a SECURITY DEFINER function owned by
-- `postgres` (`private.create_church`, `public.accept_person_invitation`,
-- `public.grant_platform_access`, join-request approval via invitation
-- acceptance), and `public.set_landing_folder` sets the landing folder. The API
-- updates only `role`/`status` (updateMemberSchema) and `access_mode`
-- (updateMemberAccessSchema) with the caller's client, and never inserts.

revoke insert on public.organization_members from anon, authenticated;

revoke update on public.organization_members from anon, authenticated;
grant update (role, status, access_mode) on public.organization_members to authenticated;

comment on policy members_owner_insert on public.organization_members is
  'W7-ACC-D1: membership rows are added directly only by an active owner. Since SEC-003 client roles hold no INSERT privilege at all; joins go through SECURITY DEFINER functions.';

-- Contact details belong to people who are active members of the organization.
create or replace function public.member_contacts(p_org uuid, p_user_ids uuid[])
returns table (user_id uuid, email text, phone text)
language sql
stable
security definer
set search_path = ''
as $$
  select pr.id, pr.email, pr.phone
    from public.profiles pr
    join public.organization_members m
      on m.user_id = pr.id and m.organization_id = p_org and m.status = 'active'
   where pr.id = any(p_user_ids)
     and (pr.id = (select auth.uid()) or public.has_capability(p_org, 'people.view_private'));
$$;
