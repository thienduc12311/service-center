-- MOB-006: Person-scoped timezone intent, bounded recurring blockouts, stale-safe maintenance.

create table public.blockout_series (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  timezone text not null,
  all_day boolean not null,
  local_start_date date not null,
  local_start_time time,
  local_end_date date not null,
  local_end_time time,
  reason text,
  frequency text not null check (frequency in ('weekly', 'monthly')),
  interval_count smallint not null check (interval_count between 1 and 12),
  end_type text not null check (end_type in ('count', 'until')),
  until_date date,
  occurrence_count smallint,
  monthly_missing_date text not null default 'skip' check (monthly_missing_date = 'skip'),
  ambiguous_time_policy text not null check (ambiguous_time_policy in ('earlier', 'later')),
  revision bigint not null default 0,
  idempotency_key uuid not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blockout_series_reason_length check (reason is null or char_length(reason) <= 200),
  constraint blockout_series_time_shape check (
    (all_day and local_start_time is null and local_end_time is null)
    or (not all_day and local_start_time is not null and local_end_time is not null)
  ),
  constraint blockout_series_end_shape check (
    (end_type = 'count' and occurrence_count between 1 and 120 and until_date is null)
    or (end_type = 'until' and until_date is not null and occurrence_count is null)
  ),
  constraint blockout_series_local_order check (local_end_date >= local_start_date),
  constraint blockout_series_idempotency unique (organization_id, created_by, idempotency_key)
);
create index blockout_series_person_idx on public.blockout_series(person_id, local_start_date);
create index blockout_series_org_idx on public.blockout_series(organization_id);

alter table public.blockouts
  add column person_id uuid references public.people(id) on delete cascade,
  add column timezone text,
  add column all_day boolean not null default false,
  add column local_start_date date,
  add column local_start_time time,
  add column local_end_date date,
  add column local_end_time time,
  add column series_id uuid references public.blockout_series(id) on delete cascade,
  add column occurrence_key text,
  add column revision bigint not null default 0,
  add column created_by uuid references public.profiles(id) on delete set null,
  add column updated_by uuid references public.profiles(id) on delete set null,
  add column idempotency_key uuid,
  add column updated_at timestamptz not null default now();

update public.blockouts b
set person_id = p.id, created_by = b.user_id
from public.people p
where p.organization_id = b.organization_id and p.profile_id = b.user_id;

do $$ begin
  if exists (select 1 from public.blockouts where person_id is null) then
    raise exception 'MOB-006 requires every existing blockout Profile to have a Person';
  end if;
end $$;

alter table public.blockouts alter column person_id set not null;
alter table public.blockouts alter column user_id drop not null;
alter table public.blockouts drop constraint blockouts_user_id_fkey;
alter table public.blockouts add constraint blockouts_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete set null;
alter table public.blockouts add constraint blockouts_reason_length
  check (reason is null or char_length(reason) <= 200);
alter table public.blockouts add constraint blockouts_intent_shape check (
  timezone is null
  or (local_start_date is not null and local_end_date is not null
      and ((all_day and local_start_time is null and local_end_time is null)
           or (not all_day and local_start_time is not null and local_end_time is not null)))
);
create index blockouts_person_range_idx on public.blockouts(person_id, starts_at, ends_at);
create index blockouts_series_idx on public.blockouts(series_id, starts_at);
create unique index blockouts_series_occurrence_idx on public.blockouts(series_id, occurrence_key)
  where series_id is not null;
create unique index blockouts_idempotency_idx on public.blockouts(organization_id, created_by, idempotency_key)
  where idempotency_key is not null and series_id is null;

create table public.blockout_series_exceptions (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.blockout_series(id) on delete cascade,
  occurrence_key text not null,
  kind text not null check (kind in ('updated', 'deleted', 'future_split')),
  replacement_blockout_id uuid references public.blockouts(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint blockout_series_exception_unique unique(series_id, occurrence_key, kind)
);
create index blockout_series_exceptions_replacement_idx
  on public.blockout_series_exceptions(replacement_blockout_id);

create table public.blockout_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  idempotency_key uuid not null,
  request_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  constraint blockout_operations_key unique(actor_id, idempotency_key)
);
create index blockout_operations_actor_idx on public.blockout_operations(actor_id);

