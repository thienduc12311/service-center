-- F17 stage D — external developer API credentials and signed webhooks.
--
-- Credentials
--   An administrator issues an organization credential with explicit scopes
--   (`plans.read`, `songs.read`). Only a SHA-256 hash of the secret is stored;
--   the secret is shown once. A credential works while it is unrevoked,
--   unexpired and its issuer is still an active owner/admin of the
--   organization — losing that role stops every credential they issued.
--   Requests are counted in per-minute windows here (not in process memory),
--   so the limit holds across API instances.
--
--   The external API is read-only and member-level: published plans (never
--   drafts or archived plans), their times and order, the non-archived song
--   library and service types. No people, assignments, notes, item
--   descriptions, files or contact data are reachable through a credential.
--   Every data function takes the credential id and re-derives its
--   organization and scope itself.
--
-- Webhooks
--   An administrator registers an endpoint with a signing secret, stored only
--   as server-side ciphertext (the API encrypts it; the database never sees
--   the key). Plan publication changes record an event and one delivery per
--   subscribed endpoint in the same transaction as the change (no event is
--   recorded when nobody subscribes). Events are thin: ids and type only, so
--   a subscriber reads detail through the API with its own scopes. The F00
--   worker run claims due deliveries with a lease (SKIP LOCKED); a lapsed
--   lease is re-sent with the same event id, which receivers deduplicate.
--   A 410 response, revocation or repeated permanent failure stops delivery.
--
--   Clients never write these tables; administrators read them (secret
--   columns excluded by column privileges).

-- ================================================================ credentials

create table public.api_credentials (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete cascade,
  name                   text not null check (char_length(btrim(name)) between 1 and 80),
  -- Public lookup half of the key (`sck_<prefix>_<secret>`).
  key_prefix             text not null unique check (key_prefix ~ '^[a-f0-9]{16}$'),
  secret_hash            text not null check (secret_hash ~ '^[a-f0-9]{64}$'),
  scopes                 text[] not null check (
    cardinality(scopes) between 1 and 2 and scopes <@ array['plans.read', 'songs.read']::text[]
  ),
  rate_limit_per_minute  int not null default 60 check (rate_limit_per_minute between 1 and 600),
  expires_at             timestamptz,
  created_by             uuid references public.profiles (id) on delete set null,
  idempotency_key        text not null check (char_length(idempotency_key) between 8 and 100),
  created_at             timestamptz not null default now(),
  last_used_at           timestamptz,
  revoked_at             timestamptz,
  revoked_by             uuid references public.profiles (id) on delete set null,
  constraint api_credentials_key_once unique (organization_id, created_by, idempotency_key)
);
create index api_credentials_org_idx on public.api_credentials (organization_id, created_at desc);
create index api_credentials_created_by_idx on public.api_credentials (created_by);
create index api_credentials_revoked_by_idx on public.api_credentials (revoked_by);

create table public.api_credential_windows (
  credential_id  uuid not null references public.api_credentials (id) on delete cascade,
  window_start   timestamptz not null,
  request_count  int not null default 0 check (request_count >= 0),
  primary key (credential_id, window_start)
);

alter table public.api_credentials enable row level security;
alter table public.api_credential_windows enable row level security;

create policy api_credentials_select on public.api_credentials
  for select to authenticated using ((select public.is_org_admin(organization_id)));
-- api_credential_windows: no policy — service role only.

revoke all on public.api_credentials from anon, authenticated;
grant select (id, organization_id, name, key_prefix, scopes, rate_limit_per_minute, expires_at,
              created_by, created_at, last_used_at, revoked_at, revoked_by)
  on public.api_credentials to authenticated;
revoke all on public.api_credential_windows from anon, authenticated;

-- An active owner/admin of the organization (service-role checks pass the user).
create or replace function private.is_active_org_admin(p_user uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
     where m.organization_id = p_org and m.user_id = p_user
       and m.status = 'active' and m.role in ('owner', 'admin'));
$$;
revoke execute on function private.is_active_org_admin(uuid, uuid) from public, anon, authenticated;
grant execute on function private.is_active_org_admin(uuid, uuid) to service_role;

