-- F01 Pass A — effective capabilities.
--
-- Until now access was one coarse organization role: owner/admin/scheduler
-- could change everything, a member nothing. This migration adds scoped
-- *capability grants* and one resolver that every RLS policy, Storage policy,
-- database function and the API use, so a leader with access only to Band
-- cannot change Hosts even when calling PostgREST directly.
--
-- Capabilities and the scopes each can be granted at
--   plans.edit           organization | service_type   plan content: create/delete
--                                                       plans, order, times, notes, needs
--   scheduling.manage    organization | service_type | team
--                                                       schedule, notify, prepare/release,
--                                                       see blockouts, conflicts, decline reasons
--   teams.manage         organization | service_type | team
--                                                       team settings, positions, roster
--   people.view_private  organization                  contact/address/personal fields
--   people.manage        organization                  create/edit roster records
--   songs.manage         organization                  song library, arrangements, song books
--   media.manage         organization                  attachments and uploaded files
--   A service_type grant covers plans of that service type (and, for
--   teams.manage, teams whose home service type it is). A team grant covers
--   that team on any plan. Library capabilities are organization-wide only:
--   leading a team never implies the song library.
--
-- Compatibility (no one loses access on deploy)
--   owner/admin        every capability, organization-wide, always.
--   scheduler          every capability above, organization-wide, while the
--                      membership's access_mode is 'legacy' (the default for
--                      every existing and new row). An administrator opts a
--                      scheduler into 'scoped', after which only their explicit
--                      grants apply.
--   member             only explicit grants.
--   The medical note stays owner/admin only (column privilege below).
--
-- Ceilings
--   Granting is owner/admin only. No capability authorizes managing grants,
--   membership, roles or organization settings, so no grant — at any scope —
--   can be used to issue further or administrator grants. A grant belongs to
--   an active membership of the same organization (composite foreign keys);
--   removing or deactivating the membership revokes every grant at once.
--   There are no explicit deny entries: restriction is done by scoping a
--   scheduler and granting less.
--
-- `can_manage_org(org)` keeps its name for existing callers but now means
-- "holds some planning/scheduling/team capability in this organization". It is
-- only a coarse first gate; the precise scope is decided by the policies on
-- the rows themselves.

-- ============================================================ model =========

create type public.access_capability as enum (
  'plans.edit',
  'scheduling.manage',
  'teams.manage',
  'people.view_private',
  'people.manage',
  'songs.manage',
  'media.manage'
);

alter table public.organization_members
  add column access_mode text not null default 'legacy'
    check (access_mode in ('legacy', 'scoped'));

comment on column public.organization_members.access_mode is
  'legacy: a scheduler keeps organization-wide management. scoped: only explicit access_grants apply.';

-- Composite targets so a grant can only name rows of its own organization.
create unique index service_types_id_org_key on public.service_types (id, organization_id);
create unique index teams_id_org_key on public.teams (id, organization_id);

create table public.access_grants (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null,
  capability       public.access_capability not null,
  scope_type       text not null check (scope_type in ('organization', 'service_type', 'team')),
  service_type_id  uuid,
  team_id          uuid,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint access_grants_member_fk foreign key (organization_id, user_id)
    references public.organization_members (organization_id, user_id) on delete cascade,
  constraint access_grants_service_type_fk foreign key (service_type_id, organization_id)
    references public.service_types (id, organization_id) on delete cascade,
  constraint access_grants_team_fk foreign key (team_id, organization_id)
    references public.teams (id, organization_id) on delete cascade,
  constraint access_grants_scope_shape check (
    (scope_type = 'organization' and service_type_id is null and team_id is null)
    or (scope_type = 'service_type' and service_type_id is not null and team_id is null)
    or (scope_type = 'team' and team_id is not null and service_type_id is null)
  ),
  constraint access_grants_capability_scope check (
    scope_type = 'organization'
    or (scope_type = 'service_type' and capability in ('plans.edit', 'scheduling.manage', 'teams.manage'))
    or (scope_type = 'team' and capability in ('scheduling.manage', 'teams.manage'))
  )
);

create unique index access_grants_unique
  on public.access_grants (organization_id, user_id, capability, scope_type, service_type_id, team_id)
  nulls not distinct;
