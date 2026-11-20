-- W7-ACC-D1 (P0): only an organization owner may add a membership row.
--
-- `members_insert` (20260101000100_rls.sql) admits any org admin, and the
-- owner-only restrictive policies added in 20261109000000_owner_people_permissions
-- cover UPDATE and DELETE but not INSERT. An admin could therefore insert any
-- authenticated user, including themselves under a second account or a user
-- of another church, as `owner` through PostgREST.
--
-- This restrictive policy mirrors `members_owner_update` / `members_owner_delete`:
-- a direct INSERT needs an active owner of that organization. Legitimate joins
-- are unaffected because every one of them runs as a SECURITY DEFINER function
-- owned by `postgres` (table owner, RLS not forced): `private.create_church`
-- (new church, first owner), `public.accept_person_invitation` (invitation
-- acceptance, guest claim), `public.grant_platform_access` (platform staff);
-- join-request approval goes through invitation acceptance. The API never
-- inserts memberships with a user-scoped client.

create policy members_owner_insert on public.organization_members as restrictive
  for insert to authenticated
  with check (private.is_people_owner(organization_id));

comment on policy members_owner_insert on public.organization_members is
  'W7-ACC-D1: membership rows are added directly only by an active owner (same rule as members_owner_update/delete). Invitation, church creation and platform access use SECURITY DEFINER functions.';
