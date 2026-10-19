-- F16 Pass A — actual attendance, separate from confirmation.
--
-- * One record per Person per plan-time occurrence (service or rehearsal):
--   present / absent / unknown. A Person on two positions at the same time is
--   still one record, so counts never double. A request's answer
--   (confirmed/declined) is never read or written here: confirmation is
--   planned participation, a record is what actually happened.
-- * Who is markable: a Person with a *released*, not-declined request whose
--   F04 attendance covers that time (the shared `private.assignment_attendance`
--   resolver). Prepared requests are nobody's schedule yet.
-- * Who may mark: `scheduling.manage` for one of the teams the Person is
--   scheduled on for that time (F01 `private.can_schedule_on_plan`). Each mark
--   names the team it is recorded through; a team the caller does not
--   schedule, or a team the Person is not on at that time, is refused — a
--   forged team id gains nothing.
-- * Writes only through `record_attendance`: one short transaction locks the
--   plan time (serializing competing leaders for that occurrence), checks
--   every mark's authority and expected revision (0 = "no record yet"), then
--   applies all or nothing. A durable per-caller idempotency key returns the
--   stored result for a replay and refuses a different payload.
-- * History: every change appends an `attendance_events` row (previous and
--   new status, team, actor, reason, batch). Events are append-only. Records
--   keep the time's name/kind/start/end as of the last write, so history
--   survives a deleted time (plan_time_id → null) and an archived Person.
-- * Read: the Person themselves, the plan's leaders (plans.edit or
--   scheduling.manage at its service type), and schedulers of a team the
--   Person served on in that plan.

create unique index if not exists people_id_org_key on public.people (id, organization_id);

-- ============================================================= tables =====

create table public.attendance_records (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  plan_id          uuid not null,
  plan_time_id     uuid,
  person_id        uuid not null,
  status           text not null,
  time_kind        text not null,
  time_name        text,
  time_starts_at   timestamptz not null,
  time_ends_at     timestamptz not null,
  revision         bigint not null default 1,
  marked_team_id   uuid references public.teams (id) on delete set null,
  marked_by        uuid references public.profiles (id) on delete set null,
  marked_by_name   text,
  marked_at        timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  constraint attendance_records_plan_fk foreign key (plan_id, organization_id)
    references public.plans (id, organization_id) on delete cascade,
  constraint attendance_records_time_fk foreign key (plan_time_id, plan_id)
    references public.plan_times (id, plan_id) on delete set null (plan_time_id),
  constraint attendance_records_person_fk foreign key (person_id, organization_id)
    references public.people (id, organization_id) on delete cascade,
  constraint attendance_records_status check (status in ('present', 'absent', 'unknown')),
  constraint attendance_records_kind check (time_kind in ('service', 'rehearsal', 'other')),
  constraint attendance_records_revision check (revision >= 1)
);

create unique index attendance_records_one_per_occurrence
  on public.attendance_records (plan_time_id, person_id) where plan_time_id is not null;
create index attendance_records_org_time_idx on public.attendance_records (organization_id, time_starts_at);
create index attendance_records_plan_idx on public.attendance_records (plan_id);
create index attendance_records_person_idx on public.attendance_records (person_id);
create index attendance_records_team_idx on public.attendance_records (marked_team_id);
create index attendance_records_marked_by_idx on public.attendance_records (marked_by);

comment on table public.attendance_records is
  'F16: actual present/absent/unknown per Person per plan time. Never derived from, and never changes, a request''s answer.';

create table public.attendance_batches (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  plan_id          uuid not null,
  plan_time_id     uuid,
  actor_user_id    uuid not null references public.profiles (id) on delete cascade,
  idempotency_key  text not null,
  request_hash     text not null,
  result           jsonb not null,
  created_at       timestamptz not null default now(),
  constraint attendance_batches_plan_fk foreign key (plan_id, organization_id)
    references public.plans (id, organization_id) on delete cascade,
  constraint attendance_batches_key_length check (char_length(idempotency_key) between 1 and 200)
);

create unique index attendance_batches_key on public.attendance_batches (organization_id, actor_user_id, idempotency_key);
create index attendance_batches_plan_idx on public.attendance_batches (plan_id);
create index attendance_batches_actor_idx on public.attendance_batches (actor_user_id);