create index access_grants_service_type_idx on public.access_grants (service_type_id);
create index access_grants_team_idx on public.access_grants (team_id);
create index access_grants_created_by_idx on public.access_grants (created_by);

comment on table public.access_grants is
  'F01 scoped capability grants. Written by owners/admins only; resolved by private.capability_for().';

-- ======================================================== resolver ==========
-- One definition of "may this user do X here". Security definer so it can
-- read memberships and grants regardless of the caller's RLS. It lives in the
-- `private` schema, which PostgREST does not expose: API callers reach it only
-- through the public wrappers, which always pass auth.uid(), never a
-- caller-chosen user. Invoker functions may call it in SQL (for example to
-- check that a chosen response owner can act on a request).

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
              or (g.scope_type = 'team' and g.team_id = p_team))
    )
  );
$$;

-- Holds the capability at *some* scope (e.g. may open the scheduler at all).
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
    )
  );
$$;

-- Scheduling on a plan: the plan's service type and the assignment's team.
create or replace function private.can_schedule_on_plan(p_user uuid, p_plan uuid, p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select private.capability_for(p_user, p.organization_id, 'scheduling.manage', p.service_type_id, p_team)
      from public.plans p
      join public.teams t on t.id = p_team and t.organization_id = p.organization_id
     where p.id = p_plan
  ), false);
$$;

create or replace function private.can_edit_plan(p_user uuid, p_plan uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select private.capability_for(p_user, p.organization_id, 'plans.edit', p.service_type_id, null)
      from public.plans p where p.id = p_plan
  ), false);
$$;

create or replace function private.can_manage_team(p_user uuid, p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select private.capability_for(p_user, t.organization_id, 'teams.manage', t.service_type_id, t.id)
      from public.teams t where t.id = p_team
  ), false);
$$;

