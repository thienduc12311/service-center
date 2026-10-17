-- MOB-005 — Person-backed scheduling, stable attendance scope and exact
-- versioned request snapshots.
--
-- This migration is deliberately additive. Existing profile-backed readers
-- keep `user_id`; canonical scheduling uses `person_id`, and triggers populate
-- both sides while clients migrate. Response links are upgraded in place to a
-- recorded immutable scope. Provider calls remain outside the transaction;
-- the release/schedule transaction creates the snapshot and durable outbox.

-- ===================================================== Person identity ====

-- Every active legacy membership gets one Person. The unique partial index on
-- (organization_id, profile_id) makes this idempotent and prevents a second
-- roster identity for the same login. Email is copied for contact, never used
-- as identity.
insert into public.people (
  organization_id, profile_id, first_name, last_name, avatar_url, email, created_by
)
select m.organization_id,
       m.user_id,
       coalesce(nullif(btrim(split_part(coalesce(p.full_name, p.email, 'Person'), ' ', 1)), ''), 'Person'),
       nullif(btrim(substring(coalesce(p.full_name, '') from position(' ' in coalesce(p.full_name, '')) + 1)), ''),
       p.avatar_url,
       p.email,
       null
  from public.organization_members m
  join public.profiles p on p.id = m.user_id
 where not exists (
   select 1 from public.people existing
    where existing.organization_id = m.organization_id
      and existing.profile_id = m.user_id
 )
on conflict do nothing;

-- Keep the invariant for memberships created after this migration (including
-- a fresh local seed and account onboarding). Invitation acceptance already
-- links its Person first, so the partial unique index turns this into a no-op.
create or replace function private.ensure_organization_member_person()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_profile public.profiles;
begin
  select * into v_profile from public.profiles where id = new.user_id;
  if v_profile.id is not null then
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
    ) on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke execute on function private.ensure_organization_member_person() from public, anon, authenticated;
create trigger organization_members_ensure_person
  after insert or update of organization_id, user_id on public.organization_members
  for each row execute function private.ensure_organization_member_person();

alter table public.assignments
  add column person_id uuid references public.people (id) on delete restrict,
  add column attendance_mode text not null default 'all'
    check (attendance_mode in ('all', 'selected')),
  add column request_revision bigint not null default 0;

update public.assignments a
   set person_id = p.id
  from public.plans pl
  join public.people p on p.organization_id = pl.organization_id
 where pl.id = a.plan_id
   and p.profile_id = a.user_id
   and a.person_id is null;

alter table public.assignments
  alter column person_id set not null,
  alter column user_id drop not null;

drop index if exists public.assignments_unique_position;
drop index if exists public.assignments_unique_no_position;
create unique index assignments_unique_person_position
  on public.assignments (plan_id, person_id, team_id, position_id)
  where position_id is not null;
create unique index assignments_unique_person_no_position
  on public.assignments (plan_id, person_id, team_id)
  where position_id is null;
create index assignments_person_status_idx on public.assignments (person_id, status);

alter table public.team_memberships
  add column person_id uuid references public.people (id) on delete cascade;

update public.team_memberships tm
   set person_id = p.id
  from public.teams t
  join public.people p on p.organization_id = t.organization_id
 where t.id = tm.team_id
   and p.profile_id = tm.user_id
   and tm.person_id is null;

alter table public.team_memberships
  alter column person_id set not null,
  alter column user_id drop not null;

drop index if exists public.team_memberships_unique_position;
drop index if exists public.team_memberships_unique_no_position;
create unique index team_memberships_unique_person_position
  on public.team_memberships (team_id, person_id, position_id)
  where position_id is not null;
create unique index team_memberships_unique_person_no_position
  on public.team_memberships (team_id, person_id)
  where position_id is null;
create index team_memberships_person_idx on public.team_memberships (person_id);

alter table public.assignment_responses
  add column assignee_person_id uuid references public.people (id) on delete cascade;
update public.assignment_responses r
   set assignee_person_id = a.person_id
  from public.assignments a
 where a.id = r.assignment_id and r.assignee_person_id is null;
alter table public.assignment_responses
  alter column assignee_person_id set not null,
  alter column assignee_id drop not null;
create index assignment_responses_assignee_person_idx
  on public.assignment_responses (assignee_person_id);

-- Resolve the compatibility Profile reference from the canonical Person on
-- inserts and refuse mismatched dual writes. Direct SQL gets the same rule as
-- the API.
create or replace function private.sync_scheduling_person()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_person public.people;
begin
  if tg_table_name = 'assignments' then
    select organization_id into v_org from public.plans where id = new.plan_id;
  else
    select organization_id into v_org from public.teams where id = new.team_id;
  end if;

  if new.person_id is null and new.user_id is not null then
    select * into v_person from public.people
     where organization_id = v_org and profile_id = new.user_id;
  elsif new.person_id is not null then
    select * into v_person from public.people
     where id = new.person_id and organization_id = v_org;
  end if;

  if v_person.id is null then
    raise exception 'That Person does not belong to this organization' using errcode = '22023';
  end if;
  if new.user_id is not null and v_person.profile_id is distinct from new.user_id then
    raise exception 'Person and Profile do not identify the same roster entry' using errcode = '22023';
  end if;

  new.person_id := v_person.id;
  new.user_id := v_person.profile_id;
  return new;
end;
$$;
revoke execute on function private.sync_scheduling_person() from public, anon, authenticated;

create trigger assignments_sync_person
  before insert or update of plan_id, person_id, user_id on public.assignments
  for each row execute function private.sync_scheduling_person();
create trigger team_memberships_sync_person
  before insert or update of team_id, person_id, user_id on public.team_memberships
  for each row execute function private.sync_scheduling_person();

-- ================================================= stable attendance ======

alter table public.plan_times
  add column revision bigint not null default 0,
  add column sort_order int not null default 0;

with ordered as (
  select id, row_number() over (partition by plan_id order by starts_at, id) - 1 as ord
    from public.plan_times
)
update public.plan_times pt set sort_order = ordered.ord
  from ordered where ordered.id = pt.id;

create or replace function private.bump_plan_time_revision()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.kind is distinct from old.kind
     or new.name is distinct from old.name
     or new.starts_at is distinct from old.starts_at
     or new.ends_at is distinct from old.ends_at then
    new.revision := old.revision + 1;
  end if;
  return new;
end;
$$;
revoke execute on function private.bump_plan_time_revision() from public, anon, authenticated;
create trigger plan_times_bump_revision
  before update on public.plan_times
  for each row execute function private.bump_plan_time_revision();

create table public.assignment_attendance_times (
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  plan_time_id uuid not null references public.plan_times (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (assignment_id, plan_time_id)
);
create index assignment_attendance_times_time_idx
  on public.assignment_attendance_times (plan_time_id);

create table public.assignment_time_responses (
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  plan_time_id uuid not null references public.plan_times (id) on delete restrict,
  status public.assignment_status not null check (status <> 'unconfirmed'),
  response_note text check (response_note is null or char_length(response_note) <= 500),
  actor_id uuid references public.profiles (id) on delete set null,
  responded_at timestamptz not null default now(),
  primary key (assignment_id, plan_time_id)
);
create index assignment_time_responses_time_idx
  on public.assignment_time_responses (plan_time_id);

create table public.assignment_time_response_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  plan_time_id uuid not null references public.plan_times (id) on delete restrict,
  assignee_person_id uuid not null references public.people (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  previous_status public.assignment_status,
  status public.assignment_status not null check (status <> 'unconfirmed'),
  response_note text check (response_note is null or char_length(response_note) <= 500),
  created_at timestamptz not null default now()
);
create index assignment_time_response_history_assignment_idx
  on public.assignment_time_response_history (assignment_id, created_at);

-- Selected times must be on the assignment's plan. All-times mode has no
-- stored selection; newly added times therefore join that scope by policy.
create or replace function private.guard_assignment_attendance_time()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.assignments a
    join public.plan_times pt on pt.plan_id = a.plan_id
    where a.id = new.assignment_id and pt.id = new.plan_time_id
  ) then
    raise exception 'Attendance time is not on the assignment plan' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke execute on function private.guard_assignment_attendance_time() from public, anon, authenticated;