-- The API generates the key and hashes the secret; only the hash arrives here.
-- A repeated idempotency key returns the stored credential with replayed=true
-- (the secret cannot be shown again).
create or replace function public.create_api_credential(
  p_org                    uuid,
  p_name                   text,
  p_scopes                 text[],
  p_key_prefix             text,
  p_secret_hash            text,
  p_expires_at             timestamptz,
  p_rate_limit_per_minute  int,
  p_idempotency_key        text
)
returns table (credential_id uuid, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id   uuid;
  v_same boolean;
begin
  if v_user is null or not public.is_org_admin(p_org) then
    raise exception 'Only an administrator can issue API credentials' using errcode = '42501';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'Expiry must be in the future' using errcode = '22023';
  end if;
  if (select count(*) from public.api_credentials c
       where c.organization_id = p_org and c.revoked_at is null) >= 25 then
    raise exception 'An organization can hold at most 25 active credentials' using errcode = '22023';
  end if;

  select c.id, (c.name = btrim(p_name) and c.scopes = (select array_agg(distinct s order by s) from unnest(p_scopes) s))
    into v_id, v_same
    from public.api_credentials c
   where c.organization_id = p_org and c.created_by = v_user and c.idempotency_key = p_idempotency_key;
  if v_id is not null then
    if not v_same then
      raise exception 'This request key was already used for a different credential'
        using errcode = 'PT409', hint = 'idempotency_key_reused';
    end if;
    return query select v_id, true;
    return;
  end if;

  insert into public.api_credentials
    (organization_id, name, key_prefix, secret_hash, scopes, rate_limit_per_minute, expires_at, created_by, idempotency_key)
  values
    (p_org, btrim(p_name), p_key_prefix, p_secret_hash,
     (select array_agg(distinct s order by s) from unnest(p_scopes) s),
     coalesce(p_rate_limit_per_minute, 60), p_expires_at, v_user, p_idempotency_key)
  on conflict on constraint api_credentials_key_once do nothing
  returning id into v_id;
  if v_id is null then
    -- A concurrent identical request won the race.
    select c.id into v_id from public.api_credentials c
     where c.organization_id = p_org and c.created_by = v_user and c.idempotency_key = p_idempotency_key;
    return query select v_id, true;
    return;
  end if;
  return query select v_id, false;
end;
$$;
revoke execute on function public.create_api_credential(uuid, text, text[], text, text, timestamptz, int, text) from public, anon;
grant execute on function public.create_api_credential(uuid, text, text[], text, text, timestamptz, int, text) to authenticated;

-- Idempotent: revoking a revoked credential keeps its first revocation.
create or replace function public.revoke_api_credential(p_credential uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.api_credentials where id = p_credential;
  if v_org is null or not public.is_org_admin(v_org) then
    raise exception 'Credential not found' using errcode = 'P0002';
  end if;
  update public.api_credentials
     set revoked_at = now(), revoked_by = (select auth.uid())
   where id = p_credential and revoked_at is null;
end;
$$;
revoke execute on function public.revoke_api_credential(uuid) from public, anon;
grant execute on function public.revoke_api_credential(uuid) to authenticated;

-- One call per external request: find the credential by its public prefix,
-- compare the presented secret's hash, re-check that it is still usable and
-- only then count the request in the current minute window. A wrong secret
-- never consumes the real credential's quota.
create or replace function public.api_authenticate(p_key_prefix text, p_secret_hash text)
returns table (
  outcome          text,   -- ok | invalid | inactive | rate_limited
  credential_id    uuid,
  organization_id  uuid,
  scopes           text[],
  rate_limit       int,
  remaining        int,
  reset_at         timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cred   public.api_credentials%rowtype;
  v_window timestamptz := date_trunc('minute', now());
  v_count  int;
begin
  select * into v_cred from public.api_credentials c where c.key_prefix = p_key_prefix;
  if v_cred.id is null or v_cred.secret_hash <> p_secret_hash then
    return query select 'invalid'::text, null::uuid, null::uuid, null::text[], null::int, null::int, null::timestamptz;
    return;
  end if;
  if v_cred.revoked_at is not null
     or (v_cred.expires_at is not null and v_cred.expires_at <= now())
     or v_cred.created_by is null
     or not private.is_active_org_admin(v_cred.created_by, v_cred.organization_id) then
    return query select 'inactive'::text, v_cred.id, null::uuid, null::text[], null::int, null::int, null::timestamptz;
    return;
  end if;

  insert into public.api_credential_windows as w (credential_id, window_start, request_count)
  values (v_cred.id, v_window, 1)
  on conflict on constraint api_credential_windows_pkey
    do update set request_count = w.request_count + 1
  returning w.request_count into v_count;

  if v_count = 1 then
    -- First request of a minute: tidy this credential's old windows and note use.
    delete from public.api_credential_windows w
     where w.credential_id = v_cred.id and w.window_start < v_window - interval '1 hour';
    update public.api_credentials set last_used_at = now() where id = v_cred.id;
  end if;

  return query select
    case when v_count > v_cred.rate_limit_per_minute then 'rate_limited' else 'ok' end,
    v_cred.id, v_cred.organization_id, v_cred.scopes, v_cred.rate_limit_per_minute,
    greatest(0, v_cred.rate_limit_per_minute - v_count), v_window + interval '1 minute';
end;
$$;
revoke execute on function public.api_authenticate(text, text) from public, anon, authenticated;
grant execute on function public.api_authenticate(text, text) to service_role;

-- Organization of a usable credential holding the scope, or an error.
create or replace function private.api_scope_org(p_credential uuid, p_scope text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cred public.api_credentials%rowtype;
begin
  select * into v_cred from public.api_credentials where id = p_credential;
  if v_cred.id is null or v_cred.revoked_at is not null
     or (v_cred.expires_at is not null and v_cred.expires_at <= now())
     or v_cred.created_by is null
     or not private.is_active_org_admin(v_cred.created_by, v_cred.organization_id) then
    raise exception 'Credential is not active' using errcode = '28000';
  end if;
  if p_scope is not null and not (p_scope = any(v_cred.scopes)) then
    raise exception 'Credential lacks the % scope', p_scope using errcode = '42501';
  end if;
  return v_cred.organization_id;
end;
$$;
revoke execute on function private.api_scope_org(uuid, text) from public, anon, authenticated;
grant execute on function private.api_scope_org(uuid, text) to service_role;

-- ------------------------------------------------------- external reads -----

create or replace function public.api_organization(p_credential uuid)
returns table (id uuid, name text, timezone text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.name, o.timezone
    from public.organizations o
   where o.id = (select private.api_scope_org(p_credential, null));
$$;

create or replace function public.api_service_types(p_credential uuid, p_after uuid, p_limit int)
returns table (id uuid, name text, description text, updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select st.id, st.name, st.description, st.updated_at
    from public.service_types st
   where st.organization_id = (select private.api_scope_org(p_credential, 'plans.read'))
     and (p_after is null or st.id > p_after)
   order by st.id
   limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

-- Published plans only, keyset-paginated on (service_date, id).
create or replace function public.api_plans(
  p_credential    uuid,
  p_from          timestamptz,
  p_to            timestamptz,
  p_service_type  uuid,
  p_after_date    timestamptz,
  p_after_id      uuid,
  p_limit         int
)
returns table (id uuid, service_type_id uuid, title text, service_date timestamptz, location text, updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.service_type_id, p.title, p.service_date, p.location, p.updated_at
    from public.plans p
   where p.organization_id = (select private.api_scope_org(p_credential, 'plans.read'))
     and p.status = 'published'
     and p.service_date >= p_from and p.service_date < p_to
     and (p_service_type is null or p.service_type_id = p_service_type)
     and (p_after_date is null or (p.service_date, p.id) > (p_after_date, p_after_id))
   order by p.service_date, p.id
   limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

-- One published plan with its times and order (no descriptions, people,
-- notes, files or media). Null when absent, unpublished or another tenant's.
create or replace function public.api_plan(p_credential uuid, p_plan uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'service_type_id', p.service_type_id,
    'title', p.title,
    'service_date', p.service_date,
    'location', p.location,
    'updated_at', p.updated_at,
    'times', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'kind', t.kind, 'name', t.name, 'starts_at', t.starts_at, 'ends_at', t.ends_at)
             order by t.starts_at, t.id)
        from public.plan_times t where t.plan_id = p.id), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'type', i.item_type, 'title', i.title, 'position', i.sort_order,
               'length_seconds', i.length_seconds, 'song_id', i.song_id)
             order by i.sort_order, i.id)
        from public.plan_items i where i.plan_id = p.id), '[]'::jsonb))
    from public.plans p
   where p.id = p_plan
     and p.organization_id = (select private.api_scope_org(p_credential, 'plans.read'))
     and p.status = 'published';