revoke execute on function private.capability_for(uuid, uuid, public.access_capability, uuid, uuid) from public, anon, authenticated;
revoke execute on function private.capability_anywhere(uuid, uuid, public.access_capability) from public, anon, authenticated;
revoke execute on function private.can_schedule_on_plan(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function private.can_edit_plan(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.can_manage_team(uuid, uuid) from public, anon, authenticated;
grant execute on function private.capability_for(uuid, uuid, public.access_capability, uuid, uuid) to authenticated, service_role;
grant execute on function private.capability_anywhere(uuid, uuid, public.access_capability) to authenticated, service_role;
grant execute on function private.can_schedule_on_plan(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function private.can_edit_plan(uuid, uuid) to authenticated, service_role;
grant execute on function private.can_manage_team(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------- caller-bound wrappers -------
-- Used by policies and by invoker functions. Always the signed-in caller.

create or replace function public.has_capability(
  p_org          uuid,
  p_cap          public.access_capability,
  p_service_type uuid default null,
  p_team         uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.capability_for((select auth.uid()), p_org, p_cap, p_service_type, p_team);
$$;

create or replace function public.has_capability_anywhere(p_org uuid, p_cap public.access_capability)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.capability_anywhere((select auth.uid()), p_org, p_cap);
$$;

create or replace function public.can_schedule_on_plan(p_plan uuid, p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_schedule_on_plan((select auth.uid()), p_plan, p_team);
$$;

create or replace function public.can_edit_plan(p_plan uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_edit_plan((select auth.uid()), p_plan);
$$;

create or replace function public.can_manage_team(p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_manage_team((select auth.uid()), p_team);
$$;

-- Coarse "is some kind of leader here" gate (see header).
create or replace function public.can_manage_org(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.capability_anywhere((select auth.uid()), org, 'plans.edit')
      or private.capability_anywhere((select auth.uid()), org, 'scheduling.manage')
      or private.capability_anywhere((select auth.uid()), org, 'teams.manage');
$$;

revoke execute on function public.has_capability(uuid, public.access_capability, uuid, uuid) from public, anon;
revoke execute on function public.has_capability_anywhere(uuid, public.access_capability) from public, anon;
revoke execute on function public.can_schedule_on_plan(uuid, uuid) from public, anon;
revoke execute on function public.can_edit_plan(uuid) from public, anon;
revoke execute on function public.can_manage_team(uuid) from public, anon;
grant execute on function public.has_capability(uuid, public.access_capability, uuid, uuid) to authenticated, service_role;
grant execute on function public.has_capability_anywhere(uuid, public.access_capability) to authenticated, service_role;
grant execute on function public.can_schedule_on_plan(uuid, uuid) to authenticated, service_role;
grant execute on function public.can_edit_plan(uuid) to authenticated, service_role;
grant execute on function public.can_manage_team(uuid) to authenticated, service_role;

-- ================================================ effective access ==========
-- What a member can do, as rows the API and clients share. Role-derived
-- access is expanded to one organization-scope row per capability so a
-- client needs exactly one matching rule.

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
  )
  select c.capability, 'organization'::text, null::uuid,
         case when member.role in ('owner', 'admin') then 'role:' || member.role::text
              else 'role:scheduler_legacy' end,
         null::uuid
    from member
   cross join unnest(enum_range(null::public.access_capability)) as c(capability)
   where member.role in ('owner', 'admin') or (member.role = 'scheduler' and member.access_mode = 'legacy')
  union all
  select g.capability, g.scope_type, coalesce(g.service_type_id, g.team_id), 'grant', g.id
    from public.access_grants g
    join member on true
   where g.organization_id = p_org and g.user_id = p_user;
$$;
revoke execute on function private.effective_access_rows(uuid, uuid) from public, anon, authenticated;
grant execute on function private.effective_access_rows(uuid, uuid) to authenticated, service_role;

-- The caller's own access in one organization.
create or replace function public.my_effective_access(p_org uuid)
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
  select * from private.effective_access_rows((select auth.uid()), p_org);
$$;

-- Another member's access: administrators only (they review and edit it).
create or replace function public.member_effective_access(p_org uuid, p_user uuid)
returns table (
  capability  public.access_capability,
  scope_type  text,
  scope_id    uuid,
  source      text,
  grant_id    uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_org_admin(p_org) and p_user is distinct from (select auth.uid()) then
    raise exception 'Only an administrator can review someone else''s access' using errcode = '42501';
  end if;
  return query select * from private.effective_access_rows(p_user, p_org);
end;
$$;

-- Why a member may (or may not) do one thing. Same rule as capability_for.
create or replace function public.explain_capability(
  p_org          uuid,
  p_user         uuid,
  p_cap          public.access_capability,
  p_service_type uuid default null,
  p_team         uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_member  public.organization_members;
  v_reasons jsonb;
  v_allowed boolean;
  v_denial  text;
begin
  if not public.is_org_admin(p_org) and p_user is distinct from (select auth.uid()) then
    raise exception 'Only an administrator can review someone else''s access' using errcode = '42501';
  end if;
  if p_service_type is not null and not exists (
       select 1 from public.service_types where id = p_service_type and organization_id = p_org) then
    raise exception 'Service type not found' using errcode = 'P0002';
  end if;
  if p_team is not null and not exists (
       select 1 from public.teams where id = p_team and organization_id = p_org) then
    raise exception 'Team not found' using errcode = 'P0002';
  end if;

  select * into v_member from public.organization_members
   where organization_id = p_org and user_id = p_user;

  select coalesce(jsonb_agg(jsonb_build_object(
           'source', r.source, 'scope_type', r.scope_type, 'scope_id', r.scope_id, 'grant_id', r.grant_id)
           order by r.source, r.scope_type), '[]'::jsonb)
    into v_reasons
    from private.effective_access_rows(p_user, p_org) r
   where r.capability = p_cap
     and (r.scope_type = 'organization'
          or (r.scope_type = 'service_type' and r.scope_id = p_service_type)
          or (r.scope_type = 'team' and r.scope_id = p_team));

  v_allowed := jsonb_array_length(v_reasons) > 0;
  v_denial := case
    when v_allowed then null
    when v_member.id is null then 'not_a_member'
    when v_member.status <> 'active' then 'membership_inactive'
    when v_member.role = 'scheduler' and v_member.access_mode = 'scoped' then 'scoped_scheduler_without_grant'
    when exists (select 1 from public.access_grants g
                  where g.organization_id = p_org and g.user_id = p_user and g.capability = p_cap) then 'grant_outside_scope'
    else 'no_matching_grant'
  end;

  return jsonb_build_object(
    'allowed', v_allowed,
    'capability', p_cap,
    'role', v_member.role,
    'access_mode', v_member.access_mode,
    'reasons', v_reasons,
    'denial', v_denial
  );
end;
$$;

revoke execute on function public.my_effective_access(uuid) from public, anon;
revoke execute on function public.member_effective_access(uuid, uuid) from public, anon;
revoke execute on function public.explain_capability(uuid, uuid, public.access_capability, uuid, uuid) from public, anon;
grant execute on function public.my_effective_access(uuid) to authenticated, service_role;
grant execute on function public.member_effective_access(uuid, uuid) to authenticated, service_role;
grant execute on function public.explain_capability(uuid, uuid, public.access_capability, uuid, uuid) to authenticated, service_role;

-- ================================================ administration ============

alter table public.access_grants enable row level security;

create policy access_grants_select on public.access_grants
  for select to authenticated using (
    user_id = (select auth.uid()) or (select public.is_org_admin(organization_id))
  );
create policy access_grants_insert on public.access_grants
  for insert to authenticated with check (
    (select public.is_org_admin(organization_id)) and created_by = (select auth.uid())
  );
create policy access_grants_delete on public.access_grants
  for delete to authenticated using ((select public.is_org_admin(organization_id)));
-- A grant is replaced, never edited in place.
revoke update, truncate on public.access_grants from anon, authenticated;

-- Replace every grant at one scope (an organization, a service type or a
-- team) in one transaction: the GET/PUT …/access contracts. Administrators
-- only; every user must be an active member and every capability valid at
-- that scope (the table constraints refuse anything else).
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
  if p_scope_type = 'organization' and p_scope_id is not null
     or p_scope_type <> 'organization' and p_scope_id is null then
    raise exception 'Scope id does not match the scope' using errcode = '22023';
  end if;
  if p_scope_type = 'service_type' and not exists (
       select 1 from public.service_types where id = p_scope_id and organization_id = p_org)
     or p_scope_type = 'team' and not exists (
       select 1 from public.teams where id = p_scope_id and organization_id = p_org) then
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
          or (p_scope_type = 'team' and g.team_id = p_scope_id));

  insert into public.access_grants (organization_id, user_id, capability, scope_type, service_type_id, team_id, created_by)
  select distinct p_org, r.user_id, r.capability, p_scope_type,
         case when p_scope_type = 'service_type' then p_scope_id end,
         case when p_scope_type = 'team' then p_scope_id end,
         (select auth.uid())
    from jsonb_to_recordset(p_grants) as r(user_id uuid, capability public.access_capability);

  return query
    select g.* from public.access_grants g
     where g.organization_id = p_org and g.scope_type = p_scope_type
       and (p_scope_type = 'organization'
            or (p_scope_type = 'service_type' and g.service_type_id = p_scope_id)
            or (p_scope_type = 'team' and g.team_id = p_scope_id))
     order by g.user_id, g.capability;
end;
$$;
revoke execute on function public.replace_scope_grants(uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.replace_scope_grants(uuid, text, uuid, jsonb) to authenticated;

-- An administrator changes their own role/mode only through the existing
-- members policies (admin-only). access_mode is covered by members_update.

-- ========================================================== RLS ============
-- Replace every organization-wide "manager" write policy with the scoped
-- resolver. Reads by members are unchanged here (Pass B narrows assignments
-- and people).

-- ---------------------------------------------------------- service types --
drop policy if exists service_types_write on public.service_types;
create policy service_types_insert on public.service_types
  for insert to authenticated with check ((select public.has_capability(organization_id, 'plans.edit')));
create policy service_types_update on public.service_types
  for update to authenticated
  using ((select public.has_capability(organization_id, 'plans.edit', id)))
  with check ((select public.has_capability(organization_id, 'plans.edit', id)));
create policy service_types_delete on public.service_types
  for delete to authenticated using ((select public.has_capability(organization_id, 'plans.edit')));

-- ------------------------------------------------------------------ teams --
drop policy if exists teams_write on public.teams;
-- Creating a team: organization-wide, or within a service type you manage.
create policy teams_insert on public.teams
  for insert to authenticated with check (
    (select public.has_capability(organization_id, 'teams.manage', service_type_id))
  );
create policy teams_update on public.teams
  for update to authenticated
  using ((select public.has_capability(organization_id, 'teams.manage', service_type_id, id)))
  with check ((select public.has_capability(organization_id, 'teams.manage', service_type_id, id)));
-- Deleting a team is a service-type or organization decision, not a team leader's.
create policy teams_delete on public.teams
  for delete to authenticated using (
    (select public.has_capability(organization_id, 'teams.manage', service_type_id))
  );

drop policy if exists team_positions_write on public.team_positions;
create policy team_positions_write on public.team_positions
  for all to authenticated
  using ((select public.can_manage_team(team_id)))
  with check ((select public.can_manage_team(team_id)));

drop policy if exists team_memberships_write on public.team_memberships;
create policy team_memberships_write on public.team_memberships
  for all to authenticated
  using ((select public.can_manage_team(team_id)))
  with check ((select public.can_manage_team(team_id)));

-- Moving a team to another home service type would hand it to that service
-- type's leaders; only someone who manages the destination may do it.
create or replace function private.guard_scoped_moves()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') or (select auth.uid()) is null then
    return new;
  end if;
  if new.organization_id is distinct from old.organization_id then
    raise exception 'Records cannot move between organizations' using errcode = '42501';
  end if;
  -- plpgsql does not short-circuit field access, so test the table first.
  if tg_table_name = 'teams' then
    if new.service_type_id is distinct from old.service_type_id
       and not public.has_capability(new.organization_id, 'teams.manage', new.service_type_id) then
      raise exception 'You cannot move this team into that service type' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function private.guard_scoped_moves() from public, anon, authenticated;

create trigger teams_guard_scoped_moves
  before update on public.teams
  for each row execute function private.guard_scoped_moves();
create trigger plans_guard_scoped_moves
  before update on public.plans
  for each row execute function private.guard_scoped_moves();
create trigger service_types_guard_scoped_moves
  before update on public.service_types
  for each row execute function private.guard_scoped_moves();

-- ------------------------------------------------------------------ plans --
-- WITH CHECK re-evaluates the destination service type, so moving a plan
-- requires plans.edit on both sides.
drop policy if exists plans_write on public.plans;
create policy plans_insert on public.plans
  for insert to authenticated with check (
    (select public.has_capability(organization_id, 'plans.edit', service_type_id))
  );
create policy plans_update on public.plans
  for update to authenticated
  using ((select public.has_capability(organization_id, 'plans.edit', service_type_id)))
  with check ((select public.has_capability(organization_id, 'plans.edit', service_type_id)));
create policy plans_delete on public.plans
  for delete to authenticated using (
    (select public.has_capability(organization_id, 'plans.edit', service_type_id))
  );

drop policy if exists plan_times_write on public.plan_times;
create policy plan_times_write on public.plan_times
  for all to authenticated
  using ((select public.can_edit_plan(plan_id)))
  with check ((select public.can_edit_plan(plan_id)));

drop policy if exists plan_items_write on public.plan_items;
create policy plan_items_write on public.plan_items
  for all to authenticated
  using ((select public.can_edit_plan(plan_id)))
  with check ((select public.can_edit_plan(plan_id)));

-- Needs belong to a position's team: plan editors and that team's schedulers.
create or replace function private.position_team(p_position uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select team_id from public.team_positions where id = p_position;
$$;
revoke execute on function private.position_team(uuid) from public, anon;
grant execute on function private.position_team(uuid) to authenticated, service_role;

drop policy if exists plan_position_needs_write on public.plan_position_needs;
create policy plan_position_needs_write on public.plan_position_needs
  for all to authenticated
  using (
    (select public.can_edit_plan(plan_id))
    or (select public.can_schedule_on_plan(plan_id, private.position_team(position_id)))
  )
  with check (
    (select public.can_edit_plan(plan_id))
    or (select public.can_schedule_on_plan(plan_id, private.position_team(position_id)))
  );

-- ------------------------------------------------------------ assignments --
-- WITH CHECK re-evaluates the new plan/team, so an update cannot move an
-- assignment onto a team the caller does not schedule.
drop policy if exists assignments_insert on public.assignments;
drop policy if exists assignments_delete on public.assignments;
drop policy if exists assignments_update on public.assignments;
create policy assignments_insert on public.assignments
  for insert to authenticated with check ((select public.can_schedule_on_plan(plan_id, team_id)));
create policy assignments_delete on public.assignments
  for delete to authenticated using ((select public.can_schedule_on_plan(plan_id, team_id)));
create policy assignments_update on public.assignments
  for update to authenticated
  using ((select public.can_schedule_on_plan(plan_id, team_id)) or user_id = (select auth.uid()))
  with check ((select public.can_schedule_on_plan(plan_id, team_id)) or user_id = (select auth.uid()));

-- MOB-004's guard, now scoped: full control only for someone who schedules
-- this assignment's team on this plan.
create or replace function public.guard_assignment_self_response()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon', 'service_role') then
    return new;
  end if;

  if (select auth.uid()) is not null
     and public.can_schedule_on_plan(old.plan_id, old.team_id) then
    return new;
  end if;

  if new.plan_id      is distinct from old.plan_id
     or new.user_id     is distinct from old.user_id
     or new.team_id     is distinct from old.team_id
     or new.position_id is distinct from old.position_id
     or new.notes       is distinct from old.notes
     or new.notified_at is distinct from old.notified_at
     or new.created_by  is distinct from old.created_by
     or new.created_at  is distinct from old.created_at then
    raise exception 'Only a scheduler can change this assignment'
      using errcode = '42501';
  end if;

  if new.status is distinct from old.status
     and (old.status = 'declined' or new.status = 'unconfirmed') then
    raise exception 'A % assignment cannot be changed to %; ask a scheduler to request you again',
      old.status, new.status
      using errcode = 'PT409';
  end if;

  return new;
end;
$$;
revoke execute on function public.guard_assignment_self_response() from public, anon, authenticated;

-- Decline reasons: the assignee and whoever schedules that team on that plan.
create or replace function private.can_schedule_assignment(p_user uuid, p_assignment uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select private.can_schedule_on_plan(p_user, a.plan_id, a.team_id)
      from public.assignments a where a.id = p_assignment
  ), false);
$$;
revoke execute on function private.can_schedule_assignment(uuid, uuid) from public, anon, authenticated;
grant execute on function private.can_schedule_assignment(uuid, uuid) to authenticated, service_role;

create or replace function public.can_schedule_assignment(p_assignment uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_schedule_assignment((select auth.uid()), p_assignment);
$$;
revoke execute on function public.can_schedule_assignment(uuid) from public, anon;
grant execute on function public.can_schedule_assignment(uuid) to authenticated, service_role;

-- Used by the delivery worker (service role) to re-check a recipient.
create or replace function public.user_can_schedule_assignment(p_user uuid, p_assignment uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_schedule_assignment(p_user, p_assignment);
$$;
revoke execute on function public.user_can_schedule_assignment(uuid, uuid) from public, anon, authenticated;
grant execute on function public.user_can_schedule_assignment(uuid, uuid) to service_role;

drop policy if exists assignment_responses_select on public.assignment_responses;
create policy assignment_responses_select on public.assignment_responses
  for select to authenticated using (
    assignee_id = (select auth.uid())
    or (select public.can_schedule_assignment(assignment_id))
  );

-- --------------------------------------------------------------- library --
drop policy if exists songs_write on public.songs;
create policy songs_write on public.songs
  for all to authenticated
  using ((select public.has_capability(organization_id, 'songs.manage')))
  with check ((select public.has_capability(organization_id, 'songs.manage')));

drop policy if exists arrangements_write on public.arrangements;
create policy arrangements_write on public.arrangements
  for all to authenticated
  using ((select public.has_capability(public.org_of_song(song_id), 'songs.manage')))
  with check ((select public.has_capability(public.org_of_song(song_id), 'songs.manage')));

drop policy if exists songbooks_write on public.songbooks;
create policy songbooks_write on public.songbooks
  for all to authenticated
  using ((select public.has_capability(organization_id, 'songs.manage')))
  with check ((select public.has_capability(organization_id, 'songs.manage')));

drop policy if exists songbook_items_write on public.songbook_items;
create policy songbook_items_write on public.songbook_items
  for all to authenticated
  using ((select public.has_capability(public.org_of_songbook(songbook_id), 'songs.manage')))
  with check ((select public.has_capability(public.org_of_songbook(songbook_id), 'songs.manage')));

drop policy if exists attachments_write on public.attachments;
create policy attachments_write on public.attachments
  for all to authenticated
  using ((select public.has_capability(organization_id, 'media.manage')))
  with check ((select public.has_capability(organization_id, 'media.manage')));

-- ---------------------------------------------------------------- people --
drop policy if exists people_write on public.people;
create policy people_write on public.people
  for all to authenticated
  using ((select public.has_capability(organization_id, 'people.manage')))
  with check ((select public.has_capability(organization_id, 'people.manage')));

-- ------------------------------------------------------------- blockouts --
-- Anyone who schedules somewhere sees blockouts to schedule around them.
drop policy if exists blockouts_select on public.blockouts;
drop policy if exists blockouts_write on public.blockouts;
create policy blockouts_select on public.blockouts
  for select to authenticated using (
    user_id = (select auth.uid())
    or (select public.has_capability_anywhere(organization_id, 'scheduling.manage'))
  );
create policy blockouts_write on public.blockouts
  for all to authenticated
  using (
    (select public.is_org_member(organization_id))
    and (user_id = (select auth.uid())
         or (select public.has_capability_anywhere(organization_id, 'scheduling.manage')))
  )
  with check (
    (select public.is_org_member(organization_id))
    and (user_id = (select auth.uid())
         or (select public.has_capability_anywhere(organization_id, 'scheduling.manage')))
  );

-- ------------------------------------------------------- delivery outbox --
-- Administrators see every outcome; anyone else only the effects they caused.
drop policy if exists delivery_effects_select on public.delivery_effects;
drop policy if exists deliveries_select on public.deliveries;
create policy delivery_effects_select on public.delivery_effects
  for select to authenticated using (
    (select public.is_org_admin(organization_id)) or created_by = (select auth.uid())
  );
create policy deliveries_select on public.deliveries
  for select to authenticated using (
    (select public.is_org_admin(organization_id))
    or exists (select 1 from public.delivery_effects e
                where e.id = effect_id and e.created_by = (select auth.uid()))
  );

-- Respond-link records hold addresses: administrators only.
drop policy if exists assignment_notifications_select on public.assignment_notifications;
create policy assignment_notifications_select on public.assignment_notifications
  for select to authenticated using ((select public.is_org_admin(organization_id)));

-- ================================================================ storage ===
drop policy if exists "org members write attachments" on storage.objects;
drop policy if exists "org managers delete attachments" on storage.objects;
create policy "media managers write attachments" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and public.has_capability(((storage.foldername(name))[1])::uuid, 'media.manage')
  );
create policy "media managers delete attachments" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and public.has_capability(((storage.foldername(name))[1])::uuid, 'media.manage')
  );

drop policy if exists "org managers write songbooks" on storage.objects;
drop policy if exists "org managers delete songbooks" on storage.objects;
create policy "library managers write songbooks" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'songbooks'
    and public.has_capability(((storage.foldername(name))[1])::uuid, 'songs.manage')
  );
create policy "library managers delete songbooks" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'songbooks'
    and public.has_capability(((storage.foldername(name))[1])::uuid, 'songs.manage')
  );

-- ======================================================== functions =========

-- Conflicts reveal blockout reasons: schedulers only (it was open to members).
create or replace function public.scheduling_conflicts(
  p_organization_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_user_ids uuid[] default null
)
returns table (
  user_id uuid,
  conflict_type text,
  detail text,
  starts_at timestamptz,
  ends_at timestamptz,
  plan_id uuid
)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null
     and not public.has_capability_anywhere(p_organization_id, 'scheduling.manage') then
    raise exception 'Only a scheduler can check conflicts' using errcode = '42501';
  end if;

  return query
  with candidates as (
    select m.user_id
    from public.organization_members m
    where m.organization_id = p_organization_id
      and m.status = 'active'
      and (p_user_ids is null or m.user_id = any (p_user_ids))
  )
  select b.user_id,
         'blockout'::text,
         coalesce(b.reason, 'Unavailable'),
         b.starts_at,
         b.ends_at,
         null::uuid
  from public.blockouts b
  join candidates c on c.user_id = b.user_id
  where b.organization_id = p_organization_id
    and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')

  union all

  select a.user_id,
         'double_booked'::text,
         p.title,
         pt.starts_at,
         pt.ends_at,
         p.id
  from public.assignments a
  join candidates c   on c.user_id = a.user_id
  join public.plans p on p.id = a.plan_id
  join public.plan_times pt on pt.plan_id = p.id and pt.kind = 'service'
  where p.organization_id = p_organization_id
    and a.status <> 'declined'
    and tstzrange(pt.starts_at, pt.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)');
end;
$$;

-- Requests/reminders only for assignments the caller schedules. (The
-- service-role path, auth.uid() null, is the worker/admin side.)
create or replace function private.enqueue_assignment_requests(
  p_plan_id        uuid,
  p_template       public.delivery_template,
  p_assignment_ids uuid[],
  p_effect_key     text,
  p_actor          uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org    uuid;
  v_effect uuid;
  v_ids    uuid[];
begin
  if p_template not in ('assignment_request', 'assignment_reminder') then
    raise exception 'Not an assignment request template' using errcode = '22023';
  end if;

  select organization_id into v_org from public.plans where id = p_plan_id;
  if v_org is null then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;
  if (select auth.uid()) is not null and not public.can_manage_org(v_org) then
    raise exception 'Only a scheduler can notify this plan' using errcode = '42501';
  end if;

  select coalesce(array_agg(a.id order by a.id), '{}')
    into v_ids
    from public.assignments a
   where a.plan_id = p_plan_id and a.id = any(p_assignment_ids)
     and ((select auth.uid()) is null
          or private.can_schedule_on_plan((select auth.uid()), a.plan_id, a.team_id));

  insert into public.delivery_effects (organization_id, effect_key, template, plan_id, assignment_ids, created_by)
  values (v_org, p_effect_key, p_template, p_plan_id, v_ids, p_actor)
  on conflict (organization_id, effect_key) do nothing
  returning id into v_effect;

  if v_effect is null then
    select id into v_effect from public.delivery_effects
     where organization_id = v_org and effect_key = p_effect_key;
    return v_effect;
  end if;

  insert into public.deliveries (organization_id, effect_id, recipient_id, channel)
  select v_org, v_effect, r.user_id, c.channel
    from (select distinct user_id from public.assignments where id = any(v_ids)) r
   cross join unnest(array['in_app', 'push', 'email']::public.delivery_channel[]) as c(channel);

  return v_effect;
end;
$$;

-- Copied staffing: only teams the caller schedules on the destination; the
-- rest is left out instead of failing the whole copy.
create or replace function private.copy_plan_children(
  p_source       uuid,
  p_target       uuid,
  p_items        boolean,
  p_needs        boolean,
  p_assignments  boolean,
  p_time_offset  interval
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_base int;
begin
  if p_items then
    select coalesce(max(sort_order) + 1, 0) into v_base from public.plan_items where plan_id = p_target;
    insert into public.plan_items (
      plan_id, item_type, title, song_id, arrangement_id, key_override,
      length_seconds, description, sort_order
    )
    select p_target, i.item_type, i.title, i.song_id, i.arrangement_id, i.key_override,
           i.length_seconds, i.description,
           v_base + (row_number() over (order by i.sort_order, i.created_at, i.id))::int - 1
      from public.plan_items i
     where i.plan_id = p_source;
  end if;

  if p_time_offset is not null then
    insert into public.plan_times (plan_id, kind, name, starts_at, ends_at)
    select p_target, t.kind, t.name, t.starts_at + p_time_offset, t.ends_at + p_time_offset
      from public.plan_times t
     where t.plan_id = p_source;
  end if;

  if p_needs then
    insert into public.plan_position_needs (plan_id, position_id, needed)
    select p_target, n.position_id, n.needed
      from public.plan_position_needs n
     where n.plan_id = p_source and n.needed > 0
       and (public.can_edit_plan(p_target)
            or public.can_schedule_on_plan(p_target, private.position_team(n.position_id)))
    on conflict (plan_id, position_id) do nothing;
  end if;

  if p_assignments then
    insert into public.assignments (plan_id, user_id, team_id, position_id, status, created_by)
    select p_target, a.user_id, a.team_id, a.position_id, 'unconfirmed', (select auth.uid())
      from public.assignments a
     where a.plan_id = p_source
       and public.can_schedule_on_plan(p_target, a.team_id)
    on conflict do nothing;
  end if;
end;
$$;

comment on function public.has_capability(uuid, public.access_capability, uuid, uuid) is
  'F01: does the signed-in caller hold this capability for the given service type/team scope?';
comment on function public.explain_capability(uuid, uuid, public.access_capability, uuid, uuid) is
  'F01: why a member is allowed or denied one capability at one scope (admins, or the member themself).';
