-- F01 Pass C — separately selected extensions.
--
-- Each block below is independent and off by default; none is required for
-- simple scoped leadership (Pass A/B).
--
-- 1. Folders. Service types can be filed in nested folders of the same
--    organization. A folder grant (plans.edit / scheduling.manage /
--    teams.manage) applies to every service type beneath it. Folders are
--    organizational only — never a second tenant boundary: they carry the
--    organization id, every link is a same-organization composite key, and
--    RLS stays organization-scoped. Moves are administrator-only, serialized
--    per organization, revision-checked, cycle-checked, and refused while
--    they would change anyone's inherited access unless the caller
--    acknowledges the previewed change (preview_folder_move /
--    preview_service_type_move).
-- 2. Service-type archive / copy / shared teams. Archiving hides a service
--    type from pickers; its plans keep their normal audience. Copying copies
--    settings and, when asked, team *associations* — never people, team
--    memberships or grants. A team serves several service types through
--    explicit service_type_teams rows.
-- 3. Team policies (one at a time):
--    a. defaults — default request visibility / response owner (Pass B);
--    b. tag-derived candidates — computed on read, so historical assignments
--       are never rewritten;
--    c. related-team visibility — an organization may restrict who sees
--       released team rosters to the members of that team and explicitly
--       related teams (not transitive);
--    d. secure eligibility — a team may require a current, explicit
--       eligibility record (status clear, verified, not expired). Missing or
--       expired evidence fails closed for new scheduling, membership and
--       release. This records evidence; it is not a background-check product.

-- ========================================================== folders =========

create table public.service_type_folders (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  parent_id        uuid,
  name             text not null check (char_length(btrim(name)) between 1 and 120),
  sort_order       int not null default 0,
  revision         bigint not null default 0,
  archived_at      timestamptz,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint service_type_folders_id_org_key unique (id, organization_id),
  constraint service_type_folders_parent_fk foreign key (parent_id, organization_id)
    references public.service_type_folders (id, organization_id) on delete restrict,
  constraint service_type_folders_not_own_parent check (parent_id is distinct from id)
);
create index service_type_folders_org_idx on public.service_type_folders (organization_id, parent_id, sort_order);
create index service_type_folders_parent_idx on public.service_type_folders (parent_id);
create index service_type_folders_created_by_idx on public.service_type_folders (created_by);
create trigger set_updated_at before update on public.service_type_folders
  for each row execute function public.set_updated_at();

alter table public.service_types
  add column folder_id uuid,
  add column archived_at timestamptz,
  add constraint service_types_folder_fk foreign key (folder_id, organization_id)
    references public.service_type_folders (id, organization_id) on delete restrict;
create index service_types_folder_idx on public.service_types (folder_id);

-- Landing folder: where a member's plan list opens, else the organization's.
alter table public.organizations
  add column default_folder_id uuid,
  add column assignment_visibility text not null default 'organization'
    check (assignment_visibility in ('organization', 'teams')),
  add constraint organizations_default_folder_fk foreign key (default_folder_id, id)
    references public.service_type_folders (id, organization_id) on delete set null (default_folder_id);
create index organizations_default_folder_idx on public.organizations (default_folder_id);

alter table public.organization_members
  add column landing_folder_id uuid,
  add constraint organization_members_landing_folder_fk foreign key (landing_folder_id, organization_id)
    references public.service_type_folders (id, organization_id) on delete set null (landing_folder_id);
create index organization_members_landing_folder_idx on public.organization_members (landing_folder_id);

-- Folder grants.
alter table public.access_grants
  add column folder_id uuid,
  add constraint access_grants_folder_fk foreign key (folder_id, organization_id)
    references public.service_type_folders (id, organization_id) on delete cascade;
