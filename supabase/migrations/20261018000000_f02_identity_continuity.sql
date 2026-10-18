-- F02 Pass A — identity continuity on top of MOB-005.
--
-- MOB-005 (20261017000300) made Person the canonical reference on
-- assignments, team memberships, response history, respond links and
-- deliveries, created a Person for every member, and lets a Person without a
-- login receive email. This migration closes the remaining identity gaps:
--
--   * Account linking follows the Person. When `people.profile_id` changes
--     (invitation acceptance), every row that names the Person updates its
--     compatibility `user_id` in the same transaction, so readers that still
--     use the login column (calendar feed, legacy queries) see the same
--     assignment ids and history — nothing is copied or merged.
--   * The link is protected. API roles cannot change `profile_id` or move a
--     Person between organizations; a people manager may create a linked
--     Person only for an active member.
--   * Losing a login keeps staffing history: the profile foreign keys on
--     assignments, team places, respond links and answer history now set
--     null instead of cascading.
--   * Possible duplicates are reported, never merged: when a member's Person
--     is created while an unlinked Person with the same email exists, the
--     pair goes to `person_identity_reconciliations` for an administrator.
--   * New staffing refuses a linked Person whose membership is not active,
--     and plan copies carry the Person (a no-login guest copies too).
--
-- Placeholder auth accounts are never created; `user_id` is dropped only in a
-- later, separately reviewed migration.

-- ===================================================== reconciliation ======

create table public.person_identity_reconciliations (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id) on delete cascade,
  -- The login involved (whose Person was created, or who accepted an invitation).
  profile_id           uuid references public.profiles (id) on delete cascade,
  -- The Person that login uses.
  person_id            uuid not null references public.people (id) on delete cascade,
  -- An unlinked Person that may be the same human.
  candidate_person_id  uuid not null references public.people (id) on delete cascade,
  reason               text not null check (reason in ('email_match', 'invitation_conflict')),
  status               text not null default 'open' check (status in ('open', 'kept_separate', 'merged')),
  resolved_by          uuid references public.profiles (id) on delete set null,
  resolved_at          timestamptz,
  created_at           timestamptz not null default now(),
  constraint person_identity_reconciliations_distinct check (person_id <> candidate_person_id),
  constraint person_identity_reconciliations_resolution check ((status = 'open') = (resolved_at is null))
);
create unique index person_identity_reconciliations_open_pair
  on public.person_identity_reconciliations (person_id, candidate_person_id) where status = 'open';
create index person_identity_reconciliations_org_idx
  on public.person_identity_reconciliations (organization_id, status);
create index person_identity_reconciliations_profile_idx on public.person_identity_reconciliations (profile_id);
create index person_identity_reconciliations_candidate_idx on public.person_identity_reconciliations (candidate_person_id);
create index person_identity_reconciliations_resolved_by_idx on public.person_identity_reconciliations (resolved_by);

alter table public.person_identity_reconciliations enable row level security;
create policy person_identity_reconciliations_select on public.person_identity_reconciliations
  for select to authenticated using ((select public.is_org_admin(organization_id)));
revoke insert, update, delete, truncate on public.person_identity_reconciliations from anon, authenticated;

