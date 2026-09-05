-- ============================================================================
-- Service Center — core schema
-- Domain: an organization runs recurring services. Each service is a "plan"
-- that has an order of items (songs, headers, free-form items) and a set of
-- people scheduled onto team positions.
-- ============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- ---------------------------------------------------------------- enums ----
create type public.org_role          as enum ('owner', 'admin', 'scheduler', 'member');
create type public.member_status     as enum ('invited', 'active', 'inactive');
create type public.plan_status       as enum ('draft', 'published', 'archived');
create type public.plan_time_kind    as enum ('service', 'rehearsal', 'other');
create type public.plan_item_type    as enum ('song', 'header', 'item');
create type public.assignment_status as enum ('unconfirmed', 'confirmed', 'declined');

-- ------------------------------------------------------------ utilities ----
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------- foundations ----
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  slug        text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  timezone    text not null default 'America/Toronto',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Mirrors auth.users so we can join profile data without touching the auth schema.
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  phone       text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.organization_members (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  role             public.org_role not null default 'member',
  status           public.member_status not null default 'active',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index on public.organization_members (user_id);
create index on public.organization_members (organization_id);

-- ------------------------------------------------------ teams & positions ---
create table public.service_types (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null,
  description      text,
  sort_order       int  not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, name)
);
create index on public.service_types (organization_id);

create table public.teams (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  service_type_id  uuid references public.service_types (id) on delete set null,
  name             text not null,
  color            text not null default '#6366f1',
  sort_order       int  not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, name)
);
create index on public.teams (organization_id);

create table public.team_positions (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  name        text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (team_id, name)
);
create index on public.team_positions (team_id);

create table public.team_memberships (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.teams (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  position_id  uuid references public.team_positions (id) on delete cascade,
  created_at   timestamptz not null default now()
);
-- A person may hold several positions on one team; NULLs need their own guard
-- because `unique` treats every NULL as distinct.
create unique index team_memberships_unique_position
  on public.team_memberships (team_id, user_id, position_id)
  where position_id is not null;
create unique index team_memberships_unique_no_position
  on public.team_memberships (team_id, user_id)
  where position_id is null;
create index on public.team_memberships (user_id);

-- --------------------------------------------------------------- songs -----
create table public.songs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  title            text not null check (length(trim(title)) > 0),
  author           text,
  ccli_number      text,
  copyright        text,
  default_key      text,
  default_bpm      int check (default_bpm is null or default_bpm between 20 and 300),
  meter            text,
  themes           text[] not null default '{}',
  notes            text,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index on public.songs (organization_id);
-- Supports the `ilike '%query%'` title search in GET /songs.
create index songs_title_trgm on public.songs using gin (title gin_trgm_ops);

create table public.arrangements (
  id                 uuid primary key default gen_random_uuid(),
  song_id            uuid not null references public.songs (id) on delete cascade,
  name               text not null default 'Default Arrangement',
  song_key           text,
  bpm                int check (bpm is null or bpm between 20 and 300),
  meter              text,
  length_seconds     int check (length_seconds is null or length_seconds >= 0),
  sequence           text[] not null default '{}',   -- e.g. {V1,C,V2,C,B,C}
  chord_chart        text,                            -- ChordPro
  chord_chart_format text not null default 'chordpro',
  is_default         boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index on public.arrangements (song_id);
create unique index arrangements_one_default_per_song
  on public.arrangements (song_id) where is_default;

-- --------------------------------------------------------------- plans -----
create table public.plans (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  service_type_id  uuid references public.service_types (id) on delete set null,
  title            text not null,
  service_date     timestamptz not null,
  location         text,
  status           public.plan_status not null default 'draft',
  notes            text,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index on public.plans (organization_id, service_date);
create index on public.plans (service_type_id);

-- Service + rehearsal times drive the calendar and the conflict checker.
create table public.plan_times (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references public.plans (id) on delete cascade,
  kind        public.plan_time_kind not null default 'service',
  name        text,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  created_at  timestamptz not null default now(),
  constraint plan_times_ordered check (ends_at > starts_at)
);
create index on public.plan_times (plan_id);
create index on public.plan_times (starts_at);

create table public.plan_items (
  id              uuid primary key default gen_random_uuid(),
  plan_id         uuid not null references public.plans (id) on delete cascade,
  item_type       public.plan_item_type not null default 'item',
  title           text not null,
  song_id         uuid references public.songs (id) on delete set null,
  arrangement_id  uuid references public.arrangements (id) on delete set null,
  key_override    text,
  length_seconds  int not null default 0 check (length_seconds >= 0),
  description     text,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- A "song" row must actually point at a song.
  constraint plan_items_song_ref check (item_type <> 'song' or song_id is not null)
);
create index on public.plan_items (plan_id, sort_order);

create table public.assignments (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references public.plans (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  team_id       uuid not null references public.teams (id) on delete cascade,
  position_id   uuid references public.team_positions (id) on delete set null,
  status        public.assignment_status not null default 'unconfirmed',
  notes         text,
  notified_at   timestamptz,
  responded_at  timestamptz,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index assignments_unique_position
  on public.assignments (plan_id, user_id, team_id, position_id)
  where position_id is not null;
create unique index assignments_unique_no_position
  on public.assignments (plan_id, user_id, team_id)
  where position_id is null;
create index on public.assignments (user_id, status);
create index on public.assignments (plan_id);

-- Dates a person has declared themselves unavailable.
create table public.blockouts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  reason           text,
  created_at       timestamptz not null default now(),
  constraint blockouts_ordered check (ends_at > starts_at)
);
create index on public.blockouts (user_id, starts_at, ends_at);
create index on public.blockouts (organization_id);

create table public.attachments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  song_id          uuid references public.songs (id) on delete cascade,
  arrangement_id   uuid references public.arrangements (id) on delete cascade,
  plan_id          uuid references public.plans (id) on delete cascade,
  storage_path     text not null,
  filename         text not null,
  mime_type        text,
  size_bytes       bigint,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index on public.attachments (organization_id);
create index on public.attachments (song_id);
create index on public.attachments (plan_id);

-- ------------------------------------------------------------ triggers -----
do $$
declare t text;
begin
  foreach t in array array[
    'organizations','profiles','organization_members','service_types','teams',
    'team_positions','songs','arrangements','plans','plan_items','assignments'
  ] loop
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- Every auth user gets a profile row automatically.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(public.profiles.full_name, excluded.full_name);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Responding to an invitation stamps the response time.
create or replace function public.stamp_assignment_response()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status and new.status <> 'unconfirmed' then
    new.responded_at = now();
  end if;
  return new;
end;
$$;

create trigger stamp_assignment_response
  before update on public.assignments
  for each row execute function public.stamp_assignment_response();