create trigger assignment_attendance_times_guard
  before insert or update on public.assignment_attendance_times
  for each row execute function private.guard_assignment_attendance_time();
create trigger assignment_time_responses_guard
  before insert or update on public.assignment_time_responses
  for each row execute function private.guard_assignment_attendance_time();

create or replace function private.assignment_time_ids(p_assignment uuid)
returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(x.id order by x.starts_at, x.id), '{}')
  from (
    select pt.id, pt.starts_at
      from public.assignments a
      join public.plan_times pt on pt.plan_id = a.plan_id
     where a.id = p_assignment
       and (
         a.attendance_mode = 'all'
         or exists (select 1 from public.assignment_attendance_times aat
                     where aat.assignment_id = a.id and aat.plan_time_id = pt.id)
       )
  ) x;
$$;
revoke execute on function private.assignment_time_ids(uuid) from public, anon, authenticated;
grant execute on function private.assignment_time_ids(uuid) to service_role;

create or replace function private.bump_assignment_request_revision()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.plan_id is distinct from old.plan_id
     or new.person_id is distinct from old.person_id
     or new.team_id is distinct from old.team_id
     or new.position_id is distinct from old.position_id
     or new.notes is distinct from old.notes
     or new.visibility is distinct from old.visibility
     or new.attendance_mode is distinct from old.attendance_mode then
    new.request_revision := old.request_revision + 1;
  end if;
  return new;
end;
$$;
revoke execute on function private.bump_assignment_request_revision() from public, anon, authenticated;
create trigger assignments_bump_request_revision
  before update on public.assignments
  for each row execute function private.bump_assignment_request_revision();

create or replace function private.touch_assignment_scope()
returns trigger language plpgsql set search_path = '' as $$
begin
  update public.assignments set request_revision = request_revision + 1
   where id = coalesce(new.assignment_id, old.assignment_id);
  return null;
end;
$$;
revoke execute on function private.touch_assignment_scope() from public, anon, authenticated;
create trigger assignment_attendance_times_touch
  after insert or delete on public.assignment_attendance_times
  for each row execute function private.touch_assignment_scope();

-- Stable-ID replacement for the plan time editor. Old payloads may omit IDs
-- only when the values are unchanged; edits/reorders require IDs and a
-- revision, so list position can never become identity.
create or replace function public.replace_plan_times(
  p_plan_id uuid,
  p_times jsonb,
  p_expected_revision bigint default null
)
returns setof public.plan_times
language plpgsql security invoker set search_path = '' as $$
declare
  v_plan public.plans;
  v_bad int;
begin
  select * into v_plan from public.plans where id = p_plan_id for update;
  if not found or not public.can_edit_plan(p_plan_id) then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;
  if p_expected_revision is not null and p_expected_revision <> v_plan.content_revision then
    raise exception 'The plan changed since you opened it' using errcode = 'PT409';
  end if;
  if jsonb_typeof(p_times) <> 'array' then
    raise exception 'Times must be a list' using errcode = '22023';
  end if;

  select count(*) into v_bad
    from jsonb_to_recordset(p_times) as r(id uuid, kind public.plan_time_kind, name text,
      starts_at timestamptz, ends_at timestamptz, sort_order int)
   where r.id is null
      or r.ends_at <= r.starts_at
      or exists (select 1 from public.plan_times pt where pt.id = r.id and pt.plan_id <> p_plan_id);
  if v_bad > 0 then
    raise exception 'Refresh before editing times; every existing time needs its stable id'
      using errcode = 'PT409';
  end if;

  -- A selected attendance reference cannot be deleted implicitly. The caller
  -- must first review and update the affected assignments.
  if exists (
    select 1 from public.assignment_attendance_times aat
    join public.assignments a on a.id = aat.assignment_id
    where a.plan_id = p_plan_id
      and not exists (
        select 1 from jsonb_to_recordset(p_times) as r(id uuid) where r.id = aat.plan_time_id
      )
  ) then
    raise exception 'A selected attendance time is still assigned; review affected requests first'
      using errcode = 'PT409';
  end if;

  update public.plan_times pt
     set kind = r.kind,
         name = nullif(btrim(r.name), ''),
         starts_at = r.starts_at,
         ends_at = r.ends_at,
         sort_order = r.sort_order
    from jsonb_to_recordset(p_times) as r(id uuid, kind public.plan_time_kind, name text,
      starts_at timestamptz, ends_at timestamptz, sort_order int)
   where pt.id = r.id and pt.plan_id = p_plan_id;

  insert into public.plan_times (id, plan_id, kind, name, starts_at, ends_at, sort_order)
  select r.id, p_plan_id, r.kind, nullif(btrim(r.name), ''), r.starts_at, r.ends_at, r.sort_order
    from jsonb_to_recordset(p_times) as r(id uuid, kind public.plan_time_kind, name text,
      starts_at timestamptz, ends_at timestamptz, sort_order int)
   where not exists (select 1 from public.plan_times pt where pt.id = r.id);

  delete from public.plan_times pt
   where pt.plan_id = p_plan_id
     and not exists (select 1 from jsonb_to_recordset(p_times) as r(id uuid) where r.id = pt.id);

  return query select * from public.plan_times where plan_id = p_plan_id order by sort_order, starts_at, id;
end;
$$;
revoke execute on function public.replace_plan_times(uuid, jsonb, bigint) from public, anon;
grant execute on function public.replace_plan_times(uuid, jsonb, bigint) to authenticated;

-- ================================================= request snapshots ======

create table public.assignment_request_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  plan_id uuid not null references public.plans (id) on delete cascade,
  effect_id uuid references public.delivery_effects (id) on delete cascade,
  version bigint not null default 1 check (version > 0),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  superseded_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint assignment_request_snapshots_expiry check (expires_at > created_at)
);
create unique index assignment_request_snapshots_effect_person_idx
  on public.assignment_request_snapshots (effect_id, person_id)
  where effect_id is not null;
create index assignment_request_snapshots_person_plan_idx
  on public.assignment_request_snapshots (person_id, plan_id, created_at desc);

create table public.assignment_request_snapshot_items (
  snapshot_id uuid not null references public.assignment_request_snapshots (id) on delete cascade,
  assignment_id uuid not null references public.assignments (id) on delete restrict,
  expected_request_revision bigint not null,
  expected_status public.assignment_status not null,
  plan_time_ids uuid[] not null default '{}',
  primary key (snapshot_id, assignment_id)
);
create index assignment_request_snapshot_items_assignment_idx
  on public.assignment_request_snapshot_items (assignment_id);

create table public.assignment_response_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  request_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique (organization_id, person_id, idempotency_key)
);

alter table public.assignment_notifications
  add column person_id uuid references public.people (id) on delete cascade,
  add column snapshot_id uuid references public.assignment_request_snapshots (id) on delete restrict;
update public.assignment_notifications n
   set person_id = p.id
  from public.people p
 where p.organization_id = n.organization_id and p.profile_id = n.user_id
   and n.person_id is null;
alter table public.assignment_notifications
  alter column person_id set not null,
  alter column user_id drop not null;
drop index if exists public.assignment_notifications_one_live;
create unique index assignment_notifications_one_live_person
  on public.assignment_notifications (plan_id, person_id)
  where responded_at is null;
create index assignment_notifications_person_idx on public.assignment_notifications (person_id);

alter table public.delivery_effects
  add column responder_person_id uuid references public.people (id) on delete set null;
update public.delivery_effects e
   set responder_person_id = p.id
  from public.people p
 where p.organization_id = e.organization_id and p.profile_id = e.responder_id
   and e.responder_person_id is null;

alter table public.deliveries
  add column recipient_person_id uuid references public.people (id) on delete cascade;
update public.deliveries d
   set recipient_person_id = p.id
  from public.people p
 where p.organization_id = d.organization_id and p.profile_id = d.recipient_id
   and d.recipient_person_id is null;
alter table public.deliveries
  alter column recipient_person_id set not null,
  alter column recipient_id drop not null;
