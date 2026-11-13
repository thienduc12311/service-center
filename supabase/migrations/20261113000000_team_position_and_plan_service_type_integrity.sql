-- Reference integrity found by QA wave 1 (docs/qa/runs/2026-11-13-wave1).
--
-- 1. A roster membership's position must belong to that membership's team.
--    `team_memberships.position_id` only referenced `team_positions(id)`, so a
--    roster editor could attach another team's position — or another
--    organization's — to a membership (API-D1).
-- 2. A plan's service type must belong to the plan's organization.
--    `plans.service_type_id` only referenced `service_types(id)`, so a planner
--    could create an Alpha plan under a Beta service type (API-D2).
--
-- Both become composite foreign keys, matching the existing
-- `service_types_folder_fk (folder_id, organization_id)` pattern. A foreign or
-- unknown id now fails the same way (23503 → 400 "Referenced record does not
-- exist"), so the error does not reveal whether the id exists elsewhere.
-- The composite keys replace the single-column ones they fully cover: keeping
-- both gives PostgREST two relationships between the same tables, which makes
-- every embedded select (e.g. `service_type:service_types(...)`) ambiguous.

-- ============================================== roster position scope =====

-- Referenced key for the composite foreign key below.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'team_positions_id_team_key'
       and conrelid = 'public.team_positions'::regclass
  ) then
    alter table public.team_positions
      add constraint team_positions_id_team_key unique (id, team_id);
  end if;
end $$;

-- Repair any membership already pointing at another team's position: keep the
-- membership without a position, unless the person already has a no-position
-- membership on that team, in which case the invalid duplicate is removed.
update public.team_memberships tm
   set position_id = null
  from public.team_positions tp
 where tp.id = tm.position_id
   and tp.team_id <> tm.team_id
   and not exists (
     select 1 from public.team_memberships other
      where other.team_id = tm.team_id
        and other.person_id = tm.person_id
        and other.position_id is null
   );

delete from public.team_memberships tm
 using public.team_positions tp
 where tp.id = tm.position_id
   and tp.team_id <> tm.team_id;

-- MATCH SIMPLE: a membership without a position is not checked.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'team_memberships_position_team_fk'
       and conrelid = 'public.team_memberships'::regclass
  ) then
    alter table public.team_memberships
      add constraint team_memberships_position_team_fk
      foreign key (position_id, team_id)
      references public.team_positions (id, team_id)
      on delete cascade;
  end if;
end $$;

alter table public.team_memberships
  drop constraint if exists team_memberships_position_id_fkey;

-- ================================================ plan service type scope =====

-- `service_types_id_org_key` (unique index on (id, organization_id)) already
-- exists and serves as the referenced key.

-- Detach any plan already filed under another organization's service type,
-- the same outcome as that service type being deleted.
update public.plans p
   set service_type_id = null
  from public.service_types st
 where st.id = p.service_type_id
   and st.organization_id <> p.organization_id;

-- Deleting a service type still only clears the plan's service type, never its
-- organization.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'plans_service_type_org_fk'
       and conrelid = 'public.plans'::regclass
  ) then
    alter table public.plans
      add constraint plans_service_type_org_fk
      foreign key (service_type_id, organization_id)
      references public.service_types (id, organization_id)
      on delete set null (service_type_id);
  end if;
end $$;

alter table public.plans
  drop constraint if exists plans_service_type_id_fkey;