create table public.attendance_events (
  id               bigint generated always as identity primary key,
  record_id        uuid not null references public.attendance_records (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  batch_id         uuid references public.attendance_batches (id) on delete set null,
  revision         bigint not null,
  previous_status  text,
  status           text not null,
  team_id          uuid references public.teams (id) on delete set null,
  reason           text,
  actor_user_id    uuid references public.profiles (id) on delete set null,
  actor_name       text,
  occurred_at      timestamptz not null default now(),
  constraint attendance_events_status check (status in ('present', 'absent', 'unknown')),
  constraint attendance_events_previous check (previous_status is null or previous_status in ('present', 'absent', 'unknown')),
  constraint attendance_events_reason_length check (reason is null or char_length(reason) <= 500)
);

create unique index attendance_events_revision on public.attendance_events (record_id, revision);
create index attendance_events_org_idx on public.attendance_events (organization_id);
create index attendance_events_batch_idx on public.attendance_events (batch_id);
create index attendance_events_team_idx on public.attendance_events (team_id);
create index attendance_events_actor_idx on public.attendance_events (actor_user_id);

comment on table public.attendance_events is
  'F16: append-only history of attendance records (every mark and correction, with actor and reason).';

create or replace function private.refuse_attendance_history_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Attendance history is append-only' using errcode = 'PT409';
end;
$$;
revoke execute on function private.refuse_attendance_history_update() from public, anon, authenticated;

create trigger attendance_events_append_only
  before update on public.attendance_events
  for each row execute function private.refuse_attendance_history_update();

-- ============================================================ helpers =====

-- Teams through which the Person is scheduled (released, not declined) at
-- that exact plan time, per the F04 resolver.
create or replace function private.attendance_teams(p_plan_time uuid, p_person uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct v.team_id
    from private.assignment_attendance v
   where v.plan_time_id = p_plan_time
     and v.person_id = p_person
     and v.visibility = 'released'
     and v.status <> 'declined';
$$;

create or replace function private.can_read_attendance(p_user uuid, p_plan uuid, p_person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and (
    exists (select 1 from public.people pe where pe.id = p_person and pe.profile_id = p_user)
    or private.is_plan_leader(p_user, p_plan)
    or exists (
      select 1 from public.assignments a
       where a.plan_id = p_plan and a.person_id = p_person and a.visibility = 'released'
         and private.can_schedule_on_plan(p_user, p_plan, a.team_id))
  );
$$;

revoke execute on function private.attendance_teams(uuid, uuid) from public, anon;
revoke execute on function private.can_read_attendance(uuid, uuid, uuid) from public, anon;
grant execute on function private.attendance_teams(uuid, uuid) to authenticated, service_role;
grant execute on function private.can_read_attendance(uuid, uuid, uuid) to authenticated, service_role;

-- ================================================================ RLS =====

alter table public.attendance_records enable row level security;
alter table public.attendance_events enable row level security;
alter table public.attendance_batches enable row level security;

create policy attendance_records_select on public.attendance_records
  for select to authenticated
  using ((select private.can_read_attendance((select auth.uid()), plan_id, person_id)));

create policy attendance_events_select on public.attendance_events
  for select to authenticated
  using (exists (
    select 1 from public.attendance_records r
     where r.id = attendance_events.record_id
       and private.can_read_attendance((select auth.uid()), r.plan_id, r.person_id)));

create policy attendance_batches_select on public.attendance_batches
  for select to authenticated using (actor_user_id = (select auth.uid()));

revoke all on public.attendance_records, public.attendance_events, public.attendance_batches from anon;
revoke insert, update, delete, truncate on public.attendance_records, public.attendance_events, public.attendance_batches
  from authenticated;
grant select on public.attendance_records, public.attendance_events, public.attendance_batches to authenticated;
grant all on public.attendance_records, public.attendance_events, public.attendance_batches to service_role;

-- ======================================================= record (batch) ===

-- p_marks: [{ "person_id", "team_id", "status", "expected_revision" }]
-- expected_revision 0 means "I saw no record". Returns
-- { batch_id, replayed, applied, unchanged, records: [{ person_id, record_id, status, revision }] }.
create or replace function public.record_attendance(
  p_plan_time_id    uuid,
  p_marks           jsonb,
  p_reason          text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := (select auth.uid());
  v_time     record;
  v_key      text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_hash     text;
  v_prior    public.attendance_batches%rowtype;
  v_batch    uuid := gen_random_uuid();
  v_name     text;
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
  v_mark     jsonb;
  v_person   uuid;
  v_team     uuid;
  v_status   text;
  v_previous text;
  v_expected bigint;
  v_record   public.attendance_records%rowtype;
  v_results  jsonb := '[]'::jsonb;
  v_applied  int := 0;
  v_same     int := 0;
  v_result   jsonb;
begin
  if v_user is null then
    raise exception 'Sign in to record attendance' using errcode = '42501';
  end if;
  if v_key is null then
    raise exception 'An idempotency key is required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_marks) is distinct from 'array' or jsonb_array_length(p_marks) not between 1 and 500 then
    raise exception 'Send between 1 and 500 marks' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'Keep the reason under 500 characters' using errcode = '22023';
  end if;

  -- Serialize every batch for this occurrence (short transaction).
  select pt.id, pt.plan_id, pt.kind::text as kind, pt.name, pt.starts_at, pt.ends_at, p.organization_id
    into v_time
    from public.plan_times pt
    join public.plans p on p.id = pt.plan_id
   where pt.id = p_plan_time_id
     and public.is_org_member(p.organization_id)
   for update of pt;
  if not found then
    raise exception 'Plan time not found' using errcode = 'P0002';
  end if;

  v_hash := md5(p_plan_time_id::text || '|' || p_marks::text || '|' || coalesce(v_reason, ''));
  select * into v_prior from public.attendance_batches
   where organization_id = v_time.organization_id and actor_user_id = v_user and idempotency_key = v_key;
  if found then
    if v_prior.request_hash <> v_hash then
      raise exception 'That idempotency key was used for different marks'
        using errcode = 'PT409', hint = 'idempotency_key_reused';
    end if;
    return v_prior.result || jsonb_build_object('replayed', true);
  end if;

  if (select count(distinct m ->> 'person_id') from jsonb_array_elements(p_marks) m) <> jsonb_array_length(p_marks) then
    raise exception 'Mark each person once per batch' using errcode = '22023';
  end if;

  select coalesce(nullif(btrim(pr.full_name), ''), pr.email) into v_name from public.profiles pr where pr.id = v_user;

  insert into public.attendance_batches (id, organization_id, plan_id, plan_time_id, actor_user_id, idempotency_key, request_hash, result)
  values (v_batch, v_time.organization_id, v_time.plan_id, v_time.id, v_user, v_key, v_hash, '{}'::jsonb);

  for v_mark in select * from jsonb_array_elements(p_marks) loop
    begin
      v_person := (v_mark ->> 'person_id')::uuid;
      v_team := (v_mark ->> 'team_id')::uuid;
      v_expected := coalesce((v_mark ->> 'expected_revision')::bigint, -1);
    exception when others then
      raise exception 'Each mark needs a person, a team and an expected revision' using errcode = '22023';
    end;
    v_status := v_mark ->> 'status';
    if v_person is null or v_team is null or v_expected < 0 or v_status is null
       or v_status not in ('present', 'absent', 'unknown') then
      raise exception 'Each mark needs a person, a team, a status and an expected revision' using errcode = '22023';
    end if;

    -- The Person must be scheduled on that team at this time, and the caller
    -- must schedule that team on this plan. Same message either way.
    if not exists (select 1 from private.attendance_teams(v_time.id, v_person) t where t = v_team)
       or not private.can_schedule_on_plan(v_user, v_time.plan_id, v_team) then
      raise exception 'You cannot record attendance for one of these people' using errcode = '42501';
    end if;

    select * into v_record from public.attendance_records
     where plan_time_id = v_time.id and person_id = v_person
     for update;

    if not found then
      if v_expected <> 0 then
        raise exception 'Attendance changed since you loaded it'
          using errcode = 'PT409', hint = 'attendance_changed';
      end if;
      insert into public.attendance_records (
        organization_id, plan_id, plan_time_id, person_id, status,
        time_kind, time_name, time_starts_at, time_ends_at,
        marked_team_id, marked_by, marked_by_name)
      values (
        v_time.organization_id, v_time.plan_id, v_time.id, v_person, v_status,
        v_time.kind, v_time.name, v_time.starts_at, v_time.ends_at,
        v_team, v_user, v_name)
      returning * into v_record;
      insert into public.attendance_events (record_id, organization_id, batch_id, revision, previous_status, status, team_id, reason, actor_user_id, actor_name)
      values (v_record.id, v_time.organization_id, v_batch, v_record.revision, null, v_status, v_team, v_reason, v_user, v_name);
      v_applied := v_applied + 1;
    else
      if v_record.revision <> v_expected then
        raise exception 'Attendance changed since you loaded it'
          using errcode = 'PT409', hint = 'attendance_changed';
      end if;
      v_previous := v_record.status;
      if v_record.status = v_status then
        v_same := v_same + 1;
      else
        update public.attendance_records
           set status = v_status,
               revision = revision + 1,
               marked_team_id = v_team,
               marked_by = v_user,
               marked_by_name = v_name,
               marked_at = now(),
               time_kind = v_time.kind,
               time_name = v_time.name,
               time_starts_at = v_time.starts_at,
               time_ends_at = v_time.ends_at
         where id = v_record.id
         returning * into v_record;
        insert into public.attendance_events (record_id, organization_id, batch_id, revision, previous_status, status, team_id, reason, actor_user_id, actor_name)
        values (v_record.id, v_time.organization_id, v_batch, v_record.revision, v_previous,
                v_status, v_team, v_reason, v_user, v_name);
        v_applied := v_applied + 1;
      end if;
    end if;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'person_id', v_person, 'record_id', v_record.id, 'status', v_record.status, 'revision', v_record.revision));
  end loop;

  v_result := jsonb_build_object(
    'batch_id', v_batch, 'replayed', false, 'applied', v_applied, 'unchanged', v_same, 'records', v_results);
  update public.attendance_batches set result = v_result where id = v_batch;
  return v_result;
end;
$$;

revoke execute on function public.record_attendance(uuid, jsonb, text, text) from public, anon;
grant execute on function public.record_attendance(uuid, jsonb, text, text) to authenticated, service_role;