alter table public.access_grants drop constraint access_grants_scope_shape;
alter table public.access_grants drop constraint access_grants_capability_scope;
alter table public.access_grants drop constraint access_grants_scope_type_check;
alter table public.access_grants
  add constraint access_grants_scope_type_check
    check (scope_type in ('organization', 'folder', 'service_type', 'team')),
  add constraint access_grants_scope_shape check (
    (scope_type = 'organization' and service_type_id is null and team_id is null and folder_id is null)
    or (scope_type = 'folder' and folder_id is not null and service_type_id is null and team_id is null)
    or (scope_type = 'service_type' and service_type_id is not null and team_id is null and folder_id is null)
    or (scope_type = 'team' and team_id is not null and service_type_id is null and folder_id is null)
  ),
  add constraint access_grants_capability_scope check (
    scope_type = 'organization'
    or (scope_type in ('folder', 'service_type') and capability in ('plans.edit', 'scheduling.manage', 'teams.manage'))
    or (scope_type = 'team' and capability in ('scheduling.manage', 'teams.manage'))
  );
drop index public.access_grants_unique;
create unique index access_grants_unique
  on public.access_grants (organization_id, user_id, capability, scope_type, service_type_id, team_id, folder_id)
  nulls not distinct;
create index access_grants_folder_idx on public.access_grants (folder_id);

alter table public.service_type_folders enable row level security;
create policy service_type_folders_select on public.service_type_folders
  for select to authenticated using ((select public.is_org_member(organization_id)));
-- Structure changes inherited access, so it is administrator-only. Renames
-- and ordering go through update; moves go through move_service_type_folder().
create policy service_type_folders_insert on public.service_type_folders
  for insert to authenticated with check ((select public.is_org_admin(organization_id)));
create policy service_type_folders_update on public.service_type_folders
  for update to authenticated
  using ((select public.is_org_admin(organization_id)))
  with check ((select public.is_org_admin(organization_id)));
create policy service_type_folders_delete on public.service_type_folders
  for delete to authenticated using ((select public.is_org_admin(organization_id)));

-- The folder chain above (and including) a folder.
create or replace function private.folder_path(p_folder uuid)
returns table (folder_id uuid, depth int)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive up as (
    select f.id, f.parent_id, 0 as depth from public.service_type_folders f where f.id = p_folder
    union all
    select f.id, f.parent_id, up.depth + 1
      from public.service_type_folders f join up on f.id = up.parent_id
     where up.depth < 64
  )
  select id, depth from up;
$$;