alter table public.deliveries drop constraint deliveries_one_per_channel;
alter table public.deliveries add constraint deliveries_one_per_person_channel
  unique (effect_id, recipient_person_id, channel);
create index deliveries_recipient_person_idx on public.deliveries (recipient_person_id);

create or replace function private.sync_assignment_notification_person()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_person public.people;
begin
  if new.person_id is null and new.user_id is not null then
    select * into v_person from public.people
     where organization_id = new.organization_id and profile_id = new.user_id;
  else
    select * into v_person from public.people
     where id = new.person_id and organization_id = new.organization_id;
  end if;
  if v_person.id is null or (new.user_id is not null and v_person.profile_id is distinct from new.user_id) then
    raise exception 'Response link Person does not match the organization/Profile' using errcode = '22023';
  end if;
  new.person_id := v_person.id;
  new.user_id := v_person.profile_id;
  return new;
end;
$$;
revoke execute on function private.sync_assignment_notification_person() from public, anon, authenticated;
create trigger assignment_notifications_sync_person
  before insert or update of organization_id, person_id, user_id on public.assignment_notifications
  for each row execute function private.sync_assignment_notification_person();

-- One immutable snapshot for exactly the assignments in one effect/person.
create or replace function private.create_assignment_request_snapshot(
  p_effect uuid,
  p_person uuid,
  p_plan uuid,
  p_assignment_ids uuid[],
  p_actor uuid
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_snapshot uuid;
  v_org uuid;
  v_expiry timestamptz;
begin
  select organization_id, greatest(service_date + interval '1 day', now() + interval '15 minutes')
    into v_org, v_expiry from public.plans where id = p_plan;
  if v_org is null or not exists (
    select 1 from public.people where id = p_person and organization_id = v_org
  ) then
    raise exception 'Snapshot recipient is not on this plan' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_assignment_ids) ids(id)
     where not exists (
       select 1 from public.assignments a
        where a.id = ids.id and a.plan_id = p_plan and a.person_id = p_person
          and a.visibility = 'released'
     )
  ) then
    raise exception 'Snapshot contains an unavailable request' using errcode = '22023';
  end if;

  insert into public.assignment_request_snapshots (
    organization_id, person_id, plan_id, effect_id, expires_at, created_by
  ) values (v_org, p_person, p_plan, p_effect, v_expiry, p_actor)
  on conflict (effect_id, person_id) where effect_id is not null do nothing
  returning id into v_snapshot;

  if v_snapshot is null then
    select id into v_snapshot from public.assignment_request_snapshots
     where effect_id = p_effect and person_id = p_person;
    return v_snapshot;
  end if;

  insert into public.assignment_request_snapshot_items (
    snapshot_id, assignment_id, expected_request_revision, expected_status, plan_time_ids
  )
  select v_snapshot, a.id, a.request_revision, a.status, private.assignment_time_ids(a.id)
    from public.assignments a
   where a.id = any(p_assignment_ids) and a.person_id = p_person and a.plan_id = p_plan
   order by a.id;

  return v_snapshot;