create or replace function private.can_manage_blockout(p_org uuid, p_person uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_org_member(p_org) and (
    exists (select 1 from public.people p where p.id = p_person and p.organization_id = p_org
             and p.profile_id = (select auth.uid()))
    or public.has_capability_anywhere(p_org, 'scheduling.manage')
  );
$$;
revoke execute on function private.can_manage_blockout(uuid, uuid) from public, anon;
grant execute on function private.can_manage_blockout(uuid, uuid) to authenticated, service_role;

create or replace function private.prepare_blockout()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_profile uuid;
begin
  select profile_id into v_profile from public.people
   where id = new.person_id and organization_id = new.organization_id;
  if not found then raise exception 'Person does not belong to this organization' using errcode = '22023'; end if;
  new.user_id := v_profile;
  if new.timezone is not null and not exists (
    select 1 from pg_catalog.pg_timezone_names where name = new.timezone
  ) then raise exception 'Unknown timezone' using errcode = '22023'; end if;
  if new.timezone is not null and (new.local_start_date is null or new.local_end_date is null) then
    raise exception 'Local date intent is required' using errcode = '22023';
  end if;
  if new.timezone is not null and (
       (new.starts_at at time zone new.timezone) <> new.local_start_date + coalesce(new.local_start_time, time '00:00')
       or (new.ends_at at time zone new.timezone) <> new.local_end_date + coalesce(new.local_end_time, time '00:00')
     ) then
    raise exception 'Absolute interval does not match its local timezone intent' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, (select auth.uid()));
  else
    new.organization_id := old.organization_id;
    new.person_id := old.person_id;
    new.series_id := old.series_id;
    new.occurrence_key := old.occurrence_key;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.idempotency_key := old.idempotency_key;
    new.revision := old.revision + 1;
    new.updated_by := (select auth.uid());
    new.updated_at := now();
  end if;
  return new;
end $$;
revoke execute on function private.prepare_blockout() from public, anon, authenticated;
create trigger blockouts_prepare before insert or update on public.blockouts
  for each row execute function private.prepare_blockout();

create or replace function private.prepare_blockout_series()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.people p where p.id = new.person_id and p.organization_id = new.organization_id) then
    raise exception 'Person does not belong to this organization' using errcode = '22023';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown timezone' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then
    new.organization_id := old.organization_id;
    new.person_id := old.person_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.idempotency_key := old.idempotency_key;
    new.revision := old.revision + 1;
    new.updated_at := now();
  end if;
  return new;
end $$;
revoke execute on function private.prepare_blockout_series() from public, anon, authenticated;
create trigger blockout_series_prepare before insert or update on public.blockout_series
  for each row execute function private.prepare_blockout_series();

drop policy if exists blockouts_select on public.blockouts;
drop policy if exists blockouts_write on public.blockouts;
create policy blockouts_select on public.blockouts for select to authenticated using (
  private.can_manage_blockout(organization_id, person_id)
);
create policy blockouts_insert on public.blockouts for insert to authenticated with check (
  private.can_manage_blockout(organization_id, person_id)
);
create policy blockouts_update on public.blockouts for update to authenticated using (
  private.can_manage_blockout(organization_id, person_id)
) with check (private.can_manage_blockout(organization_id, person_id));
create policy blockouts_delete on public.blockouts for delete to authenticated using (
  private.can_manage_blockout(organization_id, person_id)
);

