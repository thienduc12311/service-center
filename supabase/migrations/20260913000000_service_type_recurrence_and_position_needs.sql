-- ============================================================================
-- Service Type recurrence + per-plan "needed positions"
--
-- A Service Type is the template an organization plans against ("Main
-- Service"), and it now records how often plans for it recur so the planner
-- can offer the next sensible date when a scheduler adds a plan.
--
-- `plan_position_needs` records how many people a single plan needs in a given
-- team position ("2 x Acoustic Guitar this Sunday"). It is per-plan, not per
-- team, because the need changes week to week; the team's own position list
-- (team_positions) stays the stable definition.
-- ============================================================================

create type public.plan_recurrence as enum (
  'weekly',
  'biweekly',
  'monthly',
  'occasionally'
);

-- Weekly is the overwhelmingly common case, and it is what every existing row
-- was implicitly assumed to be, so it is a safe backfill default.
alter table public.service_types
  add column recurrence public.plan_recurrence not null default 'weekly';

create table public.plan_position_needs (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references public.plans (id) on delete cascade,
  -- The position already identifies its team, so the team is not duplicated
  -- here: one source of truth, and no way for the two to drift apart.
  position_id  uuid not null references public.team_positions (id) on delete cascade,
  needed       int  not null default 0 check (needed between 0 and 99),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- One row per position per plan; the editor upserts against this.
  unique (plan_id, position_id)
);

-- Reading a plan always loads every need for that plan at once.
create index plan_position_needs_plan_idx on public.plan_position_needs (plan_id);
-- Foreign key lookups and the cascade when a position is deleted.
create index plan_position_needs_position_idx on public.plan_position_needs (position_id);

create trigger set_updated_at before update on public.plan_position_needs
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------ rls ----
-- Same shape as plan_items / plan_times: everyone in the organization may read
-- the plan's needs, only managers may change them. The plan is reached through
-- the existing org_of_plan() security-definer helper.
alter table public.plan_position_needs enable row level security;

create policy plan_position_needs_select on public.plan_position_needs
  for select using (public.is_org_member(public.org_of_plan(plan_id)));
create policy plan_position_needs_write on public.plan_position_needs
  for all using (public.can_manage_org(public.org_of_plan(plan_id)))
  with check (public.can_manage_org(public.org_of_plan(plan_id)));