end;
$$;
revoke execute on function private.create_assignment_request_snapshot(uuid, uuid, uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function private.create_assignment_request_snapshot(uuid, uuid, uuid, uuid[], uuid) to service_role;

-- Upgrade every outstanding legacy link to the exact rows that existed when
-- this migration ran. A later assignment is therefore outside its scope. A
-- link with no released rows is consumed and must be safely reissued.
do $$
declare
  v_link public.assignment_notifications;
  v_ids uuid[];
  v_snapshot uuid;
begin
  for v_link in select * from public.assignment_notifications where responded_at is null loop
    select coalesce(array_agg(a.id order by a.id), '{}') into v_ids
      from public.assignments a
     where a.plan_id = v_link.plan_id and a.person_id = v_link.person_id
       and a.visibility = 'released';
    if cardinality(v_ids) = 0 then
      update public.assignment_notifications set responded_at = now() where id = v_link.id;
    else
      v_snapshot := private.create_assignment_request_snapshot(
        null, v_link.person_id, v_link.plan_id, v_ids, v_link.created_by
      );
      update public.assignment_notifications set snapshot_id = v_snapshot where id = v_link.id;
    end if;
  end loop;
end;
$$;

-- ================================================= outbox integration =====

-- Replaces F01's enqueue helper. The effect stores exact assignment ids; each
-- Person gets a snapshot in the same transaction and only eligible channels.
create or replace function private.enqueue_assignment_requests(
  p_plan_id uuid,
  p_template public.delivery_template,
  p_assignment_ids uuid[],
  p_effect_key text,
  p_actor uuid
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_effect uuid;
  v_ids uuid[];
  v_recipient record;
begin
  if p_template not in ('assignment_request', 'assignment_reminder') then
    raise exception 'Not an assignment request template' using errcode = '22023';
  end if;
  select organization_id into v_org from public.plans where id = p_plan_id;
  if v_org is null then raise exception 'Plan not found' using errcode = 'P0002'; end if;
  if (select auth.uid()) is not null and not public.can_manage_org(v_org) then
    raise exception 'Only a scheduler can notify this plan' using errcode = '42501';
  end if;

  select coalesce(array_agg(a.id order by a.id), '{}') into v_ids
    from public.assignments a
   where a.plan_id = p_plan_id and a.id = any(p_assignment_ids)
     and a.visibility = 'released'
     and ((select auth.uid()) is null
          or private.can_schedule_on_plan((select auth.uid()), a.plan_id, a.team_id));

  insert into public.delivery_effects (
    organization_id, effect_key, template, plan_id, assignment_ids, created_by
  ) values (v_org, p_effect_key, p_template, p_plan_id, v_ids, p_actor)
  on conflict (organization_id, effect_key) do nothing
  returning id into v_effect;
  if v_effect is null then
    select id into v_effect from public.delivery_effects
     where organization_id = v_org and effect_key = p_effect_key;
    return v_effect;
  end if;

  for v_recipient in
    select a.person_id, p.profile_id, array_agg(a.id order by a.id) assignment_ids
      from public.assignments a
      join public.people p on p.id = a.person_id
     where a.id = any(v_ids)
     group by a.person_id, p.profile_id
  loop
    perform private.create_assignment_request_snapshot(
      v_effect, v_recipient.person_id, p_plan_id, v_recipient.assignment_ids, p_actor
    );
    -- Email works for no-login Persons. In-app/push require a Profile.
    insert into public.deliveries (
      organization_id, effect_id, recipient_id, recipient_person_id, channel
    ) values (v_org, v_effect, v_recipient.profile_id, v_recipient.person_id, 'email');
    if v_recipient.profile_id is not null then
      insert into public.deliveries (
        organization_id, effect_id, recipient_id, recipient_person_id, channel
      ) values
        (v_org, v_effect, v_recipient.profile_id, v_recipient.person_id, 'in_app'),
        (v_org, v_effect, v_recipient.profile_id, v_recipient.person_id, 'push');
    end if;
  end loop;
  return v_effect;
end;
$$;
revoke execute on function private.enqueue_assignment_requests(uuid, public.delivery_template, uuid[], text, uuid) from public;
grant execute on function private.enqueue_assignment_requests(uuid, public.delivery_template, uuid[], text, uuid) to authenticated, service_role;

-- Canonical Person-aware scheduler effects. The compatibility responder
-- Profile may be NULL for a public response from a no-login Person.
create or replace function private.enqueue_scheduler_responses(
  p_assignment_ids uuid[],
  p_responder uuid,
  p_status public.assignment_status,
  p_transition text,
  p_effect_key text
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_plan uuid;
  v_person uuid;
  v_plans int;
  v_effect uuid;
begin
  select min(p.organization_id::text)::uuid, min(a.plan_id::text)::uuid,
         min(a.person_id::text)::uuid, count(distinct a.plan_id)
    into v_org, v_plan, v_person, v_plans
    from public.assignments a join public.plans p on p.id = a.plan_id
   where a.id = any(p_assignment_ids)
     and (p_responder is null or a.user_id = p_responder);
  if v_plans = 0 then return null; end if;
  if v_plans > 1 then raise exception 'One response effect covers one plan' using errcode = '22023'; end if;
  if (select auth.uid()) is not null and (select auth.uid()) is distinct from p_responder then
    raise exception 'Only the assignee can answer' using errcode = '42501';
  end if;

  insert into public.delivery_effects (
    organization_id, effect_key, template, plan_id, assignment_ids,
    responder_id, responder_person_id, response_status, response_transition, created_by
  )
  select v_org, p_effect_key, 'scheduler_response', v_plan,
         array_agg(a.id order by a.id), p_responder, v_person, p_status, p_transition, p_responder
    from public.assignments a where a.id = any(p_assignment_ids) and a.person_id = v_person
  on conflict (organization_id, effect_key) do nothing
  returning id into v_effect;
  if v_effect is null then
    select id into v_effect from public.delivery_effects
     where organization_id = v_org and effect_key = p_effect_key;
    return v_effect;
  end if;

  insert into public.deliveries (
    organization_id, effect_id, recipient_id, recipient_person_id, channel
  )
  select v_org, v_effect, owners.owner_id, people.id, channels.channel
    from (
      select distinct coalesce(a.response_owner_id, a.created_by) owner_id
        from public.assignments a
       where a.id = any(p_assignment_ids)
         and coalesce(a.response_owner_id, a.created_by) is not null
         and coalesce(a.response_owner_id, a.created_by) is distinct from p_responder
    ) owners
    join public.people people on people.organization_id = v_org and people.profile_id = owners.owner_id
    cross join unnest(
      case when p_status = 'declined'
           then array['in_app','push','email']::public.delivery_channel[]
           else array['in_app','push']::public.delivery_channel[] end
    ) channels(channel);
  return v_effect;
end;
$$;
revoke execute on function private.enqueue_scheduler_responses(uuid[], uuid, public.assignment_status, text, text) from public;
grant execute on function private.enqueue_scheduler_responses(uuid[], uuid, public.assignment_status, text, text) to authenticated, service_role;

-- Person-first scheduling with selected attendance IDs. Legacy `user_id`
-- payloads are resolved to the already-linked Person, never by email.
create or replace function private.resolve_scheduling_person(
  p_plan_id uuid,
  p_person_id uuid,
  p_profile_id uuid
)
returns table (person_id uuid, profile_id uuid)
language sql stable security definer set search_path = '' as $$
  select p.id, p.profile_id
    from public.plans pl
    join public.people p on p.organization_id = pl.organization_id
   where pl.id = p_plan_id
     and public.is_org_member(pl.organization_id)
     and (p_person_id is null or p.id = p_person_id)
     and (p_profile_id is null or p.profile_id = p_profile_id)
     and (p_person_id is not null or p_profile_id is not null)
   limit 1;
$$;
revoke execute on function private.resolve_scheduling_person(uuid, uuid, uuid) from public, anon;
grant execute on function private.resolve_scheduling_person(uuid, uuid, uuid) to authenticated, service_role;

drop function if exists public.schedule_plan_assignments(uuid, jsonb, boolean, text, text, uuid);
create or replace function public.schedule_plan_assignments(
  p_plan_id uuid,
  p_assignments jsonb,
  p_notify boolean,
  p_effect_key text default null,
  p_visibility text default null,
  p_response_owner uuid default null
)
returns setof public.assignments
language plpgsql security invoker set search_path = '' as $$
declare
  v_org uuid;
  v_ids uuid[];
  v_released uuid[];
  v_invalid int;
begin
  select organization_id into v_org from public.plans where id = p_plan_id;
  if v_org is null then raise exception 'Plan not found' using errcode = 'P0002'; end if;
  if not public.can_manage_org(v_org) then
    raise exception 'Only a scheduler can schedule people' using errcode = '42501';
  end if;
  if jsonb_typeof(p_assignments) <> 'array' then
    raise exception 'Assignments must be a list' using errcode = '22023';
  end if;
  if p_visibility is not null and p_visibility not in ('prepared','released') then
    raise exception 'Visibility is prepared or released' using errcode = '22023';
  end if;

  with requested as (
    select r.*,
           p.person_id resolved_person_id,
           p.profile_id resolved_profile_id
      from jsonb_to_recordset(p_assignments) as r(
        person_id uuid, user_id uuid, team_id uuid, position_id uuid, notes text,
        visibility text, attendance_mode text, time_ids uuid[]
      )
      left join lateral private.resolve_scheduling_person(p_plan_id, r.person_id, r.user_id) p on true
  )
  select count(*) into v_invalid from requested r
   where r.resolved_person_id is null or r.team_id is null
      or r.attendance_mode not in ('all','selected')
      or (coalesce(r.attendance_mode, 'all') = 'selected' and coalesce(cardinality(r.time_ids), 0) = 0)
      or not exists (select 1 from public.teams t where t.id = r.team_id and t.organization_id = v_org)
      or (r.position_id is not null and not exists (
          select 1 from public.team_positions tp where tp.id = r.position_id and tp.team_id = r.team_id))
      or exists (select 1 from unnest(coalesce(r.time_ids, '{}')) tid
                  where not exists (select 1 from public.plan_times pt where pt.id = tid and pt.plan_id = p_plan_id));
  if v_invalid > 0 then
    raise exception 'Some People, teams, positions or times do not belong to this plan' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_assignments) as r(team_id uuid)
     where not public.can_schedule_on_plan(p_plan_id, r.team_id)
  ) then raise exception 'You cannot schedule one of those teams on this plan' using errcode = '42501'; end if;

  with requested as (
    select r.*, p.person_id resolved_person_id, p.profile_id resolved_profile_id, row_number() over () ord
      from jsonb_to_recordset(p_assignments) as r(
        person_id uuid, user_id uuid, team_id uuid, position_id uuid, notes text,
        visibility text, attendance_mode text, time_ids uuid[]
      )
      left join lateral private.resolve_scheduling_person(p_plan_id, r.person_id, r.user_id) p on true
  ), resolved as (
    select r.*,
           coalesce(r.visibility, p_visibility, t.default_visibility, 'released') eff_visibility,
           coalesce(p_response_owner,
             case when t.default_response_owner_id is not null
                       and private.can_schedule_on_plan(t.default_response_owner_id, p_plan_id, r.team_id)
                  then t.default_response_owner_id end,
             (select auth.uid())) eff_owner
      from requested r join public.teams t on t.id = r.team_id
  ), inserted as (
    insert into public.assignments (
      plan_id, person_id, user_id, team_id, position_id, notes, status, created_by,
      visibility, response_owner_id, attendance_mode
    )
    select distinct on (r.resolved_person_id, r.team_id, r.position_id)
      p_plan_id, r.resolved_person_id, r.resolved_profile_id, r.team_id, r.position_id,
      nullif(btrim(r.notes), ''), 'unconfirmed', (select auth.uid()),
      r.eff_visibility, r.eff_owner, coalesce(r.attendance_mode, 'all')
      from resolved r order by r.resolved_person_id, r.team_id, r.position_id, r.ord
    on conflict do nothing returning id, person_id, team_id, position_id, visibility
  )
  select coalesce(array_agg(id), '{}'),
         coalesce(array_agg(id) filter (where visibility = 'released'), '{}')
    into v_ids, v_released from inserted;

  insert into public.assignment_attendance_times (assignment_id, plan_time_id)
  select a.id, tid
    from public.assignments a
    join lateral (
      select r.time_ids from jsonb_to_recordset(p_assignments) as r(
        person_id uuid, user_id uuid, team_id uuid, position_id uuid, notes text,
        visibility text, attendance_mode text, time_ids uuid[]
      ) left join lateral private.resolve_scheduling_person(p_plan_id, r.person_id, r.user_id) p on true
      where p.person_id = a.person_id and r.team_id = a.team_id
        and r.position_id is not distinct from a.position_id
        and coalesce(r.attendance_mode, 'all') = 'selected'
      limit 1
    ) scope on true
    cross join unnest(scope.time_ids) tid
   where a.id = any(v_ids)
  on conflict do nothing;

  if p_notify and cardinality(v_released) > 0 then
    perform private.enqueue_assignment_requests(
      p_plan_id, 'assignment_request', v_released,
      coalesce(p_effect_key, 'assignments-scheduled:' || gen_random_uuid()::text),
      (select auth.uid())
    );
  end if;
  return query select a.* from public.assignments a where a.id = any(v_ids);
end;
$$;
revoke execute on function public.schedule_plan_assignments(uuid, jsonb, boolean, text, text, uuid) from public, anon;
grant execute on function public.schedule_plan_assignments(uuid, jsonb, boolean, text, text, uuid) to authenticated;

create or replace function public.release_plan_assignments_versioned(
  p_plan_id uuid,
  p_assignment_ids uuid[],
  p_expected_revisions jsonb,
  p_notify boolean,
  p_effect_key text
)
returns setof public.assignments
language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('release:' || p_plan_id::text, 0));
  perform 1 from public.assignments a
   where a.id = any(p_assignment_ids) order by a.id for update;
  if jsonb_typeof(p_expected_revisions) <> 'array'
     or (select count(*) from jsonb_to_recordset(p_expected_revisions) r(assignment_id uuid, request_revision bigint))
        <> cardinality(p_assignment_ids)
     or exists (
       select 1 from jsonb_to_recordset(p_expected_revisions) r(assignment_id uuid, request_revision bigint)
       left join public.assignments a on a.id = r.assignment_id and a.plan_id = p_plan_id
       where a.id is null or not (a.id = any(p_assignment_ids))
          or a.request_revision <> r.request_revision or a.visibility <> 'prepared'
     ) then
    raise exception 'Prepared requests changed since the release review' using errcode = 'PT409';
  end if;
  return query select * from public.release_plan_assignments(
    p_plan_id, p_assignment_ids, p_notify, p_effect_key
  );