-- Reports unlinked same-email Persons for one linked Person. Never merges.
create or replace function private.report_email_matches(p_person uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.person_identity_reconciliations (organization_id, profile_id, person_id, candidate_person_id, reason)
  select p.organization_id, p.profile_id, p.id, c.id, 'email_match'
    from public.people p
    join public.profiles pr on pr.id = p.profile_id
    join public.people c
      on c.organization_id = p.organization_id
     and c.profile_id is null
     and c.id <> p.id
     and lower(btrim(c.email)) = lower(btrim(pr.email))
   where p.id = p_person and pr.email is not null and btrim(pr.email) <> ''
  on conflict do nothing;
$$;
revoke execute on function private.report_email_matches(uuid) from public, anon, authenticated;

-- MOB-005's member trigger, now also reporting a same-email candidate.
create or replace function private.ensure_organization_member_person()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_person  uuid;
begin
  select * into v_profile from public.profiles where id = new.user_id;
  if v_profile.id is null then
    return new;
  end if;
  insert into public.people (
    organization_id, profile_id, first_name, last_name, avatar_url, email, created_by
  ) values (
    new.organization_id,
    new.user_id,
    coalesce(nullif(btrim(split_part(coalesce(v_profile.full_name, v_profile.email, 'Person'), ' ', 1)), ''), 'Person'),
    nullif(btrim(substring(coalesce(v_profile.full_name, '') from position(' ' in coalesce(v_profile.full_name, '')) + 1)), ''),
    v_profile.avatar_url,
    v_profile.email,
    null
  )
  on conflict do nothing
  returning id into v_person;
  if v_person is not null then
    perform private.report_email_matches(v_person);
  end if;
  return new;
end;
$$;
revoke execute on function private.ensure_organization_member_person() from public, anon, authenticated;

-- Report what the MOB-005 backfill created alongside an unlinked same-email
-- Person (created_by is null only for rows the backfill/trigger made).
do $$
declare
  r record;
begin
  for r in select p.id from public.people p where p.profile_id is not null and p.created_by is null loop
    perform private.report_email_matches(r.id);
  end loop;
end;
$$;

-- ===================================================== link protection =====

create or replace function private.guard_person_link()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.profile_id is distinct from old.profile_id then
    raise exception 'A login is linked to a person by accepting an invitation' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.organization_id is distinct from old.organization_id then
    raise exception 'A person cannot move to another organization' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and new.profile_id is not null and not exists (
       select 1 from public.organization_members m
        where m.organization_id = new.organization_id and m.user_id = new.profile_id and m.status = 'active') then
    raise exception 'Only an active member''s login can be linked here' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function private.guard_person_link() from public, anon, authenticated;

create trigger people_guard_link
  before insert or update on public.people
  for each row execute function private.guard_person_link();

-- Every row naming the Person follows its login.
create or replace function private.propagate_person_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.assignments set user_id = new.profile_id
   where person_id = new.id and user_id is distinct from new.profile_id;
  update public.team_memberships set user_id = new.profile_id
   where person_id = new.id and user_id is distinct from new.profile_id;
  update public.assignment_notifications set user_id = new.profile_id
   where person_id = new.id and user_id is distinct from new.profile_id;
  update public.assignment_responses set assignee_id = new.profile_id
   where assignee_person_id = new.id and assignee_id is distinct from new.profile_id;
  -- Queued email to this Person now belongs to the login too.
  update public.deliveries set recipient_id = new.profile_id
   where recipient_person_id = new.id and status = 'queued' and recipient_id is distinct from new.profile_id;
  return null;
end;
$$;
revoke execute on function private.propagate_person_link() from public, anon, authenticated;

create trigger people_propagate_link
  after update of profile_id on public.people
  for each row
  when (old.profile_id is distinct from new.profile_id)
  execute function private.propagate_person_link();

-- ======================================== history survives a lost login =====

alter table public.assignments drop constraint assignments_user_id_fkey,
  add constraint assignments_user_id_fkey foreign key (user_id) references public.profiles (id) on delete set null;
alter table public.team_memberships drop constraint team_memberships_user_id_fkey,
  add constraint team_memberships_user_id_fkey foreign key (user_id) references public.profiles (id) on delete set null;
alter table public.assignment_notifications drop constraint assignment_notifications_user_id_fkey,
  add constraint assignment_notifications_user_id_fkey foreign key (user_id) references public.profiles (id) on delete set null;
alter table public.assignment_responses drop constraint assignment_responses_assignee_id_fkey,
  add constraint assignment_responses_assignee_id_fkey foreign key (assignee_id) references public.profiles (id) on delete set null;

-- ============================================================ scheduling ====
-- MOB-005's resolver, now refusing a linked Person whose membership is not
-- active (inactive or removed). A Person without a login is schedulable.
create or replace function private.resolve_scheduling_person(
  p_plan_id    uuid,
  p_person_id  uuid,
  p_profile_id uuid
)
returns table (person_id uuid, profile_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.profile_id
    from public.plans pl
    join public.people p on p.organization_id = pl.organization_id
   where pl.id = p_plan_id
     and public.is_org_member(pl.organization_id)
     and (p_person_id is null or p.id = p_person_id)
     and (p_profile_id is null or p.profile_id = p_profile_id)
     and (p_person_id is not null or p_profile_id is not null)
     and (p.profile_id is null or exists (
           select 1 from public.organization_members m
            where m.organization_id = p.organization_id and m.user_id = p.profile_id and m.status = 'active'))
   limit 1;
$$;
revoke execute on function private.resolve_scheduling_person(uuid, uuid, uuid) from public, anon;
grant execute on function private.resolve_scheduling_person(uuid, uuid, uuid) to authenticated, service_role;

-- Plan copies carry the Person, so a no-login guest copies like anyone else;
-- a Person who can no longer be scheduled is left behind.
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
    insert into public.assignments (plan_id, person_id, team_id, position_id, status, created_by)
    select p_target, a.person_id, a.team_id, a.position_id, 'unconfirmed', (select auth.uid())
      from public.assignments a
     where a.plan_id = p_source
       and exists (select 1 from private.resolve_scheduling_person(p_target, a.person_id, null))
       and public.can_schedule_on_plan(p_target, a.team_id)
    on conflict do nothing;
  end if;
end;
$$;

comment on table public.person_identity_reconciliations is
  'F02: possible duplicate identities reported by membership or invitation linking; never merged automatically.';