alter table public.blockout_series enable row level security;
alter table public.blockout_series_exceptions enable row level security;
alter table public.blockout_operations enable row level security;
create policy blockout_series_select on public.blockout_series for select to authenticated using (
  private.can_manage_blockout(organization_id, person_id)
);
create policy blockout_series_insert on public.blockout_series for insert to authenticated with check (
  private.can_manage_blockout(organization_id, person_id)
);
create policy blockout_series_update on public.blockout_series for update to authenticated using (
  private.can_manage_blockout(organization_id, person_id)
) with check (private.can_manage_blockout(organization_id, person_id));
create policy blockout_series_delete on public.blockout_series for delete to authenticated using (
  private.can_manage_blockout(organization_id, person_id)
);
create policy blockout_series_exceptions_select on public.blockout_series_exceptions for select to authenticated using (
  exists (select 1 from public.blockout_series s where s.id = series_id)
);
create policy blockout_operations_own on public.blockout_operations for select to authenticated using (
  actor_id = (select auth.uid())
);
revoke all on public.blockout_series_exceptions, public.blockout_operations from anon, authenticated;
grant select on public.blockout_series_exceptions, public.blockout_operations to authenticated;
grant select on public.blockout_series to authenticated;
grant all on public.blockout_series, public.blockout_series_exceptions, public.blockout_operations to service_role;

-- Atomic and idempotent series creation. Occurrences are already resolved by
-- the shared wall-time resolver used for preview and client validation.
create or replace function public.create_blockout_series(
  p_organization_id uuid, p_person_id uuid, p_series jsonb, p_occurrences jsonb, p_idempotency_key uuid
)
returns public.blockout_series language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_series public.blockout_series; v_count int;
begin
  if v_actor is null or not private.can_manage_blockout(p_organization_id, p_person_id) then
    raise exception 'Repeating blockout not found' using errcode = 'P0002';
  end if;
  select * into v_series from public.blockout_series
   where organization_id = p_organization_id and created_by = v_actor and idempotency_key = p_idempotency_key;
  if found then return v_series; end if;
  if jsonb_typeof(p_occurrences) <> 'array' then raise exception 'Occurrences must be an array' using errcode = '22023'; end if;
  v_count := jsonb_array_length(p_occurrences);
  if v_count not between 1 and 120 then raise exception 'A series needs 1 to 120 occurrences' using errcode = '22023'; end if;
  begin
  insert into public.blockout_series (
    organization_id, person_id, timezone, all_day, local_start_date, local_start_time,
    local_end_date, local_end_time, reason, frequency, interval_count, end_type,
    until_date, occurrence_count, monthly_missing_date, ambiguous_time_policy,
    idempotency_key, created_by
  ) values (
    p_organization_id, p_person_id, p_series->>'timezone', (p_series->>'all_day')::boolean,
    (p_series->>'local_start_date')::date, (p_series->>'local_start_time')::time,
    (p_series->>'local_end_date')::date, (p_series->>'local_end_time')::time,
    p_series->>'reason', p_series->>'frequency', (p_series->>'interval_count')::smallint,
    p_series->>'end_type', (p_series->>'until_date')::date, (p_series->>'occurrence_count')::smallint,
    'skip', p_series->>'ambiguous_time_policy', p_idempotency_key, v_actor
  ) returning * into v_series;
  exception when unique_violation then
    select * into v_series from public.blockout_series
     where organization_id=p_organization_id and created_by=v_actor and idempotency_key=p_idempotency_key;
    if found then return v_series; end if;
    raise;
  end;
  insert into public.blockouts (
    organization_id, person_id, starts_at, ends_at, reason, timezone, all_day,
    local_start_date, local_start_time, local_end_date, local_end_time,
    series_id, occurrence_key, created_by
  ) select p_organization_id, p_person_id, o.starts_at, o.ends_at, v_series.reason,
           v_series.timezone, v_series.all_day, o.local_start_date, o.local_start_time,
           o.local_end_date, o.local_end_time, v_series.id, o.occurrence_key, v_actor
      from jsonb_to_recordset(p_occurrences) as o(
        occurrence_key text, local_start_date date, local_start_time time,
        local_end_date date, local_end_time time, starts_at timestamptz, ends_at timestamptz
      );
  return v_series;