$$;

-- Library songs that are neither archived nor merged away.
create or replace function public.api_songs(p_credential uuid, p_query text, p_after uuid, p_limit int)
returns table (id uuid, title text, author text, ccli_number text, default_key text, themes text[], updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.title, s.author, s.ccli_number, s.default_key, s.themes, s.updated_at
    from public.songs s
   where s.organization_id = (select private.api_scope_org(p_credential, 'songs.read'))
     and s.archived_at is null and s.merged_into_song_id is null
     and (p_query is null or s.title ilike '%' || replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_') || '%')
     and (p_after is null or s.id > p_after)
   order by s.id
   limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.api_organization(uuid)',
    'public.api_service_types(uuid, uuid, int)',
    'public.api_plans(uuid, timestamptz, timestamptz, uuid, timestamptz, uuid, int)',
    'public.api_plan(uuid, uuid)',
    'public.api_songs(uuid, text, uuid, int)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

-- Keyset paging over plans by organization and date.
create index plans_published_org_date_idx on public.plans (organization_id, service_date, id)
  where status = 'published';

-- =================================================================== webhooks

create table public.webhook_endpoints (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete cascade,
  url                   text not null check (char_length(url) between 10 and 2048 and url ~ '^https?://'),
  description           text check (description is null or char_length(description) <= 200),
  event_types           text[] not null check (
    cardinality(event_types) between 1 and 3
    and event_types <@ array['plan.published', 'plan.unpublished', 'plan.deleted']::text[]
  ),
  -- AES-256-GCM ciphertext written by the API; the key never reaches the database.
  secret_ciphertext     text not null check (char_length(secret_ciphertext) between 20 and 1000),
  secret_hint           text not null check (char_length(secret_hint) = 4),
  enabled               boolean not null default true,
  disabled_reason       text check (disabled_reason in ('administrator', 'gone', 'failing')),
  consecutive_failures  int not null default 0 check (consecutive_failures >= 0),
  revision              int not null default 1 check (revision > 0),
  created_by            uuid references public.profiles (id) on delete set null,
  idempotency_key       text not null check (char_length(idempotency_key) between 8 and 100),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  revoked_at            timestamptz,
  revoked_by            uuid references public.profiles (id) on delete set null,
  constraint webhook_endpoints_key_once unique (organization_id, created_by, idempotency_key),
  constraint webhook_endpoints_disabled_shape check (enabled = (disabled_reason is null))
);
create index webhook_endpoints_org_idx on public.webhook_endpoints (organization_id, created_at desc);
create index webhook_endpoints_created_by_idx on public.webhook_endpoints (created_by);
create index webhook_endpoints_revoked_by_idx on public.webhook_endpoints (revoked_by);
create trigger set_updated_at before update on public.webhook_endpoints
  for each row execute function public.set_updated_at();

create table public.webhook_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  event_type       text not null check (event_type in ('plan.published', 'plan.unpublished', 'plan.deleted', 'webhook.test')),
  -- Semantic identity: the same transition never records two events.
  source_key       text not null check (char_length(source_key) between 1 and 200),
  data             jsonb not null,
  occurred_at      timestamptz not null default now(),
  constraint webhook_events_source_once unique (organization_id, source_key)
);
create index webhook_events_occurred_idx on public.webhook_events (occurred_at);

create table public.webhook_deliveries (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  event_id          uuid not null references public.webhook_events (id) on delete cascade,
  endpoint_id       uuid not null references public.webhook_endpoints (id) on delete cascade,
  status            text not null default 'queued'
                    check (status in ('queued', 'sending', 'succeeded', 'failed', 'cancelled')),
  attempts          int not null default 0 check (attempts >= 0),
  max_attempts      int not null default 8 check (max_attempts > 0),
  next_attempt_at   timestamptz not null default now(),
  lease_expires_at  timestamptz,
  last_status_code  int,
  -- A short machine code (`timeout`, `destination_blocked`, ...); never response text.
  last_error_code   text check (last_error_code is null or char_length(last_error_code) <= 64),
  manual_retries    int not null default 0 check (manual_retries >= 0),
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint webhook_deliveries_once unique (event_id, endpoint_id),
  constraint webhook_deliveries_lease_shape check ((status = 'sending') = (lease_expires_at is not null))
);
create index webhook_deliveries_due_idx on public.webhook_deliveries (next_attempt_at) where status = 'queued';
create index webhook_deliveries_lease_idx on public.webhook_deliveries (lease_expires_at) where status = 'sending';
create index webhook_deliveries_endpoint_idx on public.webhook_deliveries (endpoint_id, created_at desc);
create index webhook_deliveries_org_idx on public.webhook_deliveries (organization_id);
create trigger set_updated_at before update on public.webhook_deliveries
  for each row execute function public.set_updated_at();

create table public.webhook_delivery_attempts (
  id               uuid primary key default gen_random_uuid(),
  delivery_id      uuid not null references public.webhook_deliveries (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  attempt          int not null check (attempt > 0),
  started_at       timestamptz not null,
  duration_ms      int check (duration_ms is null or duration_ms >= 0),
  status_code      int,
  outcome          text not null check (outcome in ('succeeded', 'retry', 'failed', 'gone')),
  error_code       text check (error_code is null or char_length(error_code) <= 64),
  constraint webhook_delivery_attempts_once unique (delivery_id, attempt)
);
create index webhook_delivery_attempts_org_idx on public.webhook_delivery_attempts (organization_id);

alter table public.webhook_endpoints enable row level security;
alter table public.webhook_events enable row level security;
alter table public.webhook_deliveries enable row level security;
alter table public.webhook_delivery_attempts enable row level security;

create policy webhook_endpoints_select on public.webhook_endpoints
  for select to authenticated using ((select public.is_org_admin(organization_id)));
create policy webhook_events_select on public.webhook_events
  for select to authenticated using ((select public.is_org_admin(organization_id)));
create policy webhook_deliveries_select on public.webhook_deliveries
  for select to authenticated using ((select public.is_org_admin(organization_id)));
create policy webhook_delivery_attempts_select on public.webhook_delivery_attempts
  for select to authenticated using ((select public.is_org_admin(organization_id)));

revoke all on public.webhook_endpoints, public.webhook_events, public.webhook_deliveries,
              public.webhook_delivery_attempts from anon, authenticated;
grant select (id, organization_id, url, description, event_types, secret_hint, enabled, disabled_reason,
              consecutive_failures, revision, created_by, created_at, updated_at, revoked_at, revoked_by)
  on public.webhook_endpoints to authenticated;
grant select on public.webhook_events, public.webhook_deliveries, public.webhook_delivery_attempts to authenticated;

-- --------------------------------------------------------- administration --

create or replace function public.create_webhook_endpoint(
  p_org                uuid,
  p_url                text,
  p_description        text,
  p_event_types        text[],
  p_secret_ciphertext  text,
  p_secret_hint        text,
  p_idempotency_key    text
)
returns table (endpoint_id uuid, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := (select auth.uid());
  v_id    uuid;
  v_same  boolean;
  v_types text[] := (select array_agg(distinct t order by t) from unnest(p_event_types) t);
begin
  if v_user is null or not public.is_org_admin(p_org) then
    raise exception 'Only an administrator can register webhooks' using errcode = '42501';
  end if;

  select e.id, (e.url = p_url and e.event_types = v_types)
    into v_id, v_same
    from public.webhook_endpoints e
   where e.organization_id = p_org and e.created_by = v_user and e.idempotency_key = p_idempotency_key;
  if v_id is not null then
    if not v_same then
      raise exception 'This request key was already used for a different endpoint'
        using errcode = 'PT409', hint = 'idempotency_key_reused';
    end if;
    return query select v_id, true;
    return;
  end if;

  if (select count(*) from public.webhook_endpoints e
       where e.organization_id = p_org and e.revoked_at is null) >= 10 then
    raise exception 'An organization can hold at most 10 active webhook endpoints' using errcode = '22023';
  end if;

  insert into public.webhook_endpoints
    (organization_id, url, description, event_types, secret_ciphertext, secret_hint, created_by, idempotency_key)
  values
    (p_org, p_url, nullif(btrim(p_description), ''), v_types, p_secret_ciphertext, p_secret_hint, v_user, p_idempotency_key)
  on conflict on constraint webhook_endpoints_key_once do nothing
  returning id into v_id;
  if v_id is null then
    select e.id into v_id from public.webhook_endpoints e
     where e.organization_id = p_org and e.created_by = v_user and e.idempotency_key = p_idempotency_key;
    return query select v_id, true;
    return;
  end if;
  return query select v_id, false;
end;
$$;
revoke execute on function public.create_webhook_endpoint(uuid, text, text, text[], text, text, text) from public, anon;
grant execute on function public.create_webhook_endpoint(uuid, text, text, text[], text, text, text) to authenticated;

-- Pause or resume. Pausing cancels deliveries still waiting; resuming does not
-- resend them (an administrator can retry individual deliveries).
create or replace function public.set_webhook_endpoint_enabled(p_endpoint uuid, p_enabled boolean, p_expected_revision int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ep public.webhook_endpoints%rowtype;
begin
  select * into v_ep from public.webhook_endpoints where id = p_endpoint for update;
  if v_ep.id is null or not public.is_org_admin(v_ep.organization_id) then
    raise exception 'Webhook endpoint not found' using errcode = 'P0002';
  end if;
  if v_ep.revoked_at is not null then
    raise exception 'This endpoint was revoked' using errcode = 'PT409', hint = 'webhook_changed';
  end if;
  if v_ep.revision <> p_expected_revision then
    raise exception 'The endpoint changed since it was loaded' using errcode = 'PT409', hint = 'webhook_changed';
  end if;
  update public.webhook_endpoints
     set enabled = p_enabled,
         disabled_reason = case when p_enabled then null else 'administrator' end,
         consecutive_failures = case when p_enabled then 0 else consecutive_failures end,
         revision = revision + 1
   where id = p_endpoint;
  if not p_enabled then
    update public.webhook_deliveries
       set status = 'cancelled', last_error_code = 'endpoint_disabled', completed_at = now()
     where endpoint_id = p_endpoint and status = 'queued';
  end if;
end;
$$;
revoke execute on function public.set_webhook_endpoint_enabled(uuid, boolean, int) from public, anon;
grant execute on function public.set_webhook_endpoint_enabled(uuid, boolean, int) to authenticated;

-- Permanent: stops new events and cancels waiting deliveries; history stays.
create or replace function public.revoke_webhook_endpoint(p_endpoint uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.webhook_endpoints where id = p_endpoint;
  if v_org is null or not public.is_org_admin(v_org) then
    raise exception 'Webhook endpoint not found' using errcode = 'P0002';
  end if;
  update public.webhook_endpoints
     set revoked_at = now(), revoked_by = (select auth.uid()), enabled = false,
         disabled_reason = 'administrator', revision = revision + 1
   where id = p_endpoint and revoked_at is null;
  update public.webhook_deliveries
     set status = 'cancelled', last_error_code = 'endpoint_revoked', completed_at = now()
   where endpoint_id = p_endpoint and status = 'queued';
end;
$$;
revoke execute on function public.revoke_webhook_endpoint(uuid) from public, anon;
grant execute on function public.revoke_webhook_endpoint(uuid) to authenticated;

-- A `webhook.test` event for one endpoint.
create or replace function public.send_webhook_test(p_endpoint uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ep       public.webhook_endpoints%rowtype;
  v_event    uuid;
  v_delivery uuid;
begin
  select * into v_ep from public.webhook_endpoints where id = p_endpoint;
  if v_ep.id is null or not public.is_org_admin(v_ep.organization_id) then
    raise exception 'Webhook endpoint not found' using errcode = 'P0002';
  end if;
  if v_ep.revoked_at is not null or not v_ep.enabled then
    raise exception 'Enable the endpoint before sending a test' using errcode = 'PT409', hint = 'webhook_changed';
  end if;
  insert into public.webhook_events (organization_id, event_type, source_key, data)
  values (v_ep.organization_id, 'webhook.test', 'webhook.test:' || gen_random_uuid(),
          jsonb_build_object('endpoint_id', v_ep.id))
  returning id into v_event;
  insert into public.webhook_deliveries (organization_id, event_id, endpoint_id)
  values (v_ep.organization_id, v_event, v_ep.id)
  returning id into v_delivery;
  return v_delivery;
end;
$$;
revoke execute on function public.send_webhook_test(uuid) from public, anon;
grant execute on function public.send_webhook_test(uuid) to authenticated;

-- Re-queue a failed or cancelled delivery to an active endpoint (same event id).
create or replace function public.retry_webhook_delivery(p_delivery uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_del public.webhook_deliveries%rowtype;
  v_ep  public.webhook_endpoints%rowtype;
begin
  select * into v_del from public.webhook_deliveries where id = p_delivery for update;
  if v_del.id is null or not public.is_org_admin(v_del.organization_id) then
    raise exception 'Delivery not found' using errcode = 'P0002';
  end if;
  select * into v_ep from public.webhook_endpoints where id = v_del.endpoint_id;
  if v_ep.revoked_at is not null or not v_ep.enabled then
    raise exception 'Enable the endpoint before retrying' using errcode = 'PT409', hint = 'webhook_changed';
  end if;
  if v_del.status not in ('failed', 'cancelled') then
    raise exception 'Only a failed or cancelled delivery can be retried' using errcode = 'PT409', hint = 'webhook_changed';
  end if;
  update public.webhook_deliveries
     set status = 'queued', next_attempt_at = now(), max_attempts = attempts + 3,
         manual_retries = manual_retries + 1, completed_at = null
   where id = p_delivery;
end;
$$;
revoke execute on function public.retry_webhook_delivery(uuid) from public, anon;
grant execute on function public.retry_webhook_delivery(uuid) to authenticated;

-- ----------------------------------------------------------------- events --

-- Records one event and a delivery per subscribed active endpoint, in the
-- caller's transaction. Nothing is recorded without a subscriber.
create or replace function private.emit_webhook_event(p_org uuid, p_type text, p_source_key text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event uuid;
begin
  if not exists (
    select 1 from public.webhook_endpoints e
     where e.organization_id = p_org and e.enabled and e.revoked_at is null and p_type = any(e.event_types)) then
    return;
  end if;
  insert into public.webhook_events (organization_id, event_type, source_key, data)
  values (p_org, p_type, p_source_key, p_data)
  on conflict on constraint webhook_events_source_once do nothing
  returning id into v_event;
  if v_event is null then
    return;
  end if;
  insert into public.webhook_deliveries (organization_id, event_id, endpoint_id)
  select p_org, v_event, e.id
    from public.webhook_endpoints e
   where e.organization_id = p_org and e.enabled and e.revoked_at is null and p_type = any(e.event_types)
  on conflict on constraint webhook_deliveries_once do nothing;
end;
$$;
revoke execute on function private.emit_webhook_event(uuid, text, text, jsonb) from public, anon, authenticated;

create or replace function private.plan_webhook_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text;
  v_row  public.plans%rowtype;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'published' then return null; end if;
    -- The organization itself is being deleted: nobody to tell.
    if not exists (select 1 from public.organizations where id = old.organization_id) then return null; end if;
    v_type := 'plan.deleted';
    v_row := old;
  elsif new.status = 'published' and old.status is distinct from 'published' then
    v_type := 'plan.published';
    v_row := new;
  elsif old.status = 'published' and new.status <> 'published' then
    v_type := 'plan.unpublished';
    v_row := new;
  else
    return null;
  end if;
  perform private.emit_webhook_event(
    v_row.organization_id,
    v_type,
    v_type || ':' || v_row.id || ':' || txid_current(),
    jsonb_build_object('plan_id', v_row.id, 'service_type_id', v_row.service_type_id));
  return null;
end;
$$;

create trigger plans_webhook_status
  after update of status on public.plans
  for each row execute function private.plan_webhook_events();
create trigger plans_webhook_delete
  after delete on public.plans
  for each row execute function private.plan_webhook_events();

-- ----------------------------------------------------------------- worker --

-- Cancels waiting work for endpoints that stopped, then leases due deliveries
-- (and lapsed leases) with the payload the sender needs. Service role only.
create or replace function public.claim_webhook_deliveries(p_limit int default 20, p_lease_seconds int default 60)
returns table (
  delivery_id        uuid,
  organization_id    uuid,
  endpoint_id        uuid,
  url                text,
  secret_ciphertext  text,
  event_id           uuid,
  event_type         text,
  occurred_at        timestamptz,
  data               jsonb,
  attempt            int,
  max_attempts       int
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.webhook_deliveries d
     set status = 'cancelled',
         last_error_code = case when e.revoked_at is not null then 'endpoint_revoked' else 'endpoint_disabled' end,
         completed_at = now()
    from public.webhook_endpoints e
   where e.id = d.endpoint_id and d.status = 'queued' and (e.revoked_at is not null or not e.enabled);

  return query
  with due as (
    select c.id from public.webhook_deliveries c
     where (c.status = 'queued' and c.next_attempt_at <= now())
        or (c.status = 'sending' and c.lease_expires_at < now())
     order by c.next_attempt_at, c.id
     limit greatest(1, least(p_limit, 100))
     for update skip locked
  ), claimed as (
    update public.webhook_deliveries d
       set status = 'sending',
           attempts = d.attempts + 1,
           lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 300)))
      from due
     where d.id = due.id
    returning d.*
  )
  select c.id, c.organization_id, c.endpoint_id, e.url, e.secret_ciphertext, ev.id, ev.event_type,
         ev.occurred_at, ev.data, c.attempts, c.max_attempts
    from claimed c
    join public.webhook_endpoints e on e.id = c.endpoint_id
    join public.webhook_events ev on ev.id = c.event_id;
end;
$$;
revoke execute on function public.claim_webhook_deliveries(int, int) from public, anon, authenticated;
grant execute on function public.claim_webhook_deliveries(int, int) to service_role;

-- Records one attempt's outcome. Only the attempt that holds the lease may
-- complete it (a lapsed, re-claimed attempt is ignored).
--   succeeded → done, endpoint failure streak reset
--   retry     → queued again after the backoff (or failed when out of attempts)
--   failed    → done (permanent client error)
--   gone      → done and the endpoint is disabled (HTTP 410)
-- Five permanently failed deliveries in a row disable the endpoint.
create or replace function public.complete_webhook_delivery(
  p_delivery             uuid,
  p_attempt              int,
  p_outcome              text,
  p_status_code          int,
  p_error_code           text,
  p_started_at           timestamptz,
  p_duration_ms          int,
  p_retry_after_seconds  int
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_del     public.webhook_deliveries%rowtype;
  v_final   text;
  v_backoff int[] := array[5, 300, 1800, 7200, 18000, 36000, 50400, 72000];
  v_delay   int;
begin
  if p_outcome not in ('succeeded', 'retry', 'failed', 'gone') then
    raise exception 'Unknown outcome' using errcode = '22023';
  end if;
  select * into v_del from public.webhook_deliveries
   where id = p_delivery and status = 'sending' and attempts = p_attempt
   for update;
  if v_del.id is null then
    return 'stale';
  end if;

  insert into public.webhook_delivery_attempts
    (delivery_id, organization_id, attempt, started_at, duration_ms, status_code, outcome, error_code)
  values
    (v_del.id, v_del.organization_id, p_attempt, p_started_at, p_duration_ms, p_status_code, p_outcome, p_error_code)
  on conflict on constraint webhook_delivery_attempts_once do nothing;

  v_final := case
    when p_outcome = 'succeeded' then 'succeeded'
    when p_outcome = 'retry' and v_del.attempts < v_del.max_attempts then 'queued'
    else 'failed' end;
  v_delay := greatest(
    coalesce(least(p_retry_after_seconds, 86400), 0),
    v_backoff[least(v_del.attempts, array_length(v_backoff, 1))]);

  update public.webhook_deliveries
     set status = v_final,
         lease_expires_at = null,
         last_status_code = p_status_code,
         last_error_code = case when v_final = 'succeeded' then null else p_error_code end,
         next_attempt_at = case when v_final = 'queued'
                                then now() + make_interval(secs => v_delay * (0.9 + random() * 0.2))
                                else next_attempt_at end,
         completed_at = case when v_final = 'queued' then null else now() end
   where id = v_del.id;

  if v_final = 'succeeded' then
    update public.webhook_endpoints set consecutive_failures = 0
     where id = v_del.endpoint_id and consecutive_failures <> 0;
  elsif p_outcome = 'gone' then
    update public.webhook_endpoints
       set enabled = false, disabled_reason = 'gone', revision = revision + 1
     where id = v_del.endpoint_id and enabled;
  elsif v_final = 'failed' then
    update public.webhook_endpoints
       set consecutive_failures = consecutive_failures + 1,
           enabled = case when consecutive_failures + 1 >= 5 then false else enabled end,
           disabled_reason = case when consecutive_failures + 1 >= 5 and enabled then 'failing' else disabled_reason end,
           revision = revision + 1
     where id = v_del.endpoint_id;
  end if;
  return v_final;
end;
$$;
revoke execute on function public.complete_webhook_delivery(uuid, int, text, int, text, timestamptz, int, int) from public, anon, authenticated;
grant execute on function public.complete_webhook_delivery(uuid, int, text, int, text, timestamptz, int, int) to service_role;

-- Retention: events (and their deliveries/attempts) older than 30 days once
-- nothing is waiting on them.
create or replace function public.prune_webhook_history(p_limit int default 500)
returns int
language sql
security definer
set search_path = ''
as $$
  with old as (
    select ev.id from public.webhook_events ev
     where ev.occurred_at < now() - interval '30 days'
       and not exists (select 1 from public.webhook_deliveries d
                        where d.event_id = ev.id and d.status in ('queued', 'sending'))
     order by ev.occurred_at
     limit greatest(1, least(p_limit, 5000))
  ), gone as (
    delete from public.webhook_events ev using old where ev.id = old.id returning 1
  )
  select count(*)::int from gone;
$$;
revoke execute on function public.prune_webhook_history(int) from public, anon, authenticated;
grant execute on function public.prune_webhook_history(int) to service_role;