end;
$$;
revoke execute on function public.release_plan_assignments_versioned(uuid, uuid[], jsonb, boolean, text) from public, anon;
grant execute on function public.release_plan_assignments_versioned(uuid, uuid[], jsonb, boolean, text) to authenticated;

-- Existing single-assignment API remains compatible but resolves ownership by
-- Person and writes the same outbox/history rules.
create or replace function public.respond_to_own_assignment(
  p_assignment_id uuid,
  p_status public.assignment_status,
  p_expected_status public.assignment_status,
  p_reason text default null
)
returns setof public.assignments
language plpgsql security invoker set search_path = '' as $$
declare v_row public.assignments; v_history uuid;
begin
  if p_status = 'unconfirmed' then raise exception 'An answer is either confirmed or declined' using errcode = '22023'; end if;
  if p_reason is not null and p_status <> 'declined' then raise exception 'A reason can only accompany a decline' using errcode = '22023'; end if;
  if char_length(p_reason) > 500 then raise exception 'Keep the reason under 500 characters' using errcode = '22001'; end if;
  perform set_config('app.assignment_response_note', coalesce(p_reason, ''), true);
  update public.assignments a set status = p_status, responded_at = now()
   where a.id = p_assignment_id and a.status = p_expected_status
     and exists (select 1 from public.people p where p.id = a.person_id and p.profile_id = (select auth.uid()))
  returning * into v_row;
  perform set_config('app.assignment_response_note', '', true);
  if v_row.id is null then return; end if;
  select id into v_history from public.assignment_responses
   where assignment_id = v_row.id order by created_at desc, id desc limit 1;
  perform private.enqueue_scheduler_responses(
    array[v_row.id], v_row.user_id, p_status,
    case when p_expected_status = 'confirmed' and p_status = 'declined' then 'withdrawal' else 'response' end,
    'assignment-response:' || v_history::text
  );
  return next v_row;
end;
$$;
revoke execute on function public.respond_to_own_assignment(uuid, public.assignment_status, public.assignment_status, text) from public, anon;
grant execute on function public.respond_to_own_assignment(uuid, public.assignment_status, public.assignment_status, text) to authenticated;

-- A future direct insertion (including older server code) still receives an
-- exact snapshot. New delivery code supplies its already-created effect
-- snapshot explicitly.
create or replace function private.sync_assignment_notification_person()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_person public.people;
  v_ids uuid[];
begin
  if new.person_id is null and new.user_id is not null then
    select * into v_person from public.people
     where organization_id = new.organization_id and profile_id = new.user_id;
  else
    select * into v_person from public.people
     where id = new.person_id and organization_id = new.organization_id;
  end if;
  if v_person.id is null or (new.user_id is not null and v_person.profile_id is distinct from new.user_id) then
    raise exception 'Response link Person does not match the organization/Profile' using errcode = '22023';
  end if;
  new.person_id := v_person.id;
  new.user_id := v_person.profile_id;
  if new.snapshot_id is null then
    select coalesce(array_agg(a.id order by a.id), '{}') into v_ids
      from public.assignments a
     where a.plan_id = new.plan_id and a.person_id = new.person_id
       and a.visibility = 'released';
    if cardinality(v_ids) = 0 then
      raise exception 'A response link needs at least one released request' using errcode = '22023';
    end if;
    new.snapshot_id := private.create_assignment_request_snapshot(
      null, new.person_id, new.plan_id, v_ids, new.created_by
    );
  elsif not exists (
    select 1 from public.assignment_request_snapshots s
     where s.id = new.snapshot_id and s.person_id = new.person_id and s.plan_id = new.plan_id
  ) then
    raise exception 'Response link snapshot does not match its Person and plan' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke execute on function private.sync_assignment_notification_person() from public, anon, authenticated;

create or replace function private.supersede_replaced_snapshot()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.snapshot_id is distinct from old.snapshot_id then
    update public.assignment_request_snapshots set superseded_at = now()
     where id = old.snapshot_id and consumed_at is null and superseded_at is null;
  end if;
  return null;
end;
$$;
revoke execute on function private.supersede_replaced_snapshot() from public, anon, authenticated;
create trigger assignment_notifications_supersede_snapshot
  after update of snapshot_id on public.assignment_notifications
  for each row execute function private.supersede_replaced_snapshot();