end $$;
revoke execute on function public.create_blockout_series(uuid, uuid, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.create_blockout_series(uuid, uuid, jsonb, jsonb, uuid) to authenticated;

create or replace function public.create_blockout(
  p_organization_id uuid, p_person_id uuid, p_payload jsonb, p_idempotency_key uuid
)
returns public.blockouts language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_row public.blockouts;
begin
  if v_actor is null or not private.can_manage_blockout(p_organization_id, p_person_id) then
    raise exception 'Blockout not found' using errcode = 'P0002';
  end if;
  if p_idempotency_key is not null then
    select * into v_row from public.blockouts where organization_id=p_organization_id
      and created_by=v_actor and idempotency_key=p_idempotency_key and series_id is null;
    if found then return v_row; end if;
  end if;
  begin
  insert into public.blockouts(organization_id,person_id,starts_at,ends_at,reason,timezone,all_day,
    local_start_date,local_start_time,local_end_date,local_end_time,idempotency_key,created_by)
  values(p_organization_id,p_person_id,(p_payload->>'starts_at')::timestamptz,(p_payload->>'ends_at')::timestamptz,
    p_payload->>'reason',p_payload->>'timezone',(p_payload->>'all_day')::boolean,
    (p_payload->>'local_start_date')::date,(p_payload->>'local_start_time')::time,
    (p_payload->>'local_end_date')::date,(p_payload->>'local_end_time')::time,p_idempotency_key,v_actor)
  returning * into v_row;
  exception when unique_violation then
    select * into v_row from public.blockouts where organization_id=p_organization_id
      and created_by=v_actor and idempotency_key=p_idempotency_key and series_id is null;
    if found then return v_row; end if;
    raise;
  end;
  return v_row;
end $$;
revoke execute on function public.create_blockout(uuid, uuid, jsonb, uuid) from public, anon;
grant execute on function public.create_blockout(uuid, uuid, jsonb, uuid) to authenticated;

create or replace function public.update_blockout(
  p_blockout_id uuid, p_expected_revision bigint, p_payload jsonb
)
returns public.blockouts language plpgsql security invoker set search_path = '' as $$
declare v_row public.blockouts;
begin
  select * into v_row from public.blockouts where id = p_blockout_id and series_id is null for update;
  if not found then raise exception 'Blockout not found' using errcode = 'P0002'; end if;
  if v_row.revision <> p_expected_revision then raise exception 'This blockout changed; refresh and try again' using errcode = 'PT409'; end if;
  update public.blockouts set starts_at = (p_payload->>'starts_at')::timestamptz,
    ends_at = (p_payload->>'ends_at')::timestamptz, reason = p_payload->>'reason',
    timezone = p_payload->>'timezone', all_day = (p_payload->>'all_day')::boolean,
    local_start_date = (p_payload->>'local_start_date')::date,
    local_start_time = (p_payload->>'local_start_time')::time,
    local_end_date = (p_payload->>'local_end_date')::date,
    local_end_time = (p_payload->>'local_end_time')::time
   where id = p_blockout_id returning * into v_row;
  return v_row;
end $$;
revoke execute on function public.update_blockout(uuid, bigint, jsonb) from public, anon;
grant execute on function public.update_blockout(uuid, bigint, jsonb) to authenticated;

create or replace function public.change_blockout_series(
  p_series_id uuid, p_expected_revision bigint, p_scope text, p_occurrence_id uuid,
  p_action text, p_series jsonb, p_occurrences jsonb, p_idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_series public.blockout_series; v_occ public.blockouts;
  v_existing public.blockout_operations; v_hash text; v_result jsonb; v_replacement uuid;
begin
  if p_scope not in ('occurrence','future','series') or p_action not in ('update','delete') then
    raise exception 'Invalid maintenance scope' using errcode = '22023';
  end if;
  v_hash := md5(concat_ws('|', p_series_id, p_expected_revision, p_scope, p_occurrence_id, p_action,
                           coalesce(p_series::text,''), coalesce(p_occurrences::text,'')));
  select * into v_existing from public.blockout_operations
   where actor_id = v_actor and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then raise exception 'Idempotency key reused' using errcode = 'PT409'; end if;
    return v_existing.result;
  end if;
  select * into v_series from public.blockout_series where id = p_series_id;
  if not found or not private.can_manage_blockout(v_series.organization_id, v_series.person_id) then
    raise exception 'Repeating blockout not found' using errcode = 'P0002';
  end if;
  select * into v_series from public.blockout_series where id = p_series_id for update;
  if v_series.revision <> p_expected_revision then raise exception 'This series changed; refresh and try again' using errcode = 'PT409'; end if;
  if p_scope <> 'series' then
    select * into v_occ from public.blockouts where id = p_occurrence_id and series_id = p_series_id for update;
    if not found then raise exception 'Occurrence not found' using errcode = 'P0002'; end if;
  end if;
  if p_action = 'delete' and p_scope = 'series' then
    delete from public.blockout_series where id = p_series_id;
    v_result := jsonb_build_object('deleted', true, 'series_id', p_series_id);
  elsif p_action = 'delete' then
    insert into public.blockout_series_exceptions(series_id, occurrence_key, kind, created_by)
      values (p_series_id, v_occ.occurrence_key,
              case when p_scope = 'future' then 'future_split' else 'deleted' end, v_actor)
      on conflict do nothing;
    if p_scope = 'future' then delete from public.blockouts where series_id = p_series_id and starts_at >= v_occ.starts_at;
    else delete from public.blockouts where id = v_occ.id; end if;
    update public.blockout_series set updated_at = now() where id = p_series_id returning * into v_series;
    v_result := jsonb_build_object('deleted', false, 'series_id', p_series_id, 'revision', v_series.revision);
  elsif p_scope = 'occurrence' then
    update public.blockouts set starts_at = (p_occurrences->0->>'starts_at')::timestamptz,
      ends_at = (p_occurrences->0->>'ends_at')::timestamptz,
      reason = p_series->>'reason', timezone = p_series->>'timezone',
      all_day = (p_series->>'all_day')::boolean,
      local_start_date = (p_occurrences->0->>'local_start_date')::date,
      local_start_time = (p_occurrences->0->>'local_start_time')::time,
      local_end_date = (p_occurrences->0->>'local_end_date')::date,
      local_end_time = (p_occurrences->0->>'local_end_time')::time
      where id = v_occ.id returning id into v_replacement;
    insert into public.blockout_series_exceptions(series_id, occurrence_key, kind, replacement_blockout_id, created_by)
      values (p_series_id, v_occ.occurrence_key, 'updated', v_replacement, v_actor)
      on conflict do nothing;
    update public.blockout_series set updated_at = now() where id = p_series_id returning * into v_series;
    v_result := jsonb_build_object('deleted', false, 'series_id', p_series_id, 'revision', v_series.revision);
  else
    if p_scope = 'future' then
      insert into public.blockout_series_exceptions(series_id, occurrence_key, kind, created_by)
        values (p_series_id, v_occ.occurrence_key, 'future_split', v_actor) on conflict do nothing;
      delete from public.blockouts where series_id = p_series_id and starts_at >= v_occ.starts_at;
    else delete from public.blockouts where series_id = p_series_id; end if;
    update public.blockout_series set timezone = p_series->>'timezone', all_day = (p_series->>'all_day')::boolean,
      local_start_date = (p_series->>'local_start_date')::date,
      local_start_time = (p_series->>'local_start_time')::time,
      local_end_date = (p_series->>'local_end_date')::date,
      local_end_time = (p_series->>'local_end_time')::time,
      reason = p_series->>'reason', frequency = p_series->>'frequency',
      interval_count = (p_series->>'interval_count')::smallint, end_type = p_series->>'end_type',
      until_date = (p_series->>'until_date')::date,
      occurrence_count = (p_series->>'occurrence_count')::smallint,
      ambiguous_time_policy = p_series->>'ambiguous_time_policy'
      where id = p_series_id returning * into v_series;
    insert into public.blockouts (
      organization_id, person_id, starts_at, ends_at, reason, timezone, all_day,
      local_start_date, local_start_time, local_end_date, local_end_time,
      series_id, occurrence_key, created_by
    ) select v_series.organization_id, v_series.person_id, o.starts_at, o.ends_at, v_series.reason,
             v_series.timezone, v_series.all_day, o.local_start_date, o.local_start_time,
             o.local_end_date, o.local_end_time, v_series.id, o.occurrence_key, v_actor
        from jsonb_to_recordset(p_occurrences) as o(
          occurrence_key text, local_start_date date, local_start_time time,
          local_end_date date, local_end_time time, starts_at timestamptz, ends_at timestamptz
        );
    v_result := jsonb_build_object('deleted', false, 'series_id', p_series_id, 'revision', v_series.revision);
  end if;
  insert into public.blockout_operations(organization_id, actor_id, idempotency_key, request_hash, result)
    values(v_series.organization_id, v_actor, p_idempotency_key, v_hash, v_result);
  return v_result;
end $$;
revoke execute on function public.change_blockout_series(uuid, bigint, text, uuid, text, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.change_blockout_series(uuid, bigint, text, uuid, text, jsonb, jsonb, uuid) to authenticated;

-- Recipients never see prepared assignments through this invoker function;
-- schedulers see only rows their normal assignment RLS permits.
create or replace function public.blockout_affected_assignments(
  p_organization_id uuid, p_person_id uuid, p_ranges jsonb
)
returns table(assignment_id uuid, plan_id uuid, plan_title text, assignment_status public.assignment_status,
  visibility text, team_name text, position_name text, time_id uuid, time_kind text, time_name text,
  starts_at timestamptz, ends_at timestamptz)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if jsonb_typeof(p_ranges) <> 'array' or jsonb_array_length(p_ranges) not between 1 and 120 then
    raise exception 'Provide 1 to 120 ranges' using errcode = '22023';
  end if;
  return query with ranges as (
    select * from jsonb_to_recordset(p_ranges) r(starts_at timestamptz, ends_at timestamptz)
  ) select distinct a.id, p.id, p.title, a.status, a.visibility::text, t.name, tp.name,
      pt.id, pt.kind::text, pt.name, pt.starts_at, pt.ends_at
    from public.assignments a join public.plans p on p.id = a.plan_id
    join public.plan_times pt on pt.plan_id = a.plan_id and (
      a.attendance_mode = 'all' or exists (select 1 from public.assignment_attendance_times aat
        where aat.assignment_id = a.id and aat.plan_time_id = pt.id))
    left join public.teams t on t.id = a.team_id
    left join public.team_positions tp on tp.id = a.position_id
    join ranges r on tstzrange(r.starts_at, r.ends_at, '[)') && tstzrange(pt.starts_at, pt.ends_at, '[)')
   where p.organization_id = p_organization_id and a.person_id = p_person_id and a.status <> 'declined'
   order by pt.starts_at;
end $$;
revoke execute on function public.blockout_affected_assignments(uuid, uuid, jsonb) from public, anon;
grant execute on function public.blockout_affected_assignments(uuid, uuid, jsonb) to authenticated;

-- Propagate Profile linking without turning it into a user-visible edit.
create or replace function private.propagate_person_link()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.assignments set user_id = new.profile_id where person_id = new.id and user_id is distinct from new.profile_id;
  update public.team_memberships set user_id = new.profile_id where person_id = new.id and user_id is distinct from new.profile_id;
  update public.assignment_notifications set user_id = new.profile_id where person_id = new.id and user_id is distinct from new.profile_id;
  update public.assignment_responses set assignee_id = new.profile_id where assignee_person_id = new.id and assignee_id is distinct from new.profile_id;
  update public.deliveries set recipient_id = new.profile_id where recipient_person_id = new.id and status = 'queued' and recipient_id is distinct from new.profile_id;
  update public.blockouts set user_id = new.profile_id where person_id = new.id and user_id is distinct from new.profile_id;
  return null;
end $$;

-- Generic scheduler conflict output deliberately redacts private reasons.
create or replace function public.scheduling_conflicts_for_people(
  p_organization_id uuid, p_person_ids uuid[], p_plan_time_ids uuid[], p_exclude_assignment_ids uuid[] default '{}'
)
returns table(person_id uuid, conflict_type text, detail text, starts_at timestamptz, ends_at timestamptz,
  plan_id uuid, assignment_id uuid, plan_time_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and not public.has_capability_anywhere(p_organization_id, 'scheduling.manage') then
    raise exception 'Only a scheduler can check conflicts' using errcode = '42501';
  end if;
  return query with requested as (
    select p.id person_id, pt.id plan_time_id, pt.starts_at, pt.ends_at
    from public.people p cross join public.plan_times pt
    join public.plans pl on pl.id = pt.plan_id
    where p.id = any(p_person_ids) and p.organization_id = p_organization_id
      and pt.id = any(p_plan_time_ids) and pl.organization_id = p_organization_id
  ), existing as (
    select a.id assignment_id, a.person_id, a.plan_id, p.title, pt.id plan_time_id, pt.starts_at, pt.ends_at
    from public.assignments a join public.plans p on p.id = a.plan_id
    join public.plan_times pt on pt.plan_id = a.plan_id and (a.attendance_mode = 'all' or exists (
      select 1 from public.assignment_attendance_times aat where aat.assignment_id = a.id and aat.plan_time_id = pt.id))
    where p.organization_id = p_organization_id and a.person_id = any(p_person_ids)
      and a.status <> 'declined' and not (a.id = any(coalesce(p_exclude_assignment_ids, '{}')))
      and (a.visibility = 'released' or (select auth.uid()) is null
           or private.can_schedule_on_plan((select auth.uid()), a.plan_id, a.team_id))
  )
  select r.person_id, 'blockout'::text, 'Unavailable'::text,
    greatest(r.starts_at,b.starts_at), least(r.ends_at,b.ends_at), null::uuid, null::uuid, r.plan_time_id
  from requested r join public.blockouts b on b.organization_id = p_organization_id and b.person_id = r.person_id
    and tstzrange(b.starts_at,b.ends_at,'[)') && tstzrange(r.starts_at,r.ends_at,'[)')
  union all
  select r.person_id, 'double_booked', e.title, greatest(r.starts_at,e.starts_at), least(r.ends_at,e.ends_at),
    e.plan_id,e.assignment_id,r.plan_time_id
  from requested r join existing e on e.person_id = r.person_id
    and tstzrange(e.starts_at,e.ends_at,'[)') && tstzrange(r.starts_at,r.ends_at,'[)');
end $$;
revoke execute on function public.scheduling_conflicts_for_people(uuid, uuid[], uuid[], uuid[]) from public, anon;
grant execute on function public.scheduling_conflicts_for_people(uuid, uuid[], uuid[], uuid[]) to authenticated, service_role;

create or replace function public.scheduling_conflicts(
  p_organization_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_user_ids uuid[] default null
)
returns table(user_id uuid, conflict_type text, detail text, starts_at timestamptz, ends_at timestamptz, plan_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and not public.has_capability_anywhere(p_organization_id, 'scheduling.manage') then
    raise exception 'Only a scheduler can check conflicts' using errcode = '42501';
  end if;
  return query with candidates as (
    select m.user_id from public.organization_members m where m.organization_id = p_organization_id
      and m.status = 'active' and (p_user_ids is null or m.user_id = any(p_user_ids))
  )
  select b.user_id, 'blockout'::text, 'Unavailable'::text, b.starts_at, b.ends_at, null::uuid
    from public.blockouts b join candidates c on c.user_id = b.user_id
   where b.organization_id = p_organization_id
     and tstzrange(b.starts_at,b.ends_at,'[)') && tstzrange(p_starts_at,p_ends_at,'[)')
  union all
  select a.user_id, 'double_booked', p.title, pt.starts_at, pt.ends_at, p.id
    from public.assignments a join candidates c on c.user_id = a.user_id
    join public.plans p on p.id = a.plan_id
    join public.plan_times pt on pt.plan_id = p.id and pt.kind = 'service'
   where p.organization_id = p_organization_id and a.status <> 'declined'
     and (a.visibility = 'released' or (select auth.uid()) is null
          or private.can_schedule_on_plan((select auth.uid()), a.plan_id, a.team_id))
     and tstzrange(pt.starts_at,pt.ends_at,'[)') && tstzrange(p_starts_at,p_ends_at,'[)');
end $$;
