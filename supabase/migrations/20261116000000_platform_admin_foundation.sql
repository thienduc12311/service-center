-- ============================================================================
-- Super-admin dashboard, part 1: tables and enum values.
-- Design: docs/plans/super-admin-dashboard.md
--
--   private.platform_admins          who runs the platform (added by SQL only)
--   platform_settings                one row: default storage quota, self-serve
--                                    church creation switch
--   organization_platform_controls   per church: active/disabled, quota override
--   church_applications              requests to register a new church
--   platform_audit_log               every super-admin action, append-only
--   member_status 'suspended'        members of a disabled church
--   organization_members.platform_access_expires_at
--                                    a super admin's temporary owner membership
--
-- Status and quota are not columns on organizations because owners and admins
-- can update every column of that row.
--
-- The functions that use 'suspended' are in 20261116000100: a new enum value
-- can't be used in the transaction that adds it.
-- ============================================================================

alter type public.member_status add value if not exists 'suspended';

create type public.organization_platform_status as enum ('active', 'disabled');
create type public.church_application_status as enum ('pending', 'approved', 'rejected', 'withdrawn');

-- --------------------------------------------------------- platform admins --

create table private.platform_admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  note        text check (note is null or char_length(note) <= 200),
  created_at  timestamptz not null default now()
);
comment on table private.platform_admins is
  'Super admins of the whole platform. Added by SQL only; see docs/operations/platform-admins.md.';
revoke all on private.platform_admins from public, anon, authenticated;
grant select on private.platform_admins to service_role;

create or replace function private.is_platform_admin(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.platform_admins a where a.user_id = p_user);
$$;
revoke execute on function private.is_platform_admin(uuid) from public, anon, authenticated;
grant execute on function private.is_platform_admin(uuid) to service_role;

-- ------------------------------------------------------- platform settings --

create table public.platform_settings (
  id                                boolean primary key default true
                                      constraint platform_settings_single_row check (id),
  default_storage_quota_bytes       bigint not null default 209715200
                                      check (default_storage_quota_bytes > 0),
  allow_self_serve_church_creation  boolean not null default false,
  updated_at                        timestamptz not null default now(),
  updated_by                        uuid references auth.users (id) on delete set null
);
comment on table public.platform_settings is
  'One row. Default media quota for churches without an override (200 MB) and whether signed-in users may create a church without an approved application.';
insert into public.platform_settings default values;

alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from anon, authenticated;
grant select, update on public.platform_settings to service_role;

create trigger platform_settings_updated_at before update on public.platform_settings
  for each row execute function public.set_updated_at();

-- -------------------------------------------- per-church platform controls --

create table public.organization_platform_controls (
  organization_id      uuid primary key references public.organizations (id) on delete cascade,
  status               public.organization_platform_status not null default 'active',
  disabled_reason      text,
  disabled_at          timestamptz,
  disabled_by          uuid references auth.users (id) on delete set null,
  -- Null: the platform default applies.
  storage_quota_bytes  bigint check (storage_quota_bytes is null or storage_quota_bytes > 0),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint organization_platform_controls_disabled_shape check (
    status <> 'disabled'
    or (disabled_at is not null and char_length(btrim(coalesce(disabled_reason, ''))) between 1 and 500)
  ),
  constraint organization_platform_controls_active_shape check (
    status = 'disabled' or (disabled_at is null and disabled_reason is null and disabled_by is null)
  )
);
comment on table public.organization_platform_controls is
  'Set by super admins only. Members read their church''s row for the disabled screen and the storage bar.';
create index organization_platform_controls_disabled_by_idx
  on public.organization_platform_controls (disabled_by) where disabled_by is not null;

alter table public.organization_platform_controls enable row level security;
create policy organization_platform_controls_select on public.organization_platform_controls
  for select to authenticated using (public.is_org_member(organization_id));
revoke all on public.organization_platform_controls from anon, authenticated;
grant select on public.organization_platform_controls to authenticated;
grant select, insert, update on public.organization_platform_controls to service_role;

create trigger organization_platform_controls_updated_at before update on public.organization_platform_controls
  for each row execute function public.set_updated_at();

