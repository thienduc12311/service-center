-- Member avatars and who may change a team's roster.
--
-- 1. Team rosters (team_memberships insert/update/delete) are owners, admins
--    and team leaders only. A leader is anyone holding an explicit
--    `teams.manage` grant that covers the team (team, its service type, a
--    folder above it, or organization-wide). The implicit organization-wide
--    access a legacy scheduler gets from their role no longer edits rosters.
--    Reading rosters is unchanged (team_memberships_select).
-- 2. A public `avatars` bucket. Everyone uploads their own picture under
--    users/<auth.uid()>/…; people managers (owners, see
--    20261109000000_owner_people_permissions) upload any Person's picture
--    under orgs/<organization_id>/….
-- 3. A login's avatar follows them onto every linked Person, so rosters and
--    plans (which read people.avatar_url) show the picture they chose.

-- =========================================================== rosters =====

create or replace function private.can_edit_team_roster(p_user uuid, p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Folder grants arrive expanded to service types; owner/admin rows are
  -- organization-wide. Only the legacy scheduler's role row is left out.
  select coalesce((
    select exists (
      select 1
        from private.effective_access_rows(p_user, t.organization_id) a
       where a.capability = 'teams.manage'
         and a.source <> 'role:scheduler_legacy'
         and (a.scope_type = 'organization'
              or (a.scope_type = 'service_type' and a.scope_id = t.service_type_id)
              or (a.scope_type = 'team' and a.scope_id = t.id))
    )
      from public.teams t
     where t.id = p_team
  ), false);
$$;

revoke execute on function private.can_edit_team_roster(uuid, uuid) from public, anon, authenticated;
grant execute on function private.can_edit_team_roster(uuid, uuid) to authenticated, service_role;

create or replace function public.can_edit_team_roster(p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_edit_team_roster((select auth.uid()), p_team);
$$;

revoke execute on function public.can_edit_team_roster(uuid) from public, anon;
grant execute on function public.can_edit_team_roster(uuid) to authenticated;

-- Split from the old FOR ALL policy so reads never evaluate the write check.
drop policy if exists team_memberships_write on public.team_memberships;
create policy team_memberships_insert on public.team_memberships
  for insert to authenticated
  with check ((select public.can_edit_team_roster(team_id)));
create policy team_memberships_update on public.team_memberships
  for update to authenticated
  using ((select public.can_edit_team_roster(team_id)))
  with check ((select public.can_edit_team_roster(team_id)));
create policy team_memberships_delete on public.team_memberships
  for delete to authenticated
  using ((select public.can_edit_team_roster(team_id)));

-- ============================================================ avatars =====

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- Public bucket: pictures are served by public URL without a select policy.
-- The policies below only cover the caller's own uploads.
create or replace function private.can_write_avatar_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (storage.foldername(p_name))[1] = 'users'
      then (storage.foldername(p_name))[2] = (select auth.uid())::text
    when (storage.foldername(p_name))[1] = 'orgs'
         and (storage.foldername(p_name))[2] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then private.capability_for((select auth.uid()), ((storage.foldername(p_name))[2])::uuid, 'people.manage', null, null)
    else false
  end;
$$;

revoke execute on function private.can_write_avatar_object(text) from public, anon, authenticated;
grant execute on function private.can_write_avatar_object(text) to authenticated;

create policy "avatar owners read their uploads" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and private.can_write_avatar_object(name));
create policy "avatar owners upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and private.can_write_avatar_object(name));
create policy "avatar owners replace" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and private.can_write_avatar_object(name))
  with check (bucket_id = 'avatars' and private.can_write_avatar_object(name));
create policy "avatar owners delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and private.can_write_avatar_object(name));

-- ===================================================== avatar follow =====

create or replace function private.sync_profile_avatar_to_people()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.people
     set avatar_url = new.avatar_url
   where profile_id = new.id
     and avatar_url is distinct from new.avatar_url;
  return new;
end;
$$;

revoke execute on function private.sync_profile_avatar_to_people() from public, anon, authenticated;

create trigger profiles_sync_avatar_to_people
  after update of avatar_url on public.profiles
  for each row
  when (new.avatar_url is distinct from old.avatar_url)
  execute function private.sync_profile_avatar_to_people();