drop function if exists public.respond_via_assignment_link(text, public.assignment_status);
create or replace function public.respond_via_assignment_link(
  p_token_hash text,
  p_status public.assignment_status
)
returns table (outcome text, assignments_updated int, effect_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_link public.assignment_notifications;
  v_snapshot public.assignment_request_snapshots;
  v_answers jsonb;
  v_apply record;
begin
  if p_status not in ('confirmed','declined') then
    raise exception 'An answer is either confirmed or declined' using errcode = '22023';
  end if;
  select * into v_link from public.assignment_notifications
   where token_hash = p_token_hash for update;
  if not found then return query select 'not_found'::text, 0, null::uuid; return; end if;
  if v_link.responded_at is not null then return query select 'used'::text, 0, null::uuid; return; end if;
  if v_link.expires_at <= now() then return query select 'expired'::text, 0, null::uuid; return; end if;
  select * into v_snapshot from public.assignment_request_snapshots where id = v_link.snapshot_id;
  if not found or v_snapshot.superseded_at is not null then
    return query select 'stale'::text, 0, null::uuid; return;
  end if;

  select jsonb_agg(jsonb_build_object(
    'assignment_id', i.assignment_id,
    'plan_time_id', times.time_id,
    'status', p_status::text,
    'reason', null
  ) order by i.assignment_id, times.time_id) into v_answers
    from public.assignment_request_snapshot_items i
    cross join lateral unnest(
      case when cardinality(i.plan_time_ids) = 0 then array[null::uuid] else i.plan_time_ids end
    ) times(time_id)
   where i.snapshot_id = v_snapshot.id;

  begin
    select * into v_apply from private.apply_assignment_snapshot_response(
      v_snapshot.id, v_snapshot.version, v_answers, null,
      'assignment-link-response:' || v_link.id::text
    );
  exception
    when sqlstate 'PT409' then
      return query select 'stale'::text, 0, null::uuid; return;
    when sqlstate 'PT410' then
      return query select 'expired'::text, 0, null::uuid; return;
  end;

  update public.assignment_notifications set responded_at = now() where id = v_link.id;
  return query select 'ok'::text, v_apply.assignments_updated,
    case when cardinality(v_apply.effect_ids) > 0 then v_apply.effect_ids[1] else null end;
end;
$$;
revoke execute on function public.respond_via_assignment_link(text, public.assignment_status) from public, anon, authenticated;
grant execute on function public.respond_via_assignment_link(text, public.assignment_status) to service_role;

-- Exact interval conflict resolver. It compares the union of applicable
-- service/rehearsal/other times with half-open ranges, so gaps and touching
-- boundaries remain available. Same-plan rows are excluded only when the
-- caller names the identical assignment, not globally.
create or replace function public.scheduling_conflicts_for_people(
  p_organization_id uuid,
  p_person_ids uuid[],
  p_plan_time_ids uuid[],
  p_exclude_assignment_ids uuid[] default '{}'
)
returns table (
  person_id uuid,
  conflict_type text,
  detail text,
  starts_at timestamptz,
  ends_at timestamptz,
  plan_id uuid,
  assignment_id uuid,
  plan_time_id uuid
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null
     and not public.has_capability_anywhere(p_organization_id, 'scheduling.manage') then
    raise exception 'Only a scheduler can check conflicts' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(p_person_ids) ids(id)
              where not exists (select 1 from public.people p where p.id = ids.id and p.organization_id = p_organization_id))
     or exists (select 1 from unnest(p_plan_time_ids) ids(id)
                where not exists (select 1 from public.plan_times pt join public.plans p on p.id = pt.plan_id
                                  where pt.id = ids.id and p.organization_id = p_organization_id)) then
    raise exception 'Conflict scope crosses organizations' using errcode = '22023';
  end if;

  return query
  with requested as (
    select p.id person_id, p.profile_id, pt.id plan_time_id, pt.starts_at, pt.ends_at
      from public.people p cross join public.plan_times pt
     where p.id = any(p_person_ids) and pt.id = any(p_plan_time_ids)
  ), existing as (
    select a.id assignment_id, a.person_id, a.plan_id, p.title,
           pt.id plan_time_id, pt.starts_at, pt.ends_at
      from public.assignments a
      join public.plans p on p.id = a.plan_id
      join public.plan_times pt on pt.plan_id = a.plan_id
       and (a.attendance_mode = 'all' or exists (
         select 1 from public.assignment_attendance_times aat
          where aat.assignment_id = a.id and aat.plan_time_id = pt.id
       ))
     where p.organization_id = p_organization_id
       and a.person_id = any(p_person_ids)
       and a.status <> 'declined'
       and not (a.id = any(coalesce(p_exclude_assignment_ids, '{}')))
       and (a.visibility = 'released' or (select auth.uid()) is null
            or private.can_schedule_on_plan((select auth.uid()), a.plan_id, a.team_id))
  )
  select r.person_id, 'blockout'::text, coalesce(b.reason, 'Unavailable'),
         greatest(r.starts_at, b.starts_at), least(r.ends_at, b.ends_at),
         null::uuid, null::uuid, r.plan_time_id
    from requested r join public.blockouts b
      on b.organization_id = p_organization_id and b.user_id = r.profile_id
     and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(r.starts_at, r.ends_at, '[)')
  union all
  select r.person_id, 'double_booked'::text, e.title,
         greatest(r.starts_at, e.starts_at), least(r.ends_at, e.ends_at),
         e.plan_id, e.assignment_id, e.plan_time_id
    from requested r join existing e on e.person_id = r.person_id
     and tstzrange(e.starts_at, e.ends_at, '[)') && tstzrange(r.starts_at, r.ends_at, '[)');
end;
$$;
revoke execute on function public.scheduling_conflicts_for_people(uuid, uuid[], uuid[], uuid[]) from public, anon;
grant execute on function public.scheduling_conflicts_for_people(uuid, uuid[], uuid[], uuid[]) to authenticated, service_role;

-- Signed-in preview: one immutable snapshot per selected Person/plan. All
-- selected rows must be released requests belonging to the caller.
create or replace function public.preview_assignment_responses(
  p_organization_id uuid,
  p_assignment_ids uuid[]
)
returns setof public.assignment_request_snapshots
language plpgsql security definer set search_path = '' as $$
declare
  v_profile uuid := (select auth.uid());
  v_person uuid;
  v_group record;
  v_snapshot uuid;
  v_count int;
begin
  if v_profile is null or p_assignment_ids is null or cardinality(p_assignment_ids) = 0 then
    raise exception 'Choose requests to review' using errcode = '22023';
  end if;
  select count(*) into v_count from unnest(p_assignment_ids) ids(id);
  if v_count <> (select count(*) from public.assignments a
                  join public.people p on p.id = a.person_id
                  join public.plans pl on pl.id = a.plan_id
                  where a.id = any(p_assignment_ids) and p.profile_id = v_profile
                    and pl.organization_id = p_organization_id
                    and a.visibility = 'released') then
    raise exception 'One or more requests are no longer available' using errcode = 'PT409';
  end if;

  for v_group in
    select a.person_id, a.plan_id, array_agg(a.id order by a.id) ids
      from public.assignments a
     where a.id = any(p_assignment_ids)
     group by a.person_id, a.plan_id
  loop
    v_snapshot := private.create_assignment_request_snapshot(
      null, v_group.person_id, v_group.plan_id, v_group.ids, v_profile
    );
    return query select * from public.assignment_request_snapshots where id = v_snapshot;
  end loop;
end;
$$;
revoke execute on function public.preview_assignment_responses(uuid, uuid[]) from public, anon;
grant execute on function public.preview_assignment_responses(uuid, uuid[]) to authenticated;

-- ==================================================== exact responses =====

create or replace function private.apply_assignment_snapshot_response(
  p_snapshot uuid,
  p_version bigint,
  p_answers jsonb,
  p_actor uuid,
  p_effect_prefix text
)
returns table (assignments_updated int, effect_ids uuid[])
language plpgsql security definer set search_path = '' as $$
declare
  v_snap public.assignment_request_snapshots;
  v_bad int;
  v_updated int := 0;
  v_effects uuid[] := '{}';
  v_status public.assignment_status;
  v_ids uuid[];
  v_effect uuid;
  v_row record;
  v_aggregate public.assignment_status;
begin
  select * into v_snap from public.assignment_request_snapshots where id = p_snapshot for update;
  if not found then raise exception 'Response snapshot not found' using errcode = 'P0002'; end if;
  if v_snap.version <> p_version or v_snap.superseded_at is not null then
    raise exception 'This request was replaced; refresh and review it again' using errcode = 'PT409';
  end if;
  if v_snap.consumed_at is not null then
    raise exception 'This request was already answered' using errcode = 'PT409';
  end if;
  if v_snap.expires_at <= now() then
    raise exception 'This request expired' using errcode = 'PT410';
  end if;
  if jsonb_typeof(p_answers) <> 'array' then
    raise exception 'Answers must be a list' using errcode = '22023';
  end if;

  -- Every exact assignment/time pair shown in review is present once, and no
  -- unreviewed pair was added. Untimed legacy assignments use NULL time_id.
  with scope as (
    select i.assignment_id, t.time_id
      from public.assignment_request_snapshot_items i
      cross join lateral unnest(
        case when cardinality(i.plan_time_ids) = 0 then array[null::uuid] else i.plan_time_ids end
      ) t(time_id)
     where i.snapshot_id = p_snapshot
  ), answers as (
    select r.assignment_id, r.plan_time_id, r.status, r.reason
      from jsonb_to_recordset(p_answers) as r(
        assignment_id uuid, plan_time_id uuid, status text, reason text
      )
  )
  select count(*) into v_bad
    from (
      select coalesce(s.assignment_id, a.assignment_id), coalesce(s.time_id, a.plan_time_id)
        from scope s full join answers a
          on a.assignment_id = s.assignment_id and a.plan_time_id is not distinct from s.time_id
       group by coalesce(s.assignment_id, a.assignment_id), coalesce(s.time_id, a.plan_time_id)
      having count(s.assignment_id) <> 1 or count(a.assignment_id) <> 1
    ) mismatch;
  if v_bad > 0 then
    raise exception 'Answers do not match the reviewed request scope' using errcode = 'PT409';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_answers) as r(
      assignment_id uuid, plan_time_id uuid, status text, reason text
    ) where r.status not in ('confirmed', 'declined')
       or (r.reason is not null and (r.status <> 'declined' or char_length(r.reason) > 500))
  ) then
    raise exception 'Invalid answer or decline reason' using errcode = '22023';
  end if;
  if exists (
    select 1
      from public.assignment_request_snapshot_items i
      join jsonb_to_recordset(p_answers) as r(
        assignment_id uuid, plan_time_id uuid, status text, reason text
      ) on r.assignment_id = i.assignment_id
     where i.snapshot_id = p_snapshot
       and i.expected_status = 'declined'
       and r.status <> 'declined'
  ) then
    raise exception 'A declined request cannot be confirmed without a new scheduler request'
      using errcode = 'PT409';
  end if;

  -- Lock in stable order and compare both assignment and attendance scope.
  perform 1 from public.assignments a
   where a.id in (select i.assignment_id from public.assignment_request_snapshot_items i where i.snapshot_id = p_snapshot)
   order by a.id for update;
  if exists (
    select 1 from public.assignment_request_snapshot_items i
    join public.assignments a on a.id = i.assignment_id
    where i.snapshot_id = p_snapshot
      and (a.person_id <> v_snap.person_id or a.plan_id <> v_snap.plan_id
           or a.visibility <> 'released'
           or a.request_revision <> i.expected_request_revision
           or a.status <> i.expected_status
           or private.assignment_time_ids(a.id) <> i.plan_time_ids)
  ) then
    raise exception 'This request changed; refresh and review it again' using errcode = 'PT409';
  end if;

  -- Detailed, append-only per-time history plus current state.
  insert into public.assignment_time_response_history (
    organization_id, assignment_id, plan_time_id, assignee_person_id,
    actor_id, previous_status, status, response_note
  )
  select v_snap.organization_id, r.assignment_id, r.plan_time_id, v_snap.person_id,
         p_actor, current.status, r.status::public.assignment_status, nullif(btrim(r.reason), '')
    from jsonb_to_recordset(p_answers) as r(
      assignment_id uuid, plan_time_id uuid, status text, reason text
    )
    left join public.assignment_time_responses current
      on current.assignment_id = r.assignment_id and current.plan_time_id = r.plan_time_id
   where r.plan_time_id is not null;

  insert into public.assignment_time_responses (
    assignment_id, plan_time_id, status, response_note, actor_id, responded_at
  )
  select r.assignment_id, r.plan_time_id, r.status::public.assignment_status,
         nullif(btrim(r.reason), ''), p_actor, now()
    from jsonb_to_recordset(p_answers) as r(
      assignment_id uuid, plan_time_id uuid, status text, reason text
    )
   where r.plan_time_id is not null
  on conflict (assignment_id, plan_time_id) do update
    set status = excluded.status,
        response_note = excluded.response_note,
        actor_id = excluded.actor_id,
        responded_at = excluded.responded_at;

  perform set_config('app.responding_snapshot', 'on', true);
  for v_row in
    select i.assignment_id, i.expected_status,
           coalesce(
             (select case when min(r.status::text) = max(r.status::text)
                          then min(r.status::text)::public.assignment_status
                          else 'unconfirmed'::public.assignment_status end
                from jsonb_to_recordset(p_answers) as r(
                  assignment_id uuid, plan_time_id uuid, status text, reason text
                ) where r.assignment_id = i.assignment_id),
             i.expected_status
           ) aggregate_status,
           (select nullif(btrim(r.reason), '')
              from jsonb_to_recordset(p_answers) as r(
                assignment_id uuid, plan_time_id uuid, status text, reason text
              ) where r.assignment_id = i.assignment_id and r.status = 'declined'
              limit 1) reason
      from public.assignment_request_snapshot_items i
     where i.snapshot_id = p_snapshot
  loop
    v_aggregate := v_row.aggregate_status;
    perform set_config('app.assignment_response_note', coalesce(v_row.reason, ''), true);
    update public.assignments
       set status = v_aggregate, responded_at = now()
     where id = v_row.assignment_id;
    v_updated := v_updated + 1;
  end loop;
  perform set_config('app.assignment_response_note', '', true);
  perform set_config('app.responding_snapshot', '', true);

  -- One scheduler effect per answer kind; a split answer can produce both,
  -- while each effect remains truthful to the existing outbox schema.
  for v_status in select distinct r.status::public.assignment_status
                    from jsonb_to_recordset(p_answers) as r(
                      assignment_id uuid, plan_time_id uuid, status text, reason text
                    )
  loop
    select array_agg(distinct r.assignment_id order by r.assignment_id) into v_ids
      from jsonb_to_recordset(p_answers) as r(
        assignment_id uuid, plan_time_id uuid, status text, reason text
      ) where r.status = v_status::text;
    v_effect := private.enqueue_scheduler_responses(
      v_ids,
      p_actor,
      v_status,
      case when v_status = 'declined' and exists (
             select 1 from public.assignment_request_snapshot_items i
              where i.snapshot_id = p_snapshot
                and i.assignment_id = any(v_ids)
                and i.expected_status = 'confirmed'
           ) then 'withdrawal' else 'response' end,
      p_effect_prefix || ':' || p_snapshot::text || ':' || v_status::text
    );
    if v_effect is not null then v_effects := array_append(v_effects, v_effect); end if;
  end loop;

  update public.assignment_request_snapshots set consumed_at = now() where id = p_snapshot;
  return query select v_updated, v_effects;
