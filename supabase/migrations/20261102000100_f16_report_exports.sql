-- F16 Pass B — tracked report exports with expiring, access-checked results.
--
-- * A requester asks for one report kind with filters; the API inserts a
--   queued job through `request_report_export` (durable per-requester
--   idempotency key: a repeat returns the same job). Only the requester ever
--   sees the job or its file.
-- * The scheduled worker (the same run that drives F00 deliveries and F13
--   file maintenance) claims jobs with SKIP LOCKED and a lease, re-checks
--   that the requester is still an active member holding the report's
--   capability, builds the CSV with the requester's own scope and uploads it
--   to the private `report-exports` bucket. Failures are recorded with a code;
--   after three attempts the job is `failed` and the requester may retry.
-- * Retrieval: Storage RLS lets only the requester read the object, only
--   while the job is `ready`, unexpired, and the requester still holds the
--   capability. The API signs a 300 s URL with the requester's own token, so
--   revoked access refuses every future retrieval even inside the 24 h
--   window. Expired results are deleted by the worker (`expired`).

create or replace function private.can_run_report(p_user uuid, p_org uuid, p_kind text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and p_org is not null and private.is_active_member(p_user, p_org) and case p_kind
    when 'staffing' then private.capability_anywhere(p_user, p_org, 'scheduling.manage')
    when 'participation' then private.capability_anywhere(p_user, p_org, 'scheduling.manage')
    when 'schedule' then private.capability_anywhere(p_user, p_org, 'scheduling.manage')
    when 'song_usage' then private.capability_anywhere(p_user, p_org, 'plans.edit')
                         or private.capability_anywhere(p_user, p_org, 'songs.manage')
    when 'run_times' then private.capability_anywhere(p_user, p_org, 'plans.edit')
    else false
  end;
$$;
revoke execute on function private.can_run_report(uuid, uuid, text) from public, anon;
grant execute on function private.can_run_report(uuid, uuid, text) to authenticated, service_role;

create table public.report_exports (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  requested_by      uuid not null references public.profiles (id) on delete cascade,
  kind              text not null,
  filters           jsonb not null,
  idempotency_key   text not null,
  status            text not null default 'queued',
  attempts          int not null default 0,
  next_attempt_at   timestamptz not null default now(),
  lease_expires_at  timestamptz,
  error_code        text,
  row_count         int,
  size_bytes        bigint,
  storage_path      text,
  generated_at      timestamptz,
  expires_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint report_exports_kind check (kind in ('staffing', 'participation', 'song_usage', 'run_times', 'schedule')),
  constraint report_exports_status check (status in ('queued', 'running', 'ready', 'failed', 'expired')),
  constraint report_exports_filters_object check (jsonb_typeof(filters) = 'object'),
  constraint report_exports_key_length check (char_length(idempotency_key) between 1 and 200),
  constraint report_exports_attempts check (attempts between 0 and 10),
  constraint report_exports_ready_shape check (
    status <> 'ready' or (storage_path is not null and generated_at is not null and expires_at is not null)
  ),
  constraint report_exports_member_fk foreign key (organization_id, requested_by)
    references public.organization_members (organization_id, user_id) on delete cascade
);

create unique index report_exports_key on public.report_exports (organization_id, requested_by, idempotency_key);
create index report_exports_requester_idx on public.report_exports (requested_by, created_at desc);
create index report_exports_due_idx on public.report_exports (next_attempt_at) where status in ('queued', 'running');
create index report_exports_expiry_idx on public.report_exports (expires_at) where status = 'ready';
create unique index report_exports_path on public.report_exports (storage_path) where storage_path is not null;

comment on table public.report_exports is
  'F16: one requested CSV export. Built by the worker under the requester''s scope; readable only by the requester while unexpired and still permitted.';

create trigger report_exports_updated_at
  before update on public.report_exports
  for each row execute function public.set_updated_at();

alter table public.report_exports enable row level security;

create policy report_exports_select on public.report_exports
  for select to authenticated
  using (requested_by = (select auth.uid()) and (select public.is_org_member(organization_id)));

revoke all on public.report_exports from anon;
revoke insert, update, delete, truncate on public.report_exports from authenticated;
grant select on public.report_exports to authenticated;
grant all on public.report_exports to service_role;

-- Queue (or return the existing job for the same key).
create or replace function public.request_report_export(
  p_org uuid,
  p_kind text,
  p_filters jsonb,
  p_idempotency_key text
)
returns public.report_exports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_row  public.report_exports%rowtype;
begin
  if not private.can_run_report(v_user, p_org, p_kind) then
    raise exception 'You cannot export this report' using errcode = '42501';
  end if;
  if jsonb_typeof(p_filters) is distinct from 'object' then
    raise exception 'Filters must be an object' using errcode = '22023';
  end if;
  insert into public.report_exports (organization_id, requested_by, kind, filters, idempotency_key)
  values (p_org, v_user, p_kind, p_filters, p_idempotency_key)
  on conflict (organization_id, requested_by, idempotency_key) do nothing
  returning * into v_row;
  if not found then
    select * into v_row from public.report_exports
     where organization_id = p_org and requested_by = v_user and idempotency_key = p_idempotency_key;
    if v_row.kind <> p_kind or v_row.filters <> p_filters then
      raise exception 'That idempotency key was used for a different export'
        using errcode = 'PT409', hint = 'idempotency_key_reused';
    end if;
  end if;
  return v_row;
end;
$$;
revoke execute on function public.request_report_export(uuid, text, jsonb, text) from public, anon;
grant execute on function public.request_report_export(uuid, text, jsonb, text) to authenticated, service_role;

-- A failed (or expired) export of mine goes back to the queue with fresh attempts.
create or replace function public.retry_report_export(p_export uuid)
returns public.report_exports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.report_exports%rowtype;
begin
  select * into v_row from public.report_exports
   where id = p_export and requested_by = (select auth.uid())
   for update;
  if not found then
    raise exception 'Export not found' using errcode = 'P0002';
  end if;
  if not private.can_run_report(v_row.requested_by, v_row.organization_id, v_row.kind) then
    raise exception 'You cannot export this report' using errcode = '42501';
  end if;
  if v_row.status not in ('failed', 'expired') then
    return v_row;
  end if;
  update public.report_exports
     set status = 'queued', attempts = 0, error_code = null, next_attempt_at = now(), lease_expires_at = null,
         storage_path = null, row_count = null, size_bytes = null, generated_at = null, expires_at = null
   where id = p_export
   returning * into v_row;
  return v_row;
end;
$$;
revoke execute on function public.retry_report_export(uuid) from public, anon;
grant execute on function public.retry_report_export(uuid) to authenticated, service_role;

-- Worker claim: queued and due, or running with a lapsed lease (a crashed
-- worker). Several workers never share a job.
create or replace function public.claim_report_exports(p_limit int default 5, p_lease_seconds int default 120)
returns setof public.report_exports
language sql
security definer
set search_path = ''
as $$
  update public.report_exports e
     set status = 'running',
         attempts = e.attempts + 1,
         lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 900)))
   where e.id in (
     select c.id from public.report_exports c
      where (c.status = 'queued' and c.next_attempt_at <= now())
         or (c.status = 'running' and c.lease_expires_at < now())
      order by c.next_attempt_at, c.id
      limit greatest(1, least(p_limit, 50))
      for update skip locked)
  returning e.*;
