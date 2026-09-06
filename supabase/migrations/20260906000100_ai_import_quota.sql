-- ============================================================================
-- Daily AI quota for chord sheet imports.
--
-- Every import (and every retry) spends a call to an external vision model, so
-- each admin gets a fixed number of runs per day. The counter is keyed by the
-- organization's *local* date, so it resets at local midnight with no
-- scheduled job: a new day simply lands on a new key.
--
-- The limit itself is not stored here — it is passed in by the API from
-- AI_IMPORT_DAILY_LIMIT, so it can be raised without a migration.
-- ============================================================================

create table public.ai_import_usage (
  organization_id uuid    not null references public.organizations (id) on delete cascade,
  user_id         uuid    not null references public.profiles (id) on delete cascade,
  usage_date      date    not null,
  import_count    integer not null default 0 check (import_count >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint ai_import_usage_pkey primary key (organization_id, user_id, usage_date)
);

-- Housekeeping ("how much did this org spend last week") reads by org + day;
-- the primary key only helps when the user is known.
create index ai_import_usage_org_date_idx on public.ai_import_usage (organization_id, usage_date desc);

create trigger set_updated_at before update on public.ai_import_usage
  for each row execute function public.set_updated_at();

alter table public.ai_import_usage enable row level security;

-- A user may read their own counter. There is deliberately no write policy:
-- the SECURITY DEFINER function below is the only writer, so a client cannot
-- reset its own quota by updating the row.
create policy ai_import_usage_select_own on public.ai_import_usage
  for select using (
    user_id = (select auth.uid()) and public.is_org_member(organization_id)
  );

-- --------------------------------------------------------------- helpers ---
create or replace function public.org_timezone(org uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select o.timezone from public.organizations o where o.id = org), 'UTC');
$$;

-- ------------------------------------------------------------ quota API ---
-- Both functions resolve the caller from auth.uid() rather than a parameter,
-- and re-check admin membership themselves, because SECURITY DEFINER bypasses
-- the RLS that would otherwise do it.

create or replace function public.ai_import_quota_status(
  p_organization_id uuid,
  p_limit           integer
)
returns table (
  allowed     boolean,
  used        integer,
  remaining   integer,
  quota_limit integer,
  usage_date  date,
  resets_at   timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_tz   text;
  v_date date;
  v_used integer;
begin
  if v_user is null or not public.is_org_admin(p_organization_id) then
    raise exception 'Only organization admins can import chord sheets'
      using errcode = '42501';
  end if;

  v_tz := public.org_timezone(p_organization_id);
  v_date := (now() at time zone v_tz)::date;

  select coalesce(u.import_count, 0) into v_used
  from public.ai_import_usage u
  where u.organization_id = p_organization_id
    and u.user_id = v_user
    and u.usage_date = v_date;

  v_used := coalesce(v_used, 0);

  return query select
    v_used < p_limit,
    v_used,
    greatest(p_limit - v_used, 0),
    p_limit,
    v_date,
    ((v_date + 1)::timestamp at time zone v_tz);
end;
$$;

-- Atomically charges one import against today's allowance. `allowed` comes
-- back false (rather than an exception) when the caller is out of quota, so
-- the API can answer 429 with the counters intact.
create or replace function public.consume_ai_import_quota(
  p_organization_id uuid,
  p_limit           integer
)
returns table (
  allowed     boolean,
  used        integer,
  remaining   integer,
  quota_limit integer,
  usage_date  date,
  resets_at   timestamptz
)
language plpgsql security definer set search_path = public as $$
declare
  v_user    uuid := auth.uid();
  v_tz      text;
  v_date    date;
  v_used    integer;
  v_allowed boolean;
begin
  if v_user is null or not public.is_org_admin(p_organization_id) then
    raise exception 'Only organization admins can import chord sheets'
      using errcode = '42501';
  end if;

  if p_limit is null or p_limit < 0 then
    raise exception 'Invalid daily import limit' using errcode = '22023';
  end if;

  v_tz := public.org_timezone(p_organization_id);
  v_date := (now() at time zone v_tz)::date;

  if p_limit > 0 then
    -- One statement, so two concurrent uploads cannot both read 9 and write 10.
    insert into public.ai_import_usage (organization_id, user_id, usage_date, import_count)
    values (p_organization_id, v_user, v_date, 1)
    -- Targeted by constraint, not by column list: `usage_date` is also an OUT
    -- parameter of this function, and plpgsql would read it as the variable.
    on conflict on constraint ai_import_usage_pkey do update
      set import_count = ai_import_usage.import_count + 1
      where ai_import_usage.import_count < p_limit
    returning import_count into v_used;
  end if;

  if v_used is null then
    -- Nothing was charged: the row already sat at the limit (or the limit is 0).
    v_allowed := false;
    select coalesce(u.import_count, 0) into v_used
    from public.ai_import_usage u
    where u.organization_id = p_organization_id
      and u.user_id = v_user
      and u.usage_date = v_date;
    v_used := coalesce(v_used, 0);
  else
    v_allowed := true;
  end if;

  return query select
    v_allowed,
    v_used,
    greatest(p_limit - v_used, 0),
    p_limit,
    v_date,
    ((v_date + 1)::timestamp at time zone v_tz);
end;
$$;

revoke execute on function public.ai_import_quota_status(uuid, integer) from public, anon;
revoke execute on function public.consume_ai_import_quota(uuid, integer) from public, anon;
grant execute on function public.ai_import_quota_status(uuid, integer) to authenticated, service_role;
grant execute on function public.consume_ai_import_quota(uuid, integer) to authenticated, service_role;

-- ------------------------------------------------------- tighten imports ---
-- Importing is now admin-only at the API; RLS is the primary control here, so
-- narrow the write policy to match. Schedulers keep read access to see what
-- was imported, and still edit chord charts by hand through `arrangements`.
drop policy if exists chord_sheet_imports_write on public.chord_sheet_imports;
create policy chord_sheet_imports_write on public.chord_sheet_imports
  for all using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));