end;
$$;
revoke execute on function private.apply_assignment_snapshot_response(uuid, bigint, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function private.apply_assignment_snapshot_response(uuid, bigint, jsonb, uuid, text) to service_role;

-- Authenticated batch commit. All snapshots commit in this single function or
-- the transaction rolls back. The idempotency record is written last; a retry
-- with the same body returns the original result, while key reuse is refused.
create or replace function public.respond_to_assignment_snapshots(
  p_organization_id uuid,
  p_responses jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_profile uuid := (select auth.uid());
  v_person uuid;
  v_org uuid;
  v_hash text := encode(extensions.digest(p_responses::text, 'sha256'), 'hex');
  v_existing public.assignment_response_operations;
  v_item record;
  v_result jsonb := jsonb_build_object('snapshots', '[]'::jsonb, 'effect_ids', '[]'::jsonb);
  v_apply record;
begin
  if v_profile is null or char_length(p_idempotency_key) not between 8 and 200
     or jsonb_typeof(p_responses) <> 'array' or jsonb_array_length(p_responses) = 0 then
    raise exception 'A reviewed response and idempotency key are required' using errcode = '22023';
  end if;
  select p.id, p.organization_id into v_person, v_org
    from public.people p
    join public.assignment_request_snapshots s on s.person_id = p.id
   where p.profile_id = v_profile
     and p.organization_id = p_organization_id
     and s.organization_id = p_organization_id
     and s.id = ((p_responses->0)->>'snapshot_id')::uuid;
  if v_person is null then raise exception 'Response snapshot not found' using errcode = 'P0002'; end if;

  select * into v_existing from public.assignment_response_operations
   where organization_id = v_org and person_id = v_person and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then
      raise exception 'That idempotency key was used for another response' using errcode = 'PT409';
    end if;
    return v_existing.result;
  end if;

  -- Every selected snapshot must belong to the same signed-in Person. Locking
  -- happens inside apply in stable assignment order.
  if exists (
    select 1 from jsonb_array_elements(p_responses) r
    left join public.assignment_request_snapshots s on s.id = (r->>'snapshot_id')::uuid
    left join public.people p on p.id = s.person_id
    where s.id is null
       or s.organization_id is distinct from p_organization_id
       or s.person_id is distinct from v_person
       or p.profile_id is distinct from v_profile
  ) then
    raise exception 'Response snapshot not found' using errcode = 'P0002';
  end if;

  for v_item in
    select r->>'snapshot_id' snapshot_id,
           (r->>'version')::bigint version,
           r->'answers' answers
      from jsonb_array_elements(p_responses) r
     order by r->>'snapshot_id'
  loop
    select * into v_apply from private.apply_assignment_snapshot_response(
      v_item.snapshot_id::uuid, v_item.version, v_item.answers, v_profile,
      'assignment-batch-response:' || p_idempotency_key
    );
    v_result := jsonb_set(v_result, '{snapshots}',
      (v_result->'snapshots') || jsonb_build_array(jsonb_build_object(
        'snapshot_id', v_item.snapshot_id,
        'assignments_updated', v_apply.assignments_updated
      )));
    v_result := jsonb_set(v_result, '{effect_ids}',
      (v_result->'effect_ids') || to_jsonb(v_apply.effect_ids));
  end loop;

  insert into public.assignment_response_operations (
    organization_id, person_id, idempotency_key, request_hash, result
  ) values (v_org, v_person, p_idempotency_key, v_hash, v_result);
  return v_result;
end;
$$;
revoke execute on function public.respond_to_assignment_snapshots(uuid, jsonb, text) from public, anon;
grant execute on function public.respond_to_assignment_snapshots(uuid, jsonb, text) to authenticated;

-- ======================================================== RLS / grants ====

alter table public.assignment_attendance_times enable row level security;
alter table public.assignment_time_responses enable row level security;
alter table public.assignment_time_response_history enable row level security;
alter table public.assignment_request_snapshots enable row level security;
alter table public.assignment_request_snapshot_items enable row level security;
alter table public.assignment_response_operations enable row level security;

create policy assignment_attendance_times_select on public.assignment_attendance_times
  for select to authenticated using (
    exists (select 1 from public.assignments a where a.id = assignment_id)
  );
create policy assignment_attendance_times_write on public.assignment_attendance_times
  for all to authenticated
  using ((select public.can_schedule_assignment(assignment_id)))
  with check ((select public.can_schedule_assignment(assignment_id)));

create policy assignment_time_responses_select on public.assignment_time_responses
  for select to authenticated using (
    exists (select 1 from public.assignments a where a.id = assignment_id)
  );
revoke insert, update, delete, truncate on public.assignment_time_responses from anon, authenticated;

create policy assignment_time_response_history_select on public.assignment_time_response_history
  for select to authenticated using (
    exists (select 1 from public.people p where p.id = assignee_person_id and p.profile_id = (select auth.uid()))
    or (select public.can_schedule_assignment(assignment_id))
  );
revoke insert, update, delete, truncate on public.assignment_time_response_history from anon, authenticated;

create or replace function private.can_read_assignment_snapshot(p_snapshot uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.assignment_request_snapshots s
    join public.people p on p.id = s.person_id
    where s.id = p_snapshot and p.profile_id = p_user
  ) or exists (
    select 1 from public.assignment_request_snapshot_items i
    where i.snapshot_id = p_snapshot and private.can_schedule_assignment(p_user, i.assignment_id)
  );
$$;
revoke execute on function private.can_read_assignment_snapshot(uuid, uuid) from public, anon;
grant execute on function private.can_read_assignment_snapshot(uuid, uuid) to authenticated, service_role;

create policy assignment_request_snapshots_select on public.assignment_request_snapshots
  for select to authenticated using (
    (select private.can_read_assignment_snapshot(id, (select auth.uid())))
  );
create policy assignment_request_snapshot_items_select on public.assignment_request_snapshot_items
  for select to authenticated using (
    (select private.can_read_assignment_snapshot(snapshot_id, (select auth.uid())))
  );
create policy assignment_response_operations_select on public.assignment_response_operations
  for select to authenticated using (
    exists (select 1 from public.people p where p.id = person_id and p.profile_id = (select auth.uid()))
  );
revoke insert, update, delete, truncate on public.assignment_request_snapshots from anon, authenticated;
revoke insert, update, delete, truncate on public.assignment_request_snapshot_items from anon, authenticated;
revoke insert, update, delete, truncate on public.assignment_response_operations from anon, authenticated;

-- Canonical Person ownership in assignment visibility and response history.
drop policy if exists assignments_select on public.assignments;
create policy assignments_select on public.assignments
  for select to authenticated using (
    (visibility = 'released' and (
      exists (select 1 from public.people p where p.id = person_id and p.profile_id = (select auth.uid()))
      or (select public.can_see_released_assignment(plan_id, team_id, user_id))
    ))
    or (select public.can_schedule_on_plan(plan_id, team_id))
  );

drop policy if exists assignments_update on public.assignments;
create policy assignments_update on public.assignments
  for update to authenticated
  using (
    (select public.can_schedule_on_plan(plan_id, team_id))
    or (exists (select 1 from public.people p where p.id = person_id and p.profile_id = (select auth.uid()))
        and visibility = 'released')
  )
  with check (
    (select public.can_schedule_on_plan(plan_id, team_id))
    or (exists (select 1 from public.people p where p.id = person_id and p.profile_id = (select auth.uid()))
        and visibility = 'released')
  );

drop policy if exists assignment_responses_select on public.assignment_responses;
create policy assignment_responses_select on public.assignment_responses
  for select to authenticated using (
    exists (select 1 from public.people p where p.id = assignee_person_id and p.profile_id = (select auth.uid()))
    or (select public.can_schedule_assignment(assignment_id))
  );

-- History records canonical Person while retaining the Profile compatibility
-- column when one exists.
create or replace function public.record_assignment_response()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.assignment_responses (
    organization_id, assignment_id, assignee_id, assignee_person_id, actor_id,
    previous_status, status, response_note
  ) values (
    public.org_of_plan(new.plan_id), new.id, new.user_id, new.person_id, (select auth.uid()),
    old.status, new.status,
    nullif(current_setting('app.assignment_response_note', true), '')
  );
  return null;
end;
$$;
revoke execute on function public.record_assignment_response() from public, anon, authenticated;

-- Permit the snapshot transaction to persist an aggregate mixed state as
-- `unconfirmed`; direct clients still cannot reset an answer.
create or replace function public.guard_assignment_self_response()
returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user not in ('authenticated', 'anon', 'service_role') then return new; end if;
  if new.visibility = 'prepared' and old.visibility = 'released' then
    raise exception 'A released request cannot be made private again; remove it instead' using errcode = 'PT409';
  end if;
  if new.visibility = 'released' and old.visibility = 'prepared'
     and coalesce(current_setting('app.releasing_assignments', true), '') <> 'on' then
    raise exception 'Release requests with release_plan_assignments()' using errcode = '42501';
  end if;
  if (select auth.uid()) is not null and public.can_schedule_on_plan(old.plan_id, old.team_id) then return new; end if;

  if new.plan_id is distinct from old.plan_id
     or new.person_id is distinct from old.person_id
     or new.user_id is distinct from old.user_id
     or new.team_id is distinct from old.team_id
     or new.position_id is distinct from old.position_id
     or new.notes is distinct from old.notes
     or new.notified_at is distinct from old.notified_at
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.visibility is distinct from old.visibility
     or new.released_at is distinct from old.released_at
     or new.released_by is distinct from old.released_by
     or new.response_owner_id is distinct from old.response_owner_id
     or new.attendance_mode is distinct from old.attendance_mode
     or new.request_revision is distinct from old.request_revision then
    raise exception 'Only a scheduler can change this assignment' using errcode = '42501';
  end if;
  if new.status is distinct from old.status
     and coalesce(current_setting('app.responding_snapshot', true), '') <> 'on'
     and (old.status = 'declined' or new.status = 'unconfirmed') then
    raise exception 'A % assignment cannot be changed to %; ask a scheduler to request you again',
      old.status, new.status using errcode = 'PT409';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_assignment_self_response() from public, anon, authenticated;

comment on table public.assignment_request_snapshots is
  'Immutable exact Person/plan request scopes used by public and authenticated responses.';
comment on column public.assignments.person_id is
  'Canonical roster identity. user_id remains a nullable compatibility reference to the linked Profile.';