$$;
revoke execute on function public.claim_report_exports(int, int) from public, anon, authenticated;
grant execute on function public.claim_report_exports(int, int) to service_role;

-- ============================================================ storage =====

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-exports', 'report-exports', false, 52428800, array['text/csv'])
on conflict (id) do nothing;

create or replace function private.can_read_report_object(p_user uuid, p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.report_exports e
     where e.storage_path = p_name
       and e.requested_by = p_user
       and e.status = 'ready'
       and e.expires_at > now()
       and private.can_run_report(p_user, e.organization_id, e.kind));
$$;
revoke execute on function private.can_read_report_object(uuid, text) from public, anon;
grant execute on function private.can_read_report_object(uuid, text) to authenticated, service_role;

-- Read only; nobody but the service role writes this bucket.
create policy "requester reads report exports" on storage.objects
  for select to authenticated
  using (bucket_id = 'report-exports' and private.can_read_report_object((select auth.uid()), name));

-- The worker builds an export with the requester's *current* effective access
-- (same rows as `my_effective_access`). Service role only.
create or replace function public.report_requester_access(p_org uuid, p_user uuid)
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
  select * from private.effective_access_rows(p_user, p_org);
$$;
revoke execute on function public.report_requester_access(uuid, uuid) from public, anon, authenticated;
grant execute on function public.report_requester_access(uuid, uuid) to service_role;