-- Every church has exactly one controls row from the moment it exists.
create or replace function private.create_organization_platform_controls()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.organization_platform_controls (organization_id) values (new.id)
  on conflict (organization_id) do nothing;
  return null;
end;
$$;
revoke execute on function private.create_organization_platform_controls() from public, anon, authenticated;
create trigger organizations_create_platform_controls
  after insert on public.organizations
  for each row execute function private.create_organization_platform_controls();

-- --------------------------------------------------------- storage usage ---
-- A church's media is every Storage object under its id, plus pictures it
-- uploaded for roster people (avatars/orgs/<church>/...). Report exports are
-- temporary and personal pictures (avatars/users/...) belong to the person.

create or replace function private.storage_object_organization(p_bucket text, p_name text)
returns uuid language sql immutable set search_path = '' as $$
  select case
    when p_bucket = 'report-exports' then null
    when p_bucket = 'avatars' then
      case when split_part(p_name, '/', 1) = 'orgs'
                and split_part(p_name, '/', 2) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
           then split_part(p_name, '/', 2)::uuid end
    when split_part(p_name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then split_part(p_name, '/', 1)::uuid
  end;
$$;
revoke execute on function private.storage_object_organization(text, text) from public, anon;
grant execute on function private.storage_object_organization(text, text) to authenticated, service_role;

create or replace function private.organization_storage_used(p_org uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(coalesce((o.metadata ->> 'size')::bigint, 0)), 0)::bigint
    from storage.objects o
   where (o.bucket_id not in ('report-exports', 'avatars') and o.name like p_org::text || '/%')
      or (o.bucket_id = 'avatars' and o.name like 'orgs/' || p_org::text || '/%');
$$;
revoke execute on function private.organization_storage_used(uuid) from public, anon;
grant execute on function private.organization_storage_used(uuid) to authenticated, service_role;

-- Existing churches start active. One already over the 200 MB default keeps
-- working: its quota becomes its usage rounded up to the next 50 MB.
insert into public.organization_platform_controls (organization_id, storage_quota_bytes)
select o.id,
       case when u.used > 209715200 then ceil(u.used / 52428800.0)::bigint * 52428800 end
  from public.organizations o
 cross join lateral (select private.organization_storage_used(o.id) as used) u
on conflict (organization_id) do nothing;

-- ------------------------------------------------------ church applications --

create table public.church_applications (
  id                     uuid primary key default gen_random_uuid(),
  applicant_id           uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  status                 public.church_application_status not null default 'pending',
  church_name            text not null check (char_length(btrim(church_name)) between 1 and 120),
  leader_name            text not null check (char_length(btrim(leader_name)) between 1 and 120),
  contact_phone          text check (contact_phone is null or char_length(contact_phone) <= 40),
  website                text check (website is null or char_length(website) <= 300),
  address_line1          text check (address_line1 is null or char_length(address_line1) <= 200),
  address_line2          text check (address_line2 is null or char_length(address_line2) <= 200),
  city                   text not null check (char_length(btrim(city)) between 1 and 100),
  state_province         text check (state_province is null or char_length(state_province) <= 100),
  postal_code            text check (postal_code is null or char_length(postal_code) <= 20),
  country                text not null check (char_length(btrim(country)) between 1 and 100),
  expected_member_count  int check (expected_member_count is null or expected_member_count between 0 and 1000000),
  timezone               text not null default 'America/Toronto' check (char_length(timezone) between 1 and 64),
  note                   text check (note is null or char_length(note) <= 2000),
  rejection_reason       text check (rejection_reason is null or char_length(btrim(rejection_reason)) between 1 and 1000),
  reviewed_by            uuid references auth.users (id) on delete set null,
  reviewed_at            timestamptz,
  -- The church an approved application created.
  organization_id        uuid references public.organizations (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint church_applications_review_shape check (
    (status in ('approved', 'rejected')) = (reviewed_at is not null)
  ),
  constraint church_applications_rejection_shape check (
    (status = 'rejected') = (rejection_reason is not null)
  )
);
comment on table public.church_applications is
  'A signed-in person asks to register a church. A super admin approves (the church is created and the applicant becomes its owner) or rejects with a reason.';

-- One open application per person.
create unique index church_applications_one_pending
  on public.church_applications (applicant_id) where status = 'pending';
create index church_applications_applicant_idx on public.church_applications (applicant_id, created_at desc);
create index church_applications_status_idx on public.church_applications (status, created_at);
create index church_applications_reviewed_by_idx on public.church_applications (reviewed_by) where reviewed_by is not null;
create index church_applications_organization_idx on public.church_applications (organization_id) where organization_id is not null;

create trigger church_applications_updated_at before update on public.church_applications
  for each row execute function public.set_updated_at();

-- Withdrawing and re-applying in a loop would email the super admins each time.
create or replace function private.limit_church_applications()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.church_applications a
       where a.applicant_id = new.applicant_id and a.created_at > now() - interval '1 day') >= 5 then
    raise exception 'You have sent several applications today; try again tomorrow'
      using errcode = 'PT429', hint = 'rate_limited';
  end if;
  return new;
end;
$$;
revoke execute on function private.limit_church_applications() from public, anon, authenticated;
create trigger church_applications_limit before insert on public.church_applications
  for each row execute function private.limit_church_applications();

alter table public.church_applications enable row level security;

create policy church_applications_select on public.church_applications
  for select to authenticated using (applicant_id = (select auth.uid()));
create policy church_applications_insert on public.church_applications
  for insert to authenticated with check (applicant_id = (select auth.uid()) and status = 'pending');
-- The applicant edits or withdraws a pending application; review is service role only.
create policy church_applications_update on public.church_applications
  for update to authenticated
  using (applicant_id = (select auth.uid()) and status = 'pending')
  with check (applicant_id = (select auth.uid()) and status in ('pending', 'withdrawn'));

revoke all on public.church_applications from anon, authenticated;
-- reviewed_by is not readable: the applicant doesn't learn which admin decided.
grant select (id, applicant_id, status, church_name, leader_name, contact_phone, website,
              address_line1, address_line2, city, state_province, postal_code, country,
              expected_member_count, timezone, note, rejection_reason, reviewed_at,
              organization_id, created_at, updated_at)
  on public.church_applications to authenticated;
grant insert (church_name, leader_name, contact_phone, website, address_line1, address_line2, city,
              state_province, postal_code, country, expected_member_count, timezone, note)
  on public.church_applications to authenticated;
grant update (church_name, leader_name, contact_phone, website, address_line1, address_line2, city,
              state_province, postal_code, country, expected_member_count, timezone, note, status)
  on public.church_applications to authenticated;
grant select, insert, update on public.church_applications to service_role;

-- -------------------------------------------------------- platform audit ----

create table public.platform_audit_log (
  id              bigint generated always as identity primary key,
  -- Null when the platform did it (an expired access window was removed).
  actor_id        uuid references auth.users (id) on delete set null,
  action          text not null check (action ~ '^[a-z_]+\.[a-z_]+$'),
  -- No foreign keys: the record outlives the church and the application.
  organization_id uuid,
  application_id  uuid,
  details         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
comment on table public.platform_audit_log is
  'Append-only record of super-admin actions. Read in the admin dashboard''s Activity page.';
create index platform_audit_log_created_idx on public.platform_audit_log (created_at desc);
create index platform_audit_log_organization_idx
  on public.platform_audit_log (organization_id, created_at desc) where organization_id is not null;
create index platform_audit_log_actor_idx on public.platform_audit_log (actor_id) where actor_id is not null;

alter table public.platform_audit_log enable row level security;
revoke all on public.platform_audit_log from anon, authenticated;
revoke update, delete, truncate on public.platform_audit_log from service_role;
grant select, insert on public.platform_audit_log to service_role;

-- --------------------------------------------- temporary owner membership ---

alter table public.organization_members
  add column platform_access_expires_at timestamptz,
  add constraint organization_members_platform_access_shape check (
    platform_access_expires_at is null or role = 'owner'
  );
comment on column public.organization_members.platform_access_expires_at is
  'Set only on a super admin''s temporary owner membership ("enter as owner"); the row is removed on exit or expiry.';
create index organization_members_platform_access_idx
  on public.organization_members (platform_access_expires_at) where platform_access_expires_at is not null;