-- Every service type beneath a folder (any depth).
create or replace function private.folder_service_types(p_folder uuid)
returns table (service_type_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive down as (
    select f.id, 0 as depth from public.service_type_folders f where f.id = p_folder
    union all
    select f.id, down.depth + 1
      from public.service_type_folders f join down on f.parent_id = down.id
     where down.depth < 64
  )
  select st.id from public.service_types st join down on st.folder_id = down.id;
$$;

revoke execute on function private.folder_path(uuid) from public, anon;
revoke execute on function private.folder_service_types(uuid) from public, anon;
grant execute on function private.folder_path(uuid) to authenticated, service_role;
grant execute on function private.folder_service_types(uuid) to authenticated, service_role;

-- Folder-aware resolver (replaces Pass A's).
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
  select p_user is not null and p_org is not null and (
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

-- Effective rows: folder grants are listed as-is and expanded to each
-- service type they cover, so a client matches service_type rows only.
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
  )
  select c.capability, 'organization'::text, null::uuid,
         case when member.role in ('owner', 'admin') then 'role:' || member.role::text
              else 'role:scheduler_legacy' end,
         null::uuid
    from member
   cross join unnest(enum_range(null::public.access_capability)) as c(capability)
   where member.role in ('owner', 'admin') or (member.role = 'scheduler' and member.access_mode = 'legacy')
  union all
  select g.capability, g.scope_type, coalesce(g.service_type_id, g.team_id, g.folder_id), 'grant', g.id
    from grants g
  union all
  select g.capability, 'service_type', fst.service_type_id, 'grant:folder', g.id
    from grants g
   cross join lateral private.folder_service_types(g.folder_id) fst
   where g.scope_type = 'folder';
$$;

-- Administrators replace the grants at one scope (now including folders).
create or replace function public.replace_scope_grants(
  p_org        uuid,
  p_scope_type text,
  p_scope_id   uuid,
  p_grants     jsonb
)
returns setof public.access_grants
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_invalid int;
begin
  if not public.is_org_admin(p_org) then
    raise exception 'Only an administrator can change access' using errcode = '42501';
  end if;
  if jsonb_typeof(p_grants) <> 'array' then
    raise exception 'Grants must be a list' using errcode = '22023';
  end if;
  if p_scope_type not in ('organization', 'folder', 'service_type', 'team') then
    raise exception 'Unknown scope' using errcode = '22023';
  end if;
  if p_scope_type = 'organization' and p_scope_id is not null
     or p_scope_type <> 'organization' and p_scope_id is null then
    raise exception 'Scope id does not match the scope' using errcode = '22023';
  end if;
  if p_scope_type = 'service_type' and not exists (
       select 1 from public.service_types where id = p_scope_id and organization_id = p_org)
     or p_scope_type = 'team' and not exists (
       select 1 from public.teams where id = p_scope_id and organization_id = p_org)
     or p_scope_type = 'folder' and not exists (
       select 1 from public.service_type_folders where id = p_scope_id and organization_id = p_org) then
    raise exception 'Not found' using errcode = 'P0002';
  end if;

  select count(*) into v_invalid
    from jsonb_to_recordset(p_grants) as r(user_id uuid, capability public.access_capability)
   where r.user_id is null or r.capability is null
      or not exists (select 1 from public.organization_members m
                      where m.organization_id = p_org and m.user_id = r.user_id and m.status = 'active');
  if v_invalid > 0 then
    raise exception 'Every grant needs an active member of this organization' using errcode = '22023';
  end if;

  delete from public.access_grants g
   where g.organization_id = p_org and g.scope_type = p_scope_type
     and (p_scope_type = 'organization'
          or (p_scope_type = 'service_type' and g.service_type_id = p_scope_id)
          or (p_scope_type = 'team' and g.team_id = p_scope_id)
          or (p_scope_type = 'folder' and g.folder_id = p_scope_id));

  insert into public.access_grants (organization_id, user_id, capability, scope_type, service_type_id, team_id, folder_id, created_by)
  select distinct p_org, r.user_id, r.capability, p_scope_type,
         case when p_scope_type = 'service_type' then p_scope_id end,
         case when p_scope_type = 'team' then p_scope_id end,
         case when p_scope_type = 'folder' then p_scope_id end,
         (select auth.uid())
    from jsonb_to_recordset(p_grants) as r(user_id uuid, capability public.access_capability);

  return query
    select g.* from public.access_grants g
     where g.organization_id = p_org and g.scope_type = p_scope_type
       and (p_scope_type = 'organization'
            or (p_scope_type = 'service_type' and g.service_type_id = p_scope_id)
            or (p_scope_type = 'team' and g.team_id = p_scope_id)
            or (p_scope_type = 'folder' and g.folder_id = p_scope_id))
     order by g.user_id, g.capability;
end;
$$;

-- --------------------------------------------------- access previews -------
-- Folder grants that reach a service type through the folder chain starting
-- at p_folder (the service type's would-be parent).
create or replace function private.inherited_folder_grants(p_folder uuid)
returns table (user_id uuid, capability public.access_capability)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct g.user_id, g.capability
    from private.folder_path(p_folder) fp
    join public.access_grants g on g.scope_type = 'folder' and g.folder_id = fp.folder_id;
$$;
revoke execute on function private.inherited_folder_grants(uuid) from public, anon;
grant execute on function private.inherited_folder_grants(uuid) to authenticated, service_role;

-- Who gains or loses inherited access to which service types if the given
-- service types move from their current parent chain to p_new_parent.
-- Only folder grants differ between the two chains; grants on the moved
-- subtree itself travel with it.
create or replace function private.move_access_changes(
  p_org         uuid,
  p_old_parent  uuid,
  p_new_parent  uuid,
  p_types       uuid[]
)
returns table (user_id uuid, capability public.access_capability, service_type_id uuid, change text)
language sql
stable
security definer
set search_path = ''
as $$
  with old_g as (select * from private.inherited_folder_grants(p_old_parent)),
       new_g as (select * from private.inherited_folder_grants(p_new_parent)),
       types as (select unnest(p_types) as id)
  select n.user_id, n.capability, t.id, 'gain'
    from new_g n cross join types t
   where not exists (select 1 from old_g o where o.user_id = n.user_id and o.capability = n.capability)
     and not private.capability_for(n.user_id, p_org, n.capability, t.id, null)
  union all
  select o.user_id, o.capability, t.id, 'lose'
    from old_g o cross join types t
   where not exists (select 1 from new_g n where n.user_id = o.user_id and n.capability = o.capability);
$$;
revoke execute on function private.move_access_changes(uuid, uuid, uuid, uuid[]) from public, anon;
grant execute on function private.move_access_changes(uuid, uuid, uuid, uuid[]) to authenticated, service_role;

create or replace function public.preview_folder_move(p_folder uuid, p_new_parent uuid)
returns table (user_id uuid, capability public.access_capability, service_type_id uuid, change text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_folder public.service_type_folders;
begin
  select * into v_folder from public.service_type_folders where id = p_folder;
  if not found or not public.is_org_admin(v_folder.organization_id) then
    raise exception 'Folder not found' using errcode = 'P0002';
  end if;
  return query select * from private.move_access_changes(
    v_folder.organization_id, v_folder.parent_id, p_new_parent,
    array(select f.service_type_id from private.folder_service_types(p_folder) f));
end;
$$;

create or replace function public.preview_service_type_move(p_service_type uuid, p_folder uuid)
returns table (user_id uuid, capability public.access_capability, service_type_id uuid, change text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_type public.service_types;
begin
  select * into v_type from public.service_types where id = p_service_type;
  if not found or not public.is_org_admin(v_type.organization_id) then
    raise exception 'Service type not found' using errcode = 'P0002';
  end if;
  return query select * from private.move_access_changes(
    v_type.organization_id, v_type.folder_id, p_folder, array[v_type.id]);
end;
$$;

-- ------------------------------------------------------------- moves -------
create or replace function public.move_service_type_folder(
  p_folder               uuid,
  p_new_parent           uuid,
  p_expected_revision    bigint,
  p_acknowledge_changes  boolean default false
)
returns public.service_type_folders
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_folder  public.service_type_folders;
  v_changes int;
begin
  select * into v_folder from public.service_type_folders where id = p_folder;
  if not found or not public.is_org_admin(v_folder.organization_id) then
    raise exception 'Folder not found' using errcode = 'P0002';
  end if;
  -- One structural change per organization at a time, so two concurrent
  -- moves cannot together form a cycle.
  perform pg_advisory_xact_lock(hashtextextended('folders:' || v_folder.organization_id::text, 0));
  select * into v_folder from public.service_type_folders where id = p_folder for update;

  if p_expected_revision is not null and p_expected_revision <> v_folder.revision then
    raise exception 'This folder changed since you opened it' using errcode = 'PT409';
  end if;
  if p_new_parent is not null then
    if not exists (select 1 from public.service_type_folders
                    where id = p_new_parent and organization_id = v_folder.organization_id) then
      raise exception 'Destination folder not found' using errcode = 'P0002';
    end if;
    if exists (select 1 from private.folder_path(p_new_parent) fp where fp.folder_id = p_folder) then
      raise exception 'A folder cannot be moved inside itself' using errcode = '22023';
    end if;
  end if;

  select count(*) into v_changes from private.move_access_changes(
    v_folder.organization_id, v_folder.parent_id, p_new_parent,
    array(select f.service_type_id from private.folder_service_types(p_folder) f));
  if v_changes > 0 and not coalesce(p_acknowledge_changes, false) then
    raise exception 'This move changes who can access % service type permission(s); review the preview first', v_changes
      using errcode = 'PT409';
  end if;

  update public.service_type_folders
     set parent_id = p_new_parent, revision = revision + 1
   where id = p_folder
  returning * into v_folder;
  return v_folder;
end;
$$;

create or replace function public.move_service_type(
  p_service_type         uuid,
  p_folder               uuid,
  p_acknowledge_changes  boolean default false
)
returns public.service_types
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_type    public.service_types;
  v_changes int;
begin
  select * into v_type from public.service_types where id = p_service_type;
  if not found or not public.is_org_admin(v_type.organization_id) then
    raise exception 'Service type not found' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('folders:' || v_type.organization_id::text, 0));
  if p_folder is not null and not exists (
       select 1 from public.service_type_folders where id = p_folder and organization_id = v_type.organization_id) then
    raise exception 'Destination folder not found' using errcode = 'P0002';
  end if;

  select count(*) into v_changes
    from private.move_access_changes(v_type.organization_id, v_type.folder_id, p_folder, array[v_type.id]);
  if v_changes > 0 and not coalesce(p_acknowledge_changes, false) then
    raise exception 'This move changes who can access this service type; review the preview first'
      using errcode = 'PT409';
  end if;

  update public.service_types set folder_id = p_folder where id = v_type.id returning * into v_type;
  return v_type;
end;
$$;

-- Service type folder changes only through move_service_type().
create or replace function private.guard_service_type_folder()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and new.folder_id is distinct from old.folder_id
     and not public.is_org_admin(new.organization_id) then
    raise exception 'Only an administrator can move a service type between folders' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function private.guard_service_type_folder() from public, anon, authenticated;
create trigger service_types_guard_folder
  before update of folder_id on public.service_types
  for each row execute function private.guard_service_type_folder();

-- Folder parents change only through move_service_type_folder() (it bumps
-- the revision and checks cycles); a direct update cannot re-parent.
create or replace function private.guard_folder_parent()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and new.parent_id is distinct from old.parent_id
     and new.revision = old.revision then
    raise exception 'Move folders with move_service_type_folder()' using errcode = '42501';
  end if;
  if new.organization_id is distinct from old.organization_id then
    raise exception 'Folders cannot move between organizations' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function private.guard_folder_parent() from public, anon, authenticated;
create trigger service_type_folders_guard_parent
  before update on public.service_type_folders
  for each row execute function private.guard_folder_parent();

-- A member chooses where their plan list opens.
create or replace function public.set_landing_folder(p_org uuid, p_folder uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_org_member(p_org) then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  if p_folder is not null and not exists (
       select 1 from public.service_type_folders where id = p_folder and organization_id = p_org) then
    raise exception 'Folder not found' using errcode = 'P0002';
  end if;
  update public.organization_members set landing_folder_id = p_folder
   where organization_id = p_org and user_id = (select auth.uid());
end;
$$;

revoke execute on function public.preview_folder_move(uuid, uuid) from public, anon;
revoke execute on function public.preview_service_type_move(uuid, uuid) from public, anon;
revoke execute on function public.move_service_type_folder(uuid, uuid, bigint, boolean) from public, anon;
revoke execute on function public.move_service_type(uuid, uuid, boolean) from public, anon;
revoke execute on function public.set_landing_folder(uuid, uuid) from public, anon;
grant execute on function public.preview_folder_move(uuid, uuid) to authenticated;
grant execute on function public.preview_service_type_move(uuid, uuid) to authenticated;
grant execute on function public.move_service_type_folder(uuid, uuid, bigint, boolean) to authenticated;
grant execute on function public.move_service_type(uuid, uuid, boolean) to authenticated;
grant execute on function public.set_landing_folder(uuid, uuid) to authenticated;

-- ============================================ shared teams / copy ===========

create table public.service_type_teams (
  service_type_id  uuid not null,
  team_id          uuid not null,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (service_type_id, team_id),
  constraint service_type_teams_type_fk foreign key (service_type_id, organization_id)
    references public.service_types (id, organization_id) on delete cascade,
  constraint service_type_teams_team_fk foreign key (team_id, organization_id)
    references public.teams (id, organization_id) on delete cascade
);
create index service_type_teams_team_idx on public.service_type_teams (team_id);
create index service_type_teams_org_idx on public.service_type_teams (organization_id);

-- Every team already serves its home service type.
insert into public.service_type_teams (service_type_id, team_id, organization_id)
select t.service_type_id, t.id, t.organization_id from public.teams t where t.service_type_id is not null
on conflict do nothing;

-- A team always serves its home service type, however it was created.
create or replace function private.associate_home_service_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.service_type_id is not null then
    insert into public.service_type_teams (service_type_id, team_id, organization_id)
    values (new.service_type_id, new.id, new.organization_id)
    on conflict do nothing;
  end if;
  return null;
end;
$$;
revoke execute on function private.associate_home_service_type() from public, anon, authenticated;
create trigger teams_associate_home_service_type
  after insert or update of service_type_id on public.teams
  for each row execute function private.associate_home_service_type();

alter table public.service_type_teams enable row level security;
create policy service_type_teams_select on public.service_type_teams
  for select to authenticated using ((select public.is_org_member(organization_id)));
-- Which teams serve a service type is that service type's plan editors' call.
create policy service_type_teams_write on public.service_type_teams
  for all to authenticated
  using ((select public.has_capability(organization_id, 'plans.edit', service_type_id)))
  with check ((select public.has_capability(organization_id, 'plans.edit', service_type_id)));

-- Copy settings (and optionally team associations) — never people or grants.
create or replace function public.copy_service_type(
  p_service_type   uuid,
  p_name           text,
  p_include_teams  boolean default true
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source public.service_types;
  v_id     uuid;
begin
  select * into v_source from public.service_types where id = p_service_type;
  if not found then
    raise exception 'Service type not found' using errcode = 'P0002';
  end if;
  if nullif(btrim(p_name), '') is null then
    raise exception 'Name the copy' using errcode = '22023';
  end if;

  insert into public.service_types (organization_id, name, description, recurrence, sort_order, folder_id)
  values (v_source.organization_id, btrim(p_name), v_source.description, v_source.recurrence,
          v_source.sort_order, v_source.folder_id)
  returning id into v_id;

  if coalesce(p_include_teams, true) then
    insert into public.service_type_teams (service_type_id, team_id, organization_id)
    select v_id, stt.team_id, stt.organization_id
      from public.service_type_teams stt where stt.service_type_id = v_source.id;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.copy_service_type(uuid, text, boolean) from public, anon;
grant execute on function public.copy_service_type(uuid, text, boolean) to authenticated;

-- ======================================================== team policies =====

-- b. Tag-derived candidates ---------------------------------------------------
create table public.person_tags (
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  person_id        uuid not null references public.people (id) on delete cascade,
  tag              text not null check (char_length(btrim(tag)) between 1 and 60),
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  primary key (person_id, tag)
);
create index person_tags_org_tag_idx on public.person_tags (organization_id, tag);
create index person_tags_created_by_idx on public.person_tags (created_by);

create table public.team_tag_rules (
  team_id          uuid not null,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  tag              text not null check (char_length(btrim(tag)) between 1 and 60),
  created_at       timestamptz not null default now(),
  primary key (team_id, tag),
  constraint team_tag_rules_team_fk foreign key (team_id, organization_id)
    references public.teams (id, organization_id) on delete cascade
);
create index team_tag_rules_org_tag_idx on public.team_tag_rules (organization_id, tag);

-- A person's tag must belong to the person's own organization.
create or replace function private.guard_person_tag_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.people p where p.id = new.person_id and p.organization_id = new.organization_id) then
    raise exception 'That person is not in this organization' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke execute on function private.guard_person_tag_org() from public, anon, authenticated;
create trigger person_tags_guard_org
  before insert or update on public.person_tags
  for each row execute function private.guard_person_tag_org();

alter table public.person_tags enable row level security;
alter table public.team_tag_rules enable row level security;
create policy person_tags_select on public.person_tags
  for select to authenticated using (
    (select public.can_manage_org(organization_id))
    or (select public.has_capability(organization_id, 'people.view_private'))
    or exists (select 1 from public.people p where p.id = person_id and p.profile_id = (select auth.uid()))
  );
create policy person_tags_write on public.person_tags
  for all to authenticated
  using ((select public.has_capability(organization_id, 'people.manage')))
  with check ((select public.has_capability(organization_id, 'people.manage')));
create policy team_tag_rules_select on public.team_tag_rules
  for select to authenticated using ((select public.is_org_member(organization_id)));
create policy team_tag_rules_write on public.team_tag_rules
  for all to authenticated
  using ((select public.can_manage_team(team_id)))
  with check ((select public.can_manage_team(team_id)));

-- Candidates for a team: explicit members plus people matching any tag rule.
-- Computed on read: changing tags changes future candidates only.
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
    select distinct tm.user_id from public.team_memberships tm where tm.team_id = p_team
  ), tagged as (
    select distinct pt.person_id
      from public.team_tag_rules r
      join public.person_tags pt on pt.organization_id = r.organization_id and pt.tag = r.tag
     where r.team_id = p_team
  )
  select p.id, m.user_id,
         coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), pr.full_name),
         'membership'::text,
         private.is_eligible_for_team(m.user_id, p_team)
    from members m
    join public.profiles pr on pr.id = m.user_id
    left join public.people p on p.profile_id = m.user_id and p.organization_id = v_team.organization_id
  union all
  select p.id, p.profile_id, concat_ws(' ', p.first_name, p.last_name), 'tag'::text,
         p.profile_id is not null and private.is_eligible_for_team(p.profile_id, p_team)
    from tagged t
    join public.people p on p.id = t.person_id
   where p.profile_id is null or p.profile_id not in (select user_id from members);
end;
$$;

-- c. Related-team visibility --------------------------------------------------
create table public.team_related_visibility (
  team_id          uuid not null,
  related_team_id  uuid not null,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (team_id, related_team_id),
  constraint team_related_visibility_distinct check (team_id <> related_team_id),
  constraint team_related_visibility_team_fk foreign key (team_id, organization_id)
    references public.teams (id, organization_id) on delete cascade,
  constraint team_related_visibility_related_fk foreign key (related_team_id, organization_id)
    references public.teams (id, organization_id) on delete cascade
);
create index team_related_visibility_related_idx on public.team_related_visibility (related_team_id);
create index team_related_visibility_org_idx on public.team_related_visibility (organization_id);

alter table public.team_related_visibility enable row level security;
create policy team_related_visibility_select on public.team_related_visibility
  for select to authenticated using ((select public.is_org_member(organization_id)));
-- "Members of team_id may see related_team_id": granting a view *into*
-- related_team_id is that team's manager's decision.
create policy team_related_visibility_write on public.team_related_visibility
  for all to authenticated
  using ((select public.can_manage_team(related_team_id)))
  with check ((select public.can_manage_team(related_team_id)));

-- May this member see released assignments on this team? Organization-wide
-- unless the organization restricted rosters to teams; then their own teams
-- and teams explicitly related to one of them (one hop, not transitive).
create or replace function private.member_sees_team(p_user uuid, p_org uuid, p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organizations o
     where o.id = p_org and o.assignment_visibility = 'organization'
  ) or exists (
    select 1 from public.team_memberships tm
     where tm.user_id = p_user
       and (tm.team_id = p_team
            or exists (select 1 from public.team_related_visibility r
                        where r.team_id = tm.team_id and r.related_team_id = p_team))
  );
$$;
revoke execute on function private.member_sees_team(uuid, uuid, uuid) from public, anon;
grant execute on function private.member_sees_team(uuid, uuid, uuid) to authenticated, service_role;

create or replace function public.can_see_released_assignment(p_plan uuid, p_team uuid, p_assignee uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select public.is_org_member(p.organization_id)
           and (p_assignee = (select auth.uid())
                or private.member_sees_team((select auth.uid()), p.organization_id, p_team)
                or public.can_manage_org(p.organization_id))
      from public.plans p where p.id = p_plan
  ), false);
$$;
revoke execute on function public.can_see_released_assignment(uuid, uuid, uuid) from public, anon;
grant execute on function public.can_see_released_assignment(uuid, uuid, uuid) to authenticated, service_role;

drop policy if exists assignments_select on public.assignments;
create policy assignments_select on public.assignments
  for select to authenticated using (
    (visibility = 'released' and (select public.can_see_released_assignment(plan_id, team_id, user_id)))
    or (select public.can_schedule_on_plan(plan_id, team_id))
  );

-- d. Secure eligibility -------------------------------------------------------
alter table public.teams
  add column requires_eligibility boolean not null default false,
  add column eligibility_kind text check (eligibility_kind is null or char_length(btrim(eligibility_kind)) between 1 and 60),
  add constraint teams_eligibility_kind_required check (not requires_eligibility or eligibility_kind is not null);

create table public.person_eligibility_records (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  user_id             uuid not null,
  kind                text not null check (char_length(btrim(kind)) between 1 and 60),
  status              text not null check (status in ('clear', 'not_clear', 'pending')),
  -- Evidence: which provider (or 'manual') and its reference — no report body.
  provider            text not null check (char_length(btrim(provider)) between 1 and 80),
  provider_reference  text check (provider_reference is null or char_length(provider_reference) <= 200),
  verified_at         timestamptz not null,
  expires_at          timestamptz not null,
  recorded_by         uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  constraint person_eligibility_records_member_fk foreign key (organization_id, user_id)
    references public.organization_members (organization_id, user_id) on delete cascade,
  constraint person_eligibility_records_window check (expires_at > verified_at)
);
create index person_eligibility_records_lookup_idx
  on public.person_eligibility_records (organization_id, user_id, kind, verified_at desc);
create index person_eligibility_records_recorded_by_idx on public.person_eligibility_records (recorded_by);

alter table public.person_eligibility_records enable row level security;
create policy person_eligibility_records_select on public.person_eligibility_records
  for select to authenticated using (
    user_id = (select auth.uid())
    or (select public.has_capability(organization_id, 'people.view_private'))
  );
create policy person_eligibility_records_insert on public.person_eligibility_records
  for insert to authenticated with check (
    (select public.has_capability(organization_id, 'people.manage'))
    and recorded_by = (select auth.uid())
  );
create policy person_eligibility_records_delete on public.person_eligibility_records
  for delete to authenticated using ((select public.is_org_admin(organization_id)));
-- Append-only: a new record supersedes an old one.
revoke update, truncate on public.person_eligibility_records from anon, authenticated;

-- The latest record of the team's kind decides; anything but a current
-- `clear` (missing, pending, not clear, not yet verified, expired) fails.
create or replace function private.is_eligible_for_team(p_user uuid, p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not t.requires_eligibility then true
    else coalesce((
      select r.status = 'clear' and r.verified_at <= now() and r.expires_at > now()
        from public.person_eligibility_records r
       where r.organization_id = t.organization_id and r.user_id = p_user and r.kind = t.eligibility_kind
       order by r.verified_at desc, r.created_at desc
       limit 1
    ), false)
  end
  from public.teams t where t.id = p_team;
$$;
revoke execute on function private.is_eligible_for_team(uuid, uuid) from public, anon;
grant execute on function private.is_eligible_for_team(uuid, uuid) to authenticated, service_role;

create or replace function private.guard_team_eligibility()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_table_name = 'assignments' then
    -- Prepared rows may be drafted; releasing re-checks.
    if new.visibility = 'released'
       and (tg_op = 'INSERT' or old.visibility = 'prepared' or new.team_id is distinct from old.team_id)
       and not coalesce(private.is_eligible_for_team(new.user_id, new.team_id), true) then
      raise exception 'This team requires a current eligibility record for that person'
        using errcode = '42501';
    end if;
  elsif not coalesce(private.is_eligible_for_team(new.user_id, new.team_id), true) then
    raise exception 'This team requires a current eligibility record for that person'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function private.guard_team_eligibility() from public, anon, authenticated;

create trigger assignments_guard_eligibility
  before insert or update of visibility, team_id on public.assignments
  for each row execute function private.guard_team_eligibility();
create trigger team_memberships_guard_eligibility
  before insert or update of team_id, user_id on public.team_memberships
  for each row execute function private.guard_team_eligibility();

-- Who on a secure team currently lacks valid evidence (leaders' review).
create or replace function public.team_eligibility_status(p_team uuid)
returns table (user_id uuid, eligible boolean, status text, expires_at timestamptz)
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
    select m.user_id, private.is_eligible_for_team(m.user_id, p_team), latest.status, latest.expires_at
      from (select distinct tm.user_id from public.team_memberships tm where tm.team_id = p_team) m
      left join lateral (
        select r.status, r.expires_at from public.person_eligibility_records r
         where r.organization_id = v_team.organization_id and r.user_id = m.user_id
           and r.kind = v_team.eligibility_kind
         order by r.verified_at desc, r.created_at desc limit 1
      ) latest on true;
end;
$$;

revoke execute on function public.team_candidates(uuid) from public, anon;
revoke execute on function public.team_eligibility_status(uuid) from public, anon;
grant execute on function public.team_candidates(uuid) to authenticated;
grant execute on function public.team_eligibility_status(uuid) to authenticated;

comment on table public.service_type_folders is
  'F01 extension: nested, organization-scoped folders of service types. Folder grants inherit downwards.';
comment on table public.service_type_teams is
  'F01 extension: explicit association of a shared team with each service type it serves.';
comment on table public.person_eligibility_records is
  'F01 extension: explicit eligibility evidence for secure teams. Latest record of a kind decides; fails closed.';
