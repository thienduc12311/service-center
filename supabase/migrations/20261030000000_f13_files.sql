-- ============================================================================
-- F13 — versioned attachments and enforced file audiences.
--
-- Ownership
--   `attachments` (the existing table) is now one logical file. Every file has
--   exactly one primary owner, named by `owner_kind`:
--     plan          plan_id
--     plan_item     plan_id + plan_item_id (an item of that plan)
--     song          song_id
--     arrangement   song_id + arrangement_id (an arrangement of that song)
--     service_type  service_type_id (a default file of the service type)
--   Composite foreign keys keep every parent in the file's organization and
--   every child under its own parent. Labeled keys wait for F15 key records.
--   Reuse is explicit: `attachment_links` puts a library (song/arrangement)
--   or service-type default file on a plan or item, optionally pinned to one
--   version. A link never widens the audience: who may read a linked file is
--   still decided by the file's own audience. Unlinking never deletes the
--   source; a file that is linked anywhere cannot be deleted (archive it).
--
-- Versions
--   `attachment_versions` rows are immutable once ready. Uploads follow
--   intent → upload → finalize: the intent creates a *pending* version with
--   an exact object path, declared size/type and an expiry; the caller's
--   Storage INSERT is allowed only for that path while the intent is live;
--   finalize compares the stored object's real size and content type with the
--   intent before the version becomes ready and current. A mismatch, an
--   expired intent or a replacement that raced another one marks the version
--   failed/expired and queues its bytes for removal; nothing partial is ever
--   shown as a file. Finalize is idempotent. Version numbers are assigned at
--   finalize, under the file's row lock.
--
-- Audiences (decided here, for metadata, versions and raw Storage objects)
--   writers   plan/item: plans.edit on the plan; song/arrangement: songs.manage;
--             service type: plans.edit at that service type; media.manage
--             (organization) everywhere. Writers see every file and version.
--   leaders   writers plus scheduling.manage at the plan's/service type's scope.
--   organization  every active member
--   scheduled     released, not-declined request on the owner plan (plan and
--                 item files only). Prepared requests never count.
--   teams         members of a chosen team, people scheduled on it for the
--                 owner plan, and its leaders
--   positions     holders of a chosen position (team roster), people scheduled
--                 in it on the owner plan, and the team's leaders
--   leaders       leaders only
--   Readers see a file's current version while it is not archived, plus any
--   version a plan link pins. Old unpinned versions are writer-only.
--
-- Storage
--   The organization-wide "org members read attachments" policy is replaced:
--   an object in the `attachments` bucket is readable only if its version is
--   readable under the rules above, so a guessed path returns nothing. Writes
--   are allowed only for the caller's own live upload intent; there is no
--   client UPDATE/DELETE. Signed download URLs are issued with the caller's
--   token, so issuance is checked by the same policy. Removal of failed,
--   expired and deleted bytes is a service-role job (`attachment_object_removals`).
--
-- Compatibility
--   Existing rows become version 1 (ready, audience organization), keeping
--   their current readers. The legacy columns storage_path/filename/mime_type/
--   size_bytes mirror the current version. Direct table writes (which no
--   client used) are replaced by the functions below. Song books keep their
--   own bucket and policies.
-- ============================================================================

-- ------------------------------------------------------------- enums -------

create type public.file_owner_kind as enum ('plan', 'plan_item', 'song', 'arrangement', 'service_type');
create type public.file_audience as enum ('organization', 'scheduled', 'teams', 'positions', 'leaders');
create type public.file_kind as enum ('upload', 'link', 'document');
create type public.file_category as enum ('chart', 'lyrics', 'audio', 'video', 'image', 'document', 'other');
create type public.file_version_status as enum ('pending', 'ready', 'failed', 'expired');

-- Composite targets so children can only name parents of the same tenant.
create unique index if not exists songs_id_org_key on public.songs (id, organization_id);
create unique index if not exists arrangements_id_song_key on public.arrangements (id, song_id);

-- -------------------------------------------------------- attachments -----

alter table public.attachments
  alter column storage_path drop not null,
  add column owner_kind       public.file_owner_kind,
  add column plan_item_id     uuid,
  add column service_type_id  uuid,
  add column kind             public.file_kind not null default 'upload',
  add column title            text,
  add column category         public.file_category not null default 'other',
  add column audience         public.file_audience not null default 'organization',
  add column external_url     text,
  add column current_version_id uuid,
  add column revision         bigint not null default 1,
  add column archived_at      timestamptz,
  add column archived_by      uuid references public.profiles (id) on delete set null,
  add column updated_by       uuid references public.profiles (id) on delete set null,
  add column updated_at       timestamptz not null default now();

-- Backfill the owner of existing rows. A row naming both a song and a plan is
-- owned by the song (the library) and keeps the plan association as a link.
do $$
begin
  if exists (select 1 from public.attachments where song_id is null and arrangement_id is null and plan_id is null) then
    raise exception 'F13: attachments without any parent exist; assign or remove them before applying this migration';
  end if;
end $$;

update public.attachments a
   set song_id = ar.song_id
  from public.arrangements ar
 where a.arrangement_id = ar.id and a.song_id is distinct from ar.song_id;

update public.attachments
   set owner_kind = case
         when arrangement_id is not null then 'arrangement'::public.file_owner_kind
         when song_id is not null then 'song'::public.file_owner_kind
         else 'plan'::public.file_owner_kind end,
       title = left(btrim(filename), 200);

-- Plan associations of library-owned rows, moved to links below.
create temporary table f13_legacy_plan_links on commit drop as
  select id as attachment_id, organization_id, plan_id
    from public.attachments
   where owner_kind in ('song', 'arrangement') and plan_id is not null;
update public.attachments set plan_id = null where owner_kind in ('song', 'arrangement');

alter table public.attachments
  alter column owner_kind set not null,
  alter column title set not null;

create unique index attachments_id_org_key on public.attachments (id, organization_id);

alter table public.attachments
  add constraint attachments_plan_fk foreign key (plan_id, organization_id)
    references public.plans (id, organization_id) on delete cascade,
  add constraint attachments_item_fk foreign key (plan_item_id, plan_id)
    references public.plan_items (id, plan_id) on delete cascade,
  add constraint attachments_song_fk foreign key (song_id, organization_id)
    references public.songs (id, organization_id) on delete cascade,
  add constraint attachments_arrangement_fk foreign key (arrangement_id, song_id)
    references public.arrangements (id, song_id) on delete cascade,
  add constraint attachments_service_type_fk foreign key (service_type_id, organization_id)
    references public.service_types (id, organization_id) on delete cascade,
  add constraint attachments_owner_shape check (case owner_kind
    when 'plan' then plan_id is not null and plan_item_id is null and song_id is null
                     and arrangement_id is null and service_type_id is null
    when 'plan_item' then plan_id is not null and plan_item_id is not null and song_id is null
                     and arrangement_id is null and service_type_id is null
    when 'song' then song_id is not null and arrangement_id is null and plan_id is null
                     and plan_item_id is null and service_type_id is null
    when 'arrangement' then song_id is not null and arrangement_id is not null and plan_id is null
                     and plan_item_id is null and service_type_id is null
    when 'service_type' then service_type_id is not null and plan_id is null and plan_item_id is null
                     and song_id is null and arrangement_id is null
  end),
  add constraint attachments_kind_shape check (case kind
    when 'link' then external_url is not null and storage_path is null
    else external_url is null end),
  add constraint attachments_external_url check (
    external_url is null or (char_length(external_url) <= 2000 and external_url ~* '^https?://[^\s/@]+(/[^\s]*)?$')
  ),
  add constraint attachments_title_length check (char_length(btrim(title)) between 1 and 200),
  -- "Scheduled on the plan" only means something for plan files.
  add constraint attachments_audience_owner check (
    audience <> 'scheduled' or owner_kind in ('plan', 'plan_item')
  ),
  add constraint attachments_archive_shape check (archived_by is null or archived_at is not null);

create index attachments_item_idx on public.attachments (plan_item_id) where plan_item_id is not null;
create index attachments_service_type_idx on public.attachments (service_type_id) where service_type_id is not null;
create index attachments_archived_by_idx on public.attachments (archived_by) where archived_by is not null;
create index attachments_updated_by_idx on public.attachments (updated_by) where updated_by is not null;

-- ------------------------------------------------------------ versions -----

create table public.attachment_versions (
  id                uuid primary key default gen_random_uuid(),
  attachment_id     uuid not null references public.attachments (id) on delete cascade,
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  -- Assigned when the version becomes ready.
  version_number    int check (version_number is null or version_number > 0),
  status            public.file_version_status not null default 'pending',
  -- Null for text documents (their content is the body below).
  storage_path      text unique,
  filename          text not null check (char_length(filename) between 1 and 200),
  mime_type         text not null check (char_length(mime_type) between 1 and 200),
  declared_size     bigint not null check (declared_size between 0 and 26214400),
  -- What Storage actually holds, recorded at finalize.
  size_bytes        bigint,
  document_body     text check (document_body is null or char_length(document_body) <= 100000),
  -- The file's current version when the upload was requested; a replacement
  -- that finalizes after another version became current is refused.
  base_version_id   uuid,
  idempotency_key   text check (idempotency_key is null or char_length(idempotency_key) between 1 and 200),
  upload_expires_at timestamptz,
  failure_reason    text,
  finalized_at      timestamptz,
  finalized_by      uuid references public.profiles (id) on delete set null,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint attachment_versions_number_key unique (attachment_id, version_number),
  constraint attachment_versions_id_attachment_key unique (id, attachment_id),
  constraint attachment_versions_body_shape check ((storage_path is null) = (document_body is not null)),
  constraint attachment_versions_ready_shape check (
    status <> 'ready' or (version_number is not null and finalized_at is not null and size_bytes is not null)
  ),
  constraint attachment_versions_pending_shape check (
    status <> 'pending' or (version_number is null and upload_expires_at is not null)
  ),
  constraint attachment_versions_path_shape check (
    storage_path is null or storage_path like (organization_id::text || '/' || attachment_id::text || '/%')
  )
);
create unique index attachment_versions_idempotency_key
  on public.attachment_versions (organization_id, created_by, idempotency_key) where idempotency_key is not null;
create index attachment_versions_attachment_idx on public.attachment_versions (attachment_id, created_at desc);
create index attachment_versions_pending_due_idx on public.attachment_versions (upload_expires_at) where status = 'pending';
create index attachment_versions_organization_idx on public.attachment_versions (organization_id);
create index attachment_versions_created_by_idx on public.attachment_versions (created_by);
create index attachment_versions_finalized_by_idx on public.attachment_versions (finalized_by) where finalized_by is not null;

alter table public.attachments
  add constraint attachments_current_version_fk foreign key (current_version_id, id)
    references public.attachment_versions (id, attachment_id);
create index attachments_current_version_idx on public.attachments (current_version_id) where current_version_id is not null;

-- Ready versions never change; pending ones only move to ready/failed/expired.
create or replace function private.guard_attachment_version_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.attachment_id <> old.attachment_id or new.organization_id <> old.organization_id
     or new.storage_path is distinct from old.storage_path or new.filename <> old.filename
     or new.mime_type <> old.mime_type or new.declared_size <> old.declared_size
     or new.document_body is distinct from old.document_body or new.base_version_id is distinct from old.base_version_id
     or new.idempotency_key is distinct from old.idempotency_key or new.created_by is distinct from old.created_by
     or new.created_at <> old.created_at then
    raise exception 'A file version cannot be changed' using errcode = 'PT409';
  end if;
  if old.status <> 'pending' then
    -- Only a profile removal (finalized_by → null) may touch a settled version.
    if new.status <> old.status or new.version_number is distinct from old.version_number
       or new.size_bytes is distinct from old.size_bytes or new.finalized_at is distinct from old.finalized_at
       or new.failure_reason is distinct from old.failure_reason or new.upload_expires_at is distinct from old.upload_expires_at
       or (new.finalized_by is not null and new.finalized_by is distinct from old.finalized_by) then
      raise exception 'A file version cannot be changed' using errcode = 'PT409';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function private.guard_attachment_version_update() from public, anon, authenticated;
create trigger attachment_versions_guard before update on public.attachment_versions
  for each row execute function private.guard_attachment_version_update();

-- -------------------------------------------------------------- links ------

create table public.attachment_links (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  attachment_id     uuid not null,
  plan_id           uuid not null,
  plan_item_id      uuid,
  -- Null follows the file's current version; otherwise this exact version.
  pinned_version_id uuid,
  source            text not null default 'manual' check (source in ('manual', 'service_type_default')),
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint attachment_links_attachment_fk foreign key (attachment_id, organization_id)
    references public.attachments (id, organization_id) on delete cascade,
  constraint attachment_links_plan_fk foreign key (plan_id, organization_id)
    references public.plans (id, organization_id) on delete cascade,
  constraint attachment_links_item_fk foreign key (plan_item_id, plan_id)
    references public.plan_items (id, plan_id) on delete cascade,
  constraint attachment_links_version_fk foreign key (pinned_version_id, attachment_id)
    references public.attachment_versions (id, attachment_id) on delete cascade
);
create unique index attachment_links_target_key
  on public.attachment_links (attachment_id, plan_id, plan_item_id) nulls not distinct;
create index attachment_links_plan_idx on public.attachment_links (plan_id, plan_item_id);
create index attachment_links_item_idx on public.attachment_links (plan_item_id) where plan_item_id is not null;
create index attachment_links_version_idx on public.attachment_links (pinned_version_id) where pinned_version_id is not null;
create index attachment_links_organization_idx on public.attachment_links (organization_id);
create index attachment_links_created_by_idx on public.attachment_links (created_by);

-- Legacy plan associations of library rows.
insert into public.attachment_links (organization_id, attachment_id, plan_id)
select organization_id, attachment_id, plan_id from f13_legacy_plan_links
on conflict do nothing;

-- ------------------------------------------------------ audience targets ---

create table public.attachment_audience_targets (
  id                uuid primary key default gen_random_uuid(),
  attachment_id     uuid not null,
  organization_id   uuid not null,
  team_id           uuid,
  position_id       uuid references public.team_positions (id) on delete cascade,
  constraint attachment_audience_targets_attachment_fk foreign key (attachment_id, organization_id)
    references public.attachments (id, organization_id) on delete cascade,
  constraint attachment_audience_targets_team_fk foreign key (team_id, organization_id)
    references public.teams (id, organization_id) on delete cascade,
  constraint attachment_audience_targets_one check (num_nonnulls(team_id, position_id) = 1)
);
create unique index attachment_audience_targets_team_key
  on public.attachment_audience_targets (attachment_id, team_id) where team_id is not null;
create unique index attachment_audience_targets_position_key
  on public.attachment_audience_targets (attachment_id, position_id) where position_id is not null;
create index attachment_audience_targets_team_idx on public.attachment_audience_targets (team_id) where team_id is not null;
create index attachment_audience_targets_position_idx on public.attachment_audience_targets (position_id) where position_id is not null;
create index attachment_audience_targets_organization_idx on public.attachment_audience_targets (organization_id);

-- ---------------------------------------------------- object removals -----
-- Bytes of failed, expired and deleted versions. Only the service role reads
-- or writes this; the worker removes the objects through the Storage API.

create table public.attachment_object_removals (
  id            bigint generated always as identity primary key,
  bucket_id     text not null default 'attachments',
  object_path   text not null,
  reason        text not null,
  enqueued_at   timestamptz not null default now(),
  attempts      int not null default 0,
  leased_until  timestamptz,
  last_error    text,
  removed_at    timestamptz,
  constraint attachment_object_removals_path_key unique (bucket_id, object_path)
);
create index attachment_object_removals_due_idx on public.attachment_object_removals (enqueued_at) where removed_at is null;

create or replace function private.queue_attachment_object_removal()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.storage_path is not null then
      insert into public.attachment_object_removals (object_path, reason)
      values (old.storage_path, 'deleted') on conflict (bucket_id, object_path) do nothing;
    end if;
    return old;
  end if;
  if new.storage_path is not null and old.status = 'pending' and new.status in ('failed', 'expired') then
    insert into public.attachment_object_removals (object_path, reason)
    values (new.storage_path, new.status::text) on conflict (bucket_id, object_path) do nothing;
  end if;
  return new;
end;
$$;
revoke execute on function private.queue_attachment_object_removal() from public, anon, authenticated;
create trigger attachment_versions_queue_removal after update of status or delete on public.attachment_versions
  for each row execute function private.queue_attachment_object_removal();

-- ------------------------------------------------- legacy version rows -----

insert into public.attachment_versions (
  attachment_id, organization_id, version_number, status, storage_path, filename, mime_type,
  declared_size, size_bytes, base_version_id, finalized_at, finalized_by, created_by, created_at
)
select a.id, a.organization_id, 1, 'ready', a.storage_path, left(coalesce(nullif(btrim(a.filename), ''), 'file'), 200),
       coalesce(nullif(a.mime_type, ''), 'application/octet-stream'),
       least(greatest(coalesce(a.size_bytes, 0), 0), 26214400), greatest(coalesce(a.size_bytes, 0), 0),
       null, a.created_at, a.created_by, a.created_by, a.created_at
  from public.attachments a
 where a.storage_path is not null;

update public.attachments a
   set current_version_id = v.id
  from public.attachment_versions v
 where v.attachment_id = a.id and v.version_number = 1;

-- ============================================================ policies =====

create or replace function private.file_writer(
  p_user uuid, p_org uuid, p_owner public.file_owner_kind, p_plan uuid, p_service_type uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_active_member(p_user, p_org) and (
    private.capability_for(p_user, p_org, 'media.manage', null, null)
    or case p_owner
         when 'plan' then private.can_edit_plan(p_user, p_plan)
         when 'plan_item' then private.can_edit_plan(p_user, p_plan)
         when 'song' then private.capability_for(p_user, p_org, 'songs.manage', null, null)
         when 'arrangement' then private.capability_for(p_user, p_org, 'songs.manage', null, null)
         when 'service_type' then private.capability_for(p_user, p_org, 'plans.edit', p_service_type, null)
       end
  );
$$;

create or replace function private.file_leader(
  p_user uuid, p_org uuid, p_owner public.file_owner_kind, p_plan uuid, p_service_type uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.file_writer(p_user, p_org, p_owner, p_plan, p_service_type)
      or (p_owner in ('plan', 'plan_item') and private.is_plan_leader(p_user, p_plan))
      or (p_owner = 'service_type'
          and private.capability_for(p_user, p_org, 'scheduling.manage', p_service_type, null));
$$;

-- Holds the position on the team roster, or is scheduled in it (released,
-- not declined) on the given plan.
create or replace function private.holds_position(p_user uuid, p_position uuid, p_plan uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user is not null and (
    exists (
      select 1 from public.team_memberships tm
        join public.people pe on pe.id = tm.person_id
       where tm.position_id = p_position and pe.profile_id = p_user and pe.archived_at is null)
    or (p_plan is not null and exists (
      select 1 from public.assignments a
        join public.people pe on pe.id = a.person_id
       where a.plan_id = p_plan and a.position_id = p_position and pe.profile_id = p_user
         and pe.archived_at is null and a.visibility = 'released' and a.status <> 'declined'))
  );
$$;

-- The audience rule alone (the caller is already known to be an active member).
create or replace function private.file_audience_ok(p_user uuid, p_attachment uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case a.audience
      when 'organization' then true
      when 'leaders' then private.file_leader(p_user, a.organization_id, a.owner_kind, a.plan_id, a.service_type_id)
      when 'scheduled' then private.is_scheduled_on_plan(p_user, a.plan_id, null)
                         or private.file_leader(p_user, a.organization_id, a.owner_kind, a.plan_id, a.service_type_id)
      when 'teams' then private.file_leader(p_user, a.organization_id, a.owner_kind, a.plan_id, a.service_type_id)
        or exists (
          select 1 from public.attachment_audience_targets t
           where t.attachment_id = a.id and t.team_id is not null
             and (private.is_on_team(p_user, t.team_id)
                  or private.can_manage_team(p_user, t.team_id)
                  or (a.plan_id is not null and (private.is_scheduled_on_plan(p_user, a.plan_id, t.team_id)
                                                 or private.can_schedule_on_plan(p_user, a.plan_id, t.team_id)))))
      when 'positions' then private.file_leader(p_user, a.organization_id, a.owner_kind, a.plan_id, a.service_type_id)
        or exists (
          select 1 from public.attachment_audience_targets t
            join public.team_positions tp on tp.id = t.position_id
           where t.attachment_id = a.id and t.position_id is not null
             and (private.holds_position(p_user, t.position_id, a.plan_id)
                  or private.can_manage_team(p_user, tp.team_id)
                  or (a.plan_id is not null and private.can_schedule_on_plan(p_user, a.plan_id, tp.team_id))))
    end
      from public.attachments a where a.id = p_attachment
  ), false);
$$;

create or replace function private.can_write_attachment(p_user uuid, p_attachment uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select private.file_writer(p_user, a.organization_id, a.owner_kind, a.plan_id, a.service_type_id)
      from public.attachments a where a.id = p_attachment
  ), false);
$$;

-- File metadata: writers always; readers once a version is ready, while the
-- file is not archived or through a pinned link.
create or replace function private.can_read_attachment(p_user uuid, p_attachment uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select private.is_active_member(p_user, a.organization_id) and (
      private.file_writer(p_user, a.organization_id, a.owner_kind, a.plan_id, a.service_type_id)
      or ((a.current_version_id is not null or a.kind = 'link')
          and (a.archived_at is null
               or exists (select 1 from public.attachment_links l
                           where l.attachment_id = a.id and l.pinned_version_id is not null))
          and private.file_audience_ok(p_user, a.id))
    )
      from public.attachments a where a.id = p_attachment
  ), false);
$$;

-- One version (and its bytes): writers any version; readers a ready version
-- that is current on a live file or pinned by a plan link.
create or replace function private.can_read_attachment_version(p_user uuid, p_version uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select private.is_active_member(p_user, a.organization_id) and (
      private.file_writer(p_user, a.organization_id, a.owner_kind, a.plan_id, a.service_type_id)
      or (v.status = 'ready'
          and ((v.id = a.current_version_id and a.archived_at is null)
               or exists (select 1 from public.attachment_links l where l.pinned_version_id = v.id))
          and private.file_audience_ok(p_user, a.id))
    )
      from public.attachment_versions v
      join public.attachments a on a.id = v.attachment_id
     where v.id = p_version
  ), false);
$$;

create or replace function private.can_read_attachment_object(p_user uuid, p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select private.can_read_attachment_version(p_user, v.id)
      from public.attachment_versions v where v.storage_path = p_name
  ), false);
$$;

-- The exact path of the caller's own live upload intent, while they can still write.
create or replace function private.can_upload_attachment_object(p_user uuid, p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select v.status = 'pending' and v.created_by = p_user and v.upload_expires_at > now()
       and private.can_write_attachment(p_user, v.attachment_id)
      from public.attachment_versions v where v.storage_path = p_name
  ), false);
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'private.file_writer(uuid, uuid, public.file_owner_kind, uuid, uuid)',
    'private.file_leader(uuid, uuid, public.file_owner_kind, uuid, uuid)',
    'private.holds_position(uuid, uuid, uuid)',
    'private.file_audience_ok(uuid, uuid)',
    'private.can_write_attachment(uuid, uuid)',
    'private.can_read_attachment(uuid, uuid)',
    'private.can_read_attachment_version(uuid, uuid)',
    'private.can_read_attachment_object(uuid, text)',
    'private.can_upload_attachment_object(uuid, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- ------------------------------------------------------------ table RLS ----

drop policy if exists attachments_select on public.attachments;
drop policy if exists attachments_write on public.attachments;
create policy attachments_select on public.attachments
  for select to authenticated
  using ((select private.can_read_attachment((select auth.uid()), id)));

alter table public.attachment_versions enable row level security;
create policy attachment_versions_select on public.attachment_versions
  for select to authenticated
  using ((select private.can_read_attachment_version((select auth.uid()), id)));

alter table public.attachment_links enable row level security;
create policy attachment_links_select on public.attachment_links
  for select to authenticated
  using ((select private.can_read_attachment((select auth.uid()), attachment_id)));

alter table public.attachment_audience_targets enable row level security;
create policy attachment_audience_targets_select on public.attachment_audience_targets
  for select to authenticated
  using ((select private.can_read_attachment((select auth.uid()), attachment_id)));

alter table public.attachment_object_removals enable row level security;

-- Every write goes through the functions below.
revoke insert, update, delete, truncate on public.attachments, public.attachment_versions,
  public.attachment_links, public.attachment_audience_targets from authenticated;
revoke all on public.attachments, public.attachment_versions, public.attachment_links,
  public.attachment_audience_targets, public.attachment_object_removals from anon;
revoke all on public.attachment_object_removals from authenticated;
grant select on public.attachments, public.attachment_versions, public.attachment_links,
  public.attachment_audience_targets to authenticated;
grant all on public.attachments, public.attachment_versions, public.attachment_links,
  public.attachment_audience_targets, public.attachment_object_removals to service_role;

-- -------------------------------------------------------------- Storage ----

drop policy if exists "org members read attachments" on storage.objects;
drop policy if exists "media managers write attachments" on storage.objects;
drop policy if exists "media managers delete attachments" on storage.objects;

create policy "file audience reads attachments" on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments' and private.can_read_attachment_object((select auth.uid()), name));

create policy "upload intent writes attachments" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments' and private.can_upload_attachment_object((select auth.uid()), name));

-- The bucket accepts only the types the API offers (same list as the shared
-- FILE_MIME_TYPES constant); existing objects are unaffected.
update storage.buckets
   set allowed_mime_types = array[
         'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic',
         'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/flac',
         'video/mp4', 'video/quicktime', 'video/webm',
         'text/plain', 'text/markdown',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.openxmlformats-officedocument.presentationml.presentation',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'application/vnd.recordare.musicxml+xml', 'application/vnd.recordare.musicxml'],
       file_size_limit = 26214400
 where id = 'attachments';

-- ========================================================== functions ======

create or replace function private.file_allowed_mime(p_mime text)
returns boolean language sql immutable set search_path = '' as $$
  select p_mime = any (array[
    'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic',
    'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/flac',
    'video/mp4', 'video/quicktime', 'video/webm',
    'text/plain', 'text/markdown',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.recordare.musicxml+xml', 'application/vnd.recordare.musicxml']);
$$;

-- A path segment that is safe in object keys and URLs.
create or replace function private.file_safe_name(p_filename text)
returns text language sql immutable set search_path = '' as $$
  select coalesce(nullif(left(btrim(regexp_replace(lower(p_filename), '[^a-z0-9._-]+', '-', 'g'), '-.'), 100), ''), 'file');
$$;

-- Resolves an owner reference to (organization, plan, item, song,
-- arrangement, service type). Unknown or invisible parents are "not found".
create or replace function private.resolve_file_owner(p_kind public.file_owner_kind, p_owner uuid,
  out organization_id uuid, out plan_id uuid, out plan_item_id uuid, out song_id uuid,
  out arrangement_id uuid, out service_type_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  case p_kind
    when 'plan' then
      select p.organization_id, p.id into organization_id, plan_id from public.plans p where p.id = p_owner;
    when 'plan_item' then
      select p.organization_id, p.id, i.id into organization_id, plan_id, plan_item_id
        from public.plan_items i join public.plans p on p.id = i.plan_id where i.id = p_owner;
    when 'song' then
      select s.organization_id, s.id into organization_id, song_id from public.songs s where s.id = p_owner;
    when 'arrangement' then
      select s.organization_id, s.id, ar.id into organization_id, song_id, arrangement_id
        from public.arrangements ar join public.songs s on s.id = ar.song_id where ar.id = p_owner;
    when 'service_type' then
      select st.organization_id, st.id into organization_id, service_type_id
        from public.service_types st where st.id = p_owner;
  end case;
  if organization_id is null then
    raise exception 'That parent was not found' using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function private.resolve_file_owner(public.file_owner_kind, uuid) from public, anon, authenticated;

-- Replaces a file's audience targets after validating them against the file's
-- organization and (for plan-only positions) its plan.
create or replace function private.set_file_audience_targets(
  p_attachment uuid, p_audience public.file_audience, p_team_ids uuid[], p_position_ids uuid[]
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_file  public.attachments;
  v_teams uuid[] := coalesce((select array_agg(distinct t) from unnest(coalesce(p_team_ids, '{}')) t where t is not null), '{}');
  v_positions uuid[] := coalesce((select array_agg(distinct t) from unnest(coalesce(p_position_ids, '{}')) t where t is not null), '{}');
begin
  select * into v_file from public.attachments where id = p_attachment;
  if p_audience = 'teams' and cardinality(v_teams) = 0 then
    raise exception 'Choose at least one team' using errcode = '22023';
  end if;
  if p_audience = 'positions' and cardinality(v_positions) = 0 then
    raise exception 'Choose at least one position' using errcode = '22023';
  end if;
  if p_audience <> 'teams' then v_teams := '{}'; end if;
  if p_audience <> 'positions' then v_positions := '{}'; end if;
  if cardinality(v_teams) > 50 or cardinality(v_positions) > 100 then
    raise exception 'Choose at most 50 teams or 100 positions' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_teams) t
              where not exists (select 1 from public.teams tt where tt.id = t and tt.organization_id = v_file.organization_id)) then
    raise exception 'Team not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from unnest(v_positions) t
              where not exists (
                select 1 from public.team_positions tp join public.teams tt on tt.id = tp.team_id
                 where tp.id = t and tt.organization_id = v_file.organization_id
                   and (tp.plan_id is null or tp.plan_id = v_file.plan_id))) then
    raise exception 'Position not found' using errcode = 'P0002';
  end if;

  delete from public.attachment_audience_targets where attachment_id = p_attachment;
  insert into public.attachment_audience_targets (attachment_id, organization_id, team_id)
  select p_attachment, v_file.organization_id, t from unnest(v_teams) t;
  insert into public.attachment_audience_targets (attachment_id, organization_id, position_id)
  select p_attachment, v_file.organization_id, t from unnest(v_positions) t;
end;
$$;
revoke execute on function private.set_file_audience_targets(uuid, public.file_audience, uuid[], uuid[]) from public, anon, authenticated;

create or replace function private.file_json(p_attachment uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(a) from public.attachments a where a.id = p_attachment;
$$;
revoke execute on function private.file_json(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------- upload intent --
-- New file (p_attachment null) or replacement of an upload file. Returns the
-- file, the pending version and whether this was a replay of the same key.
create or replace function public.create_file_upload_intent(
  p_owner_kind         public.file_owner_kind,
  p_owner_id           uuid,
  p_attachment         uuid,
  p_expected_revision  bigint,
  p_filename           text,
  p_mime_type          text,
  p_size_bytes         bigint,
  p_title              text,
  p_category           public.file_category,
  p_audience           public.file_audience,
  p_team_ids           uuid[],
  p_position_ids       uuid[],
  p_idempotency_key    text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := (select auth.uid());
  v_owner    record;
  v_file     public.attachments;
  v_version  public.attachment_versions;
  v_name     text := btrim(coalesce(p_filename, ''));
  v_title    text;
  v_org      uuid;
  v_id       uuid := gen_random_uuid();
  v_version_id uuid := gen_random_uuid();
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if char_length(coalesce(p_idempotency_key, '')) not between 1 and 200 then
    raise exception 'A request id is required' using errcode = '22023';
  end if;
  if char_length(v_name) not between 1 and 200 then
    raise exception 'The file name must be 1–200 characters' using errcode = '22023';
  end if;
  if not private.file_allowed_mime(p_mime_type) then
    raise exception 'That file type is not supported' using errcode = '22023';
  end if;
  if p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 26214400 then
    raise exception 'Files must be between 1 byte and 25 MB' using errcode = '22023';
  end if;

  if p_attachment is not null then
    select organization_id into v_org from public.attachments where id = p_attachment;
    if v_org is null then
      raise exception 'File not found' using errcode = 'P0002';
    end if;
  else
    select f.organization_id into v_org from private.resolve_file_owner(p_owner_kind, p_owner_id) f;
  end if;

  -- Replay of the same request: same target and bytes → same intent.
  select * into v_version from public.attachment_versions
   where created_by = v_user and idempotency_key = p_idempotency_key and organization_id = v_org;
  if found then
    select * into v_file from public.attachments where id = v_version.attachment_id;
    if v_version.filename <> v_name or v_version.mime_type <> p_mime_type or v_version.declared_size <> p_size_bytes
       or (p_attachment is not null and p_attachment <> v_file.id)
       or (p_attachment is null and (v_file.owner_kind <> p_owner_kind or p_owner_id is distinct from case p_owner_kind
             when 'plan' then v_file.plan_id when 'plan_item' then v_file.plan_item_id when 'song' then v_file.song_id
             when 'arrangement' then v_file.arrangement_id when 'service_type' then v_file.service_type_id end)) then
      raise exception 'This request id was already used for another upload'
        using errcode = 'PT409', hint = 'idempotency_key_reused';
    end if;
    return jsonb_build_object('attachment', private.file_json(v_file.id), 'version', to_jsonb(v_version), 'replayed', true);
  end if;

  if (select count(*) from public.attachment_versions
       where created_by = v_user and status = 'pending' and upload_expires_at > now()) >= 20 then
    raise exception 'Finish or cancel your other uploads first' using errcode = '22023';
  end if;

  if p_attachment is null then
    select * into v_owner from private.resolve_file_owner(p_owner_kind, p_owner_id);
    if not private.is_active_member(v_user, v_owner.organization_id) then
      raise exception 'That parent was not found' using errcode = 'P0002';
    end if;
    if not private.file_writer(v_user, v_owner.organization_id, p_owner_kind, v_owner.plan_id, v_owner.service_type_id) then
      raise exception 'You cannot add files here' using errcode = '42501';
    end if;
    v_title := coalesce(nullif(btrim(p_title), ''), v_name);
    insert into public.attachments (
      id, organization_id, owner_kind, plan_id, plan_item_id, song_id, arrangement_id, service_type_id,
      kind, title, category, audience, filename, mime_type, size_bytes, created_by, updated_by
    ) values (
      v_id, v_owner.organization_id, p_owner_kind, v_owner.plan_id, v_owner.plan_item_id, v_owner.song_id,
      v_owner.arrangement_id, v_owner.service_type_id, 'upload', left(v_title, 200),
      coalesce(p_category, 'other'), coalesce(p_audience, 'organization'), v_name, p_mime_type, p_size_bytes, v_user, v_user
    ) returning * into v_file;
    perform private.set_file_audience_targets(v_file.id, v_file.audience, p_team_ids, p_position_ids);
  else
    select * into v_file from public.attachments where id = p_attachment for update;
    if not found or not private.can_read_attachment(v_user, p_attachment) then
      raise exception 'File not found' using errcode = 'P0002';
    end if;
    if not private.can_write_attachment(v_user, p_attachment) then
      raise exception 'You cannot replace this file' using errcode = '42501';
    end if;
    if v_file.kind <> 'upload' then
      raise exception 'Only uploaded files can be replaced with an upload' using errcode = '22023';
    end if;
    if v_file.archived_at is not null then
      raise exception 'Restore this file before replacing it' using errcode = '22023';
    end if;
    if p_expected_revision is null or p_expected_revision <> v_file.revision then
      raise exception 'This file changed since you opened it' using errcode = 'PT409', hint = 'file_changed';
    end if;
  end if;

  insert into public.attachment_versions (
    id, attachment_id, organization_id, status, storage_path, filename, mime_type, declared_size,
    base_version_id, idempotency_key, upload_expires_at, created_by
  ) values (
    v_version_id, v_file.id, v_file.organization_id, 'pending',
    v_file.organization_id::text || '/' || v_file.id::text || '/' || v_version_id::text || '/' || private.file_safe_name(v_name),
    v_name, p_mime_type, p_size_bytes, v_file.current_version_id, p_idempotency_key, now() + interval '2 hours', v_user
  ) returning * into v_version;

  return jsonb_build_object('attachment', private.file_json(v_file.id), 'version', to_jsonb(v_version), 'replayed', false);
end;
$$;
revoke execute on function public.create_file_upload_intent(public.file_owner_kind, uuid, uuid, bigint, text, text, bigint, text, public.file_category, public.file_audience, uuid[], uuid[], text) from public, anon;
grant execute on function public.create_file_upload_intent(public.file_owner_kind, uuid, uuid, bigint, text, text, bigint, text, public.file_category, public.file_audience, uuid[], uuid[], text) to authenticated, service_role;

-- ---------------------------------------------------------------- finalize --
-- Outcome, never an exception, for settled states so the status change commits:
--   ready        (replayed true when it already was)
--   not_uploaded nothing stored yet; the intent stays pending (retry)
--   failed       size/type mismatch or superseded; bytes queued for removal
--   expired      intent past its expiry; bytes queued for removal
create or replace function public.finalize_file_version(p_version uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := (select auth.uid());
  v_attachment uuid;
  v_file     public.attachments;
  v_version  public.attachment_versions;
  v_object   record;
  v_number   int;
  v_reason   text;
begin
  select attachment_id into v_attachment from public.attachment_versions where id = p_version;
  if v_attachment is null then
    raise exception 'Upload not found' using errcode = 'P0002';
  end if;
  -- Lock order: file, then version (the same as every other writer).
  select * into v_file from public.attachments where id = v_attachment for update;
  select * into v_version from public.attachment_versions where id = p_version for update;
  if v_version.created_by is distinct from v_user or not private.can_write_attachment(v_user, v_file.id) then
    raise exception 'Upload not found' using errcode = 'P0002';
  end if;

  if v_version.status = 'ready' then
    return jsonb_build_object('outcome', 'ready', 'replayed', true,
      'attachment', private.file_json(v_file.id), 'version', to_jsonb(v_version));
  end if;
  if v_version.status in ('failed', 'expired') then
    return jsonb_build_object('outcome', v_version.status::text, 'reason', v_version.failure_reason, 'replayed', true,
      'attachment', private.file_json(v_file.id), 'version', to_jsonb(v_version));
  end if;

  if v_version.upload_expires_at <= now() then
    update public.attachment_versions set status = 'expired', failure_reason = 'expired'
     where id = p_version returning * into v_version;
    return jsonb_build_object('outcome', 'expired', 'reason', 'expired', 'replayed', false,
      'attachment', private.file_json(v_file.id), 'version', to_jsonb(v_version));
  end if;

  select (o.metadata ->> 'size')::bigint as size, o.metadata ->> 'mimetype' as mimetype
    into v_object
    from storage.objects o where o.bucket_id = 'attachments' and o.name = v_version.storage_path;
  if not found then
    return jsonb_build_object('outcome', 'not_uploaded', 'replayed', false,
      'attachment', private.file_json(v_file.id), 'version', to_jsonb(v_version));
  end if;

  if v_object.size is distinct from v_version.declared_size then
    v_reason := 'size_mismatch';
  elsif v_object.mimetype is distinct from v_version.mime_type then
    v_reason := 'type_mismatch';
  elsif v_file.current_version_id is distinct from v_version.base_version_id then
    v_reason := 'superseded';
  end if;
  if v_reason is not null then
    update public.attachment_versions set status = 'failed', failure_reason = v_reason
     where id = p_version returning * into v_version;
    return jsonb_build_object('outcome', 'failed', 'reason', v_reason, 'replayed', false,
      'attachment', private.file_json(v_file.id), 'version', to_jsonb(v_version));
  end if;

  select coalesce(max(version_number), 0) + 1 into v_number
    from public.attachment_versions where attachment_id = v_file.id;
  update public.attachment_versions
     set status = 'ready', version_number = v_number, size_bytes = v_object.size,
         finalized_at = now(), finalized_by = v_user
   where id = p_version returning * into v_version;
  update public.attachments
     set current_version_id = v_version.id, storage_path = v_version.storage_path, filename = v_version.filename,
         mime_type = v_version.mime_type, size_bytes = v_version.size_bytes,
         revision = revision + 1, updated_at = now(), updated_by = v_user
   where id = v_file.id;
  -- Other replacements requested against the previous version now finalize as superseded.
  return jsonb_build_object('outcome', 'ready', 'replayed', false,
    'attachment', private.file_json(v_file.id), 'version', to_jsonb(v_version));
end;
$$;
revoke execute on function public.finalize_file_version(uuid) from public, anon;
grant execute on function public.finalize_file_version(uuid) to authenticated, service_role;

-- Cancels a pending upload. A new file that never became ready goes away.
create or replace function public.abandon_file_version(p_version uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := (select auth.uid());
  v_attachment uuid;
  v_file     public.attachments;
  v_version  public.attachment_versions;
  v_removed  boolean := false;
begin
  select attachment_id into v_attachment from public.attachment_versions where id = p_version;
  if v_attachment is null then
    raise exception 'Upload not found' using errcode = 'P0002';
  end if;
  select * into v_file from public.attachments where id = v_attachment for update;
  select * into v_version from public.attachment_versions where id = p_version for update;
  if not private.can_write_attachment(v_user, v_file.id) then
    raise exception 'Upload not found' using errcode = 'P0002';
  end if;
  if v_version.status = 'pending' then
    update public.attachment_versions set status = 'failed', failure_reason = 'abandoned' where id = p_version;
  elsif v_version.status = 'ready' then
    raise exception 'This upload is already a file version' using errcode = 'PT409', hint = 'file_changed';
  end if;
  if v_file.current_version_id is null and v_file.kind = 'upload'
     and not exists (select 1 from public.attachment_versions where attachment_id = v_file.id and status = 'pending') then
    delete from public.attachments where id = v_file.id;
    v_removed := true;
  end if;
  return jsonb_build_object('attachment_removed', v_removed);
end;
$$;
revoke execute on function public.abandon_file_version(uuid) from public, anon;
grant execute on function public.abandon_file_version(uuid) to authenticated, service_role;

-- ------------------------------------------------------- links and docs ---

-- External link (not fetched by the server) or text document; replacing a
-- document's text creates a new version.
create or replace function public.save_file_content(
  p_owner_kind         public.file_owner_kind,
  p_owner_id           uuid,
  p_attachment         uuid,
  p_expected_revision  bigint,
  p_kind               public.file_kind,
  p_title              text,
  p_external_url       text,
  p_document_body      text,
  p_category           public.file_category,
  p_audience           public.file_audience,
  p_team_ids           uuid[],
  p_position_ids       uuid[],
  p_idempotency_key    text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := (select auth.uid());
  v_owner    record;
  v_file     public.attachments;
  v_version  public.attachment_versions;
  v_title    text := btrim(coalesce(p_title, ''));
  v_body     text;
  v_number   int;
  v_bytes    bigint;
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_kind not in ('link', 'document') then
    raise exception 'Use an upload for files' using errcode = '22023';
  end if;
  if char_length(v_title) not between 1 and 200 then
    raise exception 'The title must be 1–200 characters' using errcode = '22023';
  end if;
  if p_kind = 'document' then
    v_body := coalesce(p_document_body, '');
    if char_length(v_body) > 100000 then
      raise exception 'Documents are limited to 100,000 characters' using errcode = '22023';
    end if;
    v_bytes := octet_length(v_body);
  end if;

  if p_attachment is null then
    if char_length(coalesce(p_idempotency_key, '')) not between 1 and 200 then
      raise exception 'A request id is required' using errcode = '22023';
    end if;
    select * into v_owner from private.resolve_file_owner(p_owner_kind, p_owner_id);
    if not private.is_active_member(v_user, v_owner.organization_id) then
      raise exception 'That parent was not found' using errcode = 'P0002';
    end if;
    if not private.file_writer(v_user, v_owner.organization_id, p_owner_kind, v_owner.plan_id, v_owner.service_type_id) then
      raise exception 'You cannot add files here' using errcode = '42501';
    end if;
    -- Replay: a document's first version carries the key; a link is matched by
    -- owner, title and URL created by this caller with the same key in its id.
    select a.* into v_file from public.attachments a
      join public.attachment_versions v on v.attachment_id = a.id
     where v.created_by = v_user and v.idempotency_key = p_idempotency_key and v.organization_id = v_owner.organization_id;
    if found then
      return jsonb_build_object('attachment', private.file_json(v_file.id), 'replayed', true);
    end if;
    select * into v_file from public.attachments a
     where a.id = private.file_link_id(v_owner.organization_id, v_user, p_idempotency_key);
    if found then
      return jsonb_build_object('attachment', private.file_json(v_file.id), 'replayed', true);
    end if;

    insert into public.attachments (
      id, organization_id, owner_kind, plan_id, plan_item_id, song_id, arrangement_id, service_type_id,
      kind, title, category, audience, external_url, filename, mime_type, size_bytes, created_by, updated_by
    ) values (
      case when p_kind = 'link' then private.file_link_id(v_owner.organization_id, v_user, p_idempotency_key) else gen_random_uuid() end,
      v_owner.organization_id, p_owner_kind, v_owner.plan_id, v_owner.plan_item_id, v_owner.song_id,
      v_owner.arrangement_id, v_owner.service_type_id, p_kind, v_title, coalesce(p_category, 'other'),
      coalesce(p_audience, 'organization'),
      case when p_kind = 'link' then btrim(p_external_url) end,
      case when p_kind = 'document' then left(private.file_safe_name(v_title), 190) || '.md' else v_title end,
      case when p_kind = 'document' then 'text/markdown' end, v_bytes, v_user, v_user
    ) returning * into v_file;
    perform private.set_file_audience_targets(v_file.id, v_file.audience, p_team_ids, p_position_ids);
  else
    select * into v_file from public.attachments where id = p_attachment for update;
    if not found or not private.can_read_attachment(v_user, p_attachment) then
      raise exception 'File not found' using errcode = 'P0002';
    end if;
    if not private.can_write_attachment(v_user, p_attachment) then
      raise exception 'You cannot change this file' using errcode = '42501';
    end if;
    if v_file.kind <> p_kind then
      raise exception 'This file is not a %', p_kind using errcode = '22023';
    end if;
    if p_expected_revision is null or p_expected_revision <> v_file.revision then
      raise exception 'This file changed since you opened it' using errcode = 'PT409', hint = 'file_changed';
    end if;
    update public.attachments
       set title = v_title,
           external_url = case when p_kind = 'link' then btrim(p_external_url) else external_url end,
           filename = case when p_kind = 'link' then v_title else left(private.file_safe_name(v_title), 190) || '.md' end,
           revision = revision + 1, updated_at = now(), updated_by = v_user
     where id = v_file.id returning * into v_file;
  end if;

  if p_kind = 'document' then
    select coalesce(max(version_number), 0) + 1 into v_number
      from public.attachment_versions where attachment_id = v_file.id;
    insert into public.attachment_versions (
      attachment_id, organization_id, version_number, status, filename, mime_type, declared_size,
      size_bytes, document_body, base_version_id, idempotency_key, finalized_at, finalized_by, created_by
    ) values (
      v_file.id, v_file.organization_id, v_number, 'ready', v_file.filename, 'text/markdown', v_bytes,
      v_bytes, v_body, v_file.current_version_id, case when p_attachment is null then p_idempotency_key end,
      now(), v_user, v_user
    ) returning * into v_version;
    update public.attachments
       set current_version_id = v_version.id, size_bytes = v_bytes, mime_type = 'text/markdown'
     where id = v_file.id;
  end if;

  return jsonb_build_object('attachment', private.file_json(v_file.id), 'replayed', false);
end;
$$;

-- A link's id is derived from its creator and request id, so a retried create
-- is one link.
create or replace function private.file_link_id(p_org uuid, p_user uuid, p_key text)
returns uuid language sql immutable set search_path = '' as $$
  select (md5('f13-link:' || p_org::text || ':' || p_user::text || ':' || p_key))::uuid;
$$;
revoke execute on function private.file_link_id(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.save_file_content(public.file_owner_kind, uuid, uuid, bigint, public.file_kind, text, text, text, public.file_category, public.file_audience, uuid[], uuid[], text) from public, anon;
grant execute on function public.save_file_content(public.file_owner_kind, uuid, uuid, bigint, public.file_kind, text, text, text, public.file_category, public.file_audience, uuid[], uuid[], text) to authenticated, service_role;

-- ------------------------------------------------- metadata, move, archive --
-- Title/category/audience and a bounded move (plan ↔ its item, item ↔ item of
-- the same plan, song ↔ its arrangement). A move never leaves the parent
-- context whose audience rules the file was written for.
create or replace function public.update_file(
  p_attachment         uuid,
  p_expected_revision  bigint,
  p_title              text,
  p_category           public.file_category,
  p_audience           public.file_audience,
  p_team_ids           uuid[],
  p_position_ids       uuid[],
  p_move_owner_kind    public.file_owner_kind,
  p_move_owner_id      uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid := (select auth.uid());
  v_file   public.attachments;
  v_owner  record;
  v_title  text := btrim(coalesce(p_title, ''));
begin
  select * into v_file from public.attachments where id = p_attachment for update;
  if not found or not private.can_read_attachment(v_user, p_attachment) then
    raise exception 'File not found' using errcode = 'P0002';
  end if;
  if not private.can_write_attachment(v_user, p_attachment) then
    raise exception 'You cannot change this file' using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision <> v_file.revision then
    raise exception 'This file changed since you opened it' using errcode = 'PT409', hint = 'file_changed';
  end if;
  if char_length(v_title) not between 1 and 200 then
    raise exception 'The title must be 1–200 characters' using errcode = '22023';
  end if;

  if p_move_owner_kind is not null and p_move_owner_id is not null then
    select * into v_owner from private.resolve_file_owner(p_move_owner_kind, p_move_owner_id);
    if v_owner.organization_id <> v_file.organization_id then
      raise exception 'That parent was not found' using errcode = 'P0002';
    end if;
    if not ((v_file.owner_kind in ('plan', 'plan_item') and p_move_owner_kind in ('plan', 'plan_item')
             and v_owner.plan_id = v_file.plan_id)
         or (v_file.owner_kind in ('song', 'arrangement') and p_move_owner_kind in ('song', 'arrangement')
             and v_owner.song_id = v_file.song_id)) then
      raise exception 'Files can move only within the same plan or song' using errcode = '22023';
    end if;
    update public.attachments
       set owner_kind = p_move_owner_kind, plan_item_id = v_owner.plan_item_id,
           arrangement_id = v_owner.arrangement_id
     where id = v_file.id;
  end if;

  update public.attachments
     set title = v_title,
         filename = case when kind = 'link' then v_title else filename end,
         category = coalesce(p_category, category),
         audience = coalesce(p_audience, audience),
         revision = revision + 1, updated_at = now(), updated_by = v_user
   where id = v_file.id returning * into v_file;
  perform private.set_file_audience_targets(v_file.id, v_file.audience, p_team_ids, p_position_ids);
  return jsonb_build_object('attachment', private.file_json(v_file.id));
end;
$$;
revoke execute on function public.update_file(uuid, bigint, text, public.file_category, public.file_audience, uuid[], uuid[], public.file_owner_kind, uuid) from public, anon;
grant execute on function public.update_file(uuid, bigint, text, public.file_category, public.file_audience, uuid[], uuid[], public.file_owner_kind, uuid) to authenticated, service_role;

create or replace function public.set_file_archived(p_attachment uuid, p_expected_revision bigint, p_archived boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_file public.attachments;
begin
  select * into v_file from public.attachments where id = p_attachment for update;
  if not found or not private.can_read_attachment(v_user, p_attachment) then
    raise exception 'File not found' using errcode = 'P0002';
  end if;
  if not private.can_write_attachment(v_user, p_attachment) then
    raise exception 'You cannot change this file' using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision <> v_file.revision then
    raise exception 'This file changed since you opened it' using errcode = 'PT409', hint = 'file_changed';
  end if;
  update public.attachments
     set archived_at = case when p_archived then coalesce(archived_at, now()) end,
         archived_by = case when p_archived then coalesce(archived_by, v_user) end,
         revision = revision + 1, updated_at = now(), updated_by = v_user
   where id = p_attachment;
  return jsonb_build_object('attachment', private.file_json(p_attachment));
end;
$$;
revoke execute on function public.set_file_archived(uuid, bigint, boolean) from public, anon;
grant execute on function public.set_file_archived(uuid, bigint, boolean) to authenticated, service_role;

-- Permanent removal of a file and all its versions (bytes are queued for
-- removal). Refused while any plan links it: unlink or archive instead.
create or replace function public.delete_file(p_attachment uuid, p_expected_revision bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_file public.attachments;
begin
  select * into v_file from public.attachments where id = p_attachment for update;
  if not found or not private.can_read_attachment(v_user, p_attachment) then
    raise exception 'File not found' using errcode = 'P0002';
  end if;
  if not private.can_write_attachment(v_user, p_attachment) then
    raise exception 'You cannot delete this file' using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision <> v_file.revision then
    raise exception 'This file changed since you opened it' using errcode = 'PT409', hint = 'file_changed';
  end if;
  if exists (select 1 from public.attachment_links where attachment_id = p_attachment) then
    raise exception 'Plans use this file. Archive it instead, or remove it from those plans first.'
      using errcode = 'PT409', hint = 'file_in_use';
  end if;
  delete from public.attachments where id = p_attachment;
end;
$$;
revoke execute on function public.delete_file(uuid, bigint) from public, anon;
grant execute on function public.delete_file(uuid, bigint) to authenticated, service_role;

-- ------------------------------------------------------------ plan links ---

create or replace function public.link_file_to_plan(p_plan uuid, p_item uuid, p_attachment uuid, p_pin boolean)
returns public.attachment_links
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_plan public.plans;
  v_file public.attachments;
  v_link public.attachment_links;
begin
  select * into v_plan from public.plans where id = p_plan;
  if not found or not private.is_active_member(v_user, v_plan.organization_id) then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;
  if not private.can_edit_plan(v_user, p_plan) then
    raise exception 'You cannot change this plan' using errcode = '42501';
  end if;
  if p_item is not null and not exists (select 1 from public.plan_items where id = p_item and plan_id = p_plan) then
    raise exception 'Item not found' using errcode = 'P0002';
  end if;
  select * into v_file from public.attachments where id = p_attachment;
  if not found or v_file.organization_id <> v_plan.organization_id or not private.can_read_attachment(v_user, p_attachment) then
    raise exception 'File not found' using errcode = 'P0002';
  end if;
  if v_file.owner_kind not in ('song', 'arrangement', 'service_type') then
    raise exception 'Only song, arrangement and service type files can be reused on a plan' using errcode = '22023';
  end if;
  if v_file.archived_at is not null then
    raise exception 'This file is archived' using errcode = '22023';
  end if;
  if p_pin and v_file.current_version_id is null then
    raise exception 'This file has no version to pin' using errcode = '22023';
  end if;
  insert into public.attachment_links (organization_id, attachment_id, plan_id, plan_item_id, pinned_version_id, created_by)
  values (v_plan.organization_id, p_attachment, p_plan, p_item, case when p_pin then v_file.current_version_id end, v_user)
  on conflict (attachment_id, plan_id, plan_item_id) do update set updated_at = public.attachment_links.updated_at
  returning * into v_link;
  return v_link;
end;
$$;
revoke execute on function public.link_file_to_plan(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.link_file_to_plan(uuid, uuid, uuid, boolean) to authenticated, service_role;

-- Pin to the file's current version, pin to an exact readable version, or follow current (null).
create or replace function public.set_file_link_pin(p_link uuid, p_version uuid, p_follow boolean)
returns public.attachment_links
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_link public.attachment_links;
  v_file public.attachments;
  v_target uuid;
begin
  select * into v_link from public.attachment_links where id = p_link for update;
  if not found or not private.can_read_attachment(v_user, v_link.attachment_id) then
    raise exception 'Link not found' using errcode = 'P0002';
  end if;
  if not private.can_edit_plan(v_user, v_link.plan_id) then
    raise exception 'You cannot change this plan' using errcode = '42501';
  end if;
  select * into v_file from public.attachments where id = v_link.attachment_id;
  if p_follow then
    v_target := null;
  else
    v_target := coalesce(p_version, v_file.current_version_id);
    if not exists (select 1 from public.attachment_versions
                    where id = v_target and attachment_id = v_file.id and status = 'ready') then
      raise exception 'Version not found' using errcode = 'P0002';
    end if;
  end if;
  update public.attachment_links set pinned_version_id = v_target, updated_at = now()
   where id = p_link returning * into v_link;
  return v_link;
end;
$$;
revoke execute on function public.set_file_link_pin(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_file_link_pin(uuid, uuid, boolean) to authenticated, service_role;

-- Removes the reference only; the source file is untouched.
create or replace function public.unlink_file(p_link uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_link public.attachment_links;
begin
  select * into v_link from public.attachment_links where id = p_link;
  if not found or not private.is_active_member(v_user, v_link.organization_id) then
    raise exception 'Link not found' using errcode = 'P0002';
  end if;
  if not private.can_edit_plan(v_user, v_link.plan_id) then
    raise exception 'You cannot change this plan' using errcode = '42501';
  end if;
  delete from public.attachment_links where id = p_link;
end;
$$;
revoke execute on function public.unlink_file(uuid) from public, anon;
grant execute on function public.unlink_file(uuid) to authenticated, service_role;

-- --------------------------------------------- service-type default files ---
-- A new plan links every live default file of its service type, pinned to the
-- default's current version at that moment. Replacing or archiving a default
-- later never rewrites an existing plan; a leader re-pins explicitly.
create or replace function private.link_service_type_default_files()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.service_type_id is null then
    return new;
  end if;
  insert into public.attachment_links (organization_id, attachment_id, plan_id, pinned_version_id, source, created_by)
  select a.organization_id, a.id, new.id, a.current_version_id, 'service_type_default', new.created_by
    from public.attachments a
   where a.owner_kind = 'service_type' and a.service_type_id = new.service_type_id
     and a.organization_id = new.organization_id and a.archived_at is null
     and (a.current_version_id is not null or a.kind = 'link')
  on conflict (attachment_id, plan_id, plan_item_id) do nothing;
  return new;
end;
$$;
revoke execute on function private.link_service_type_default_files() from public, anon, authenticated;
create trigger plans_link_default_files after insert on public.plans
  for each row execute function private.link_service_type_default_files();

-- --------------------------------------------------------- maintenance -----

-- Settles pending uploads past their expiry (bytes queued for removal).
create or replace function public.expire_file_uploads(p_limit int default 200)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  with due as (
    select id from public.attachment_versions
     where status = 'pending' and upload_expires_at <= now()
     order by upload_expires_at
     limit greatest(1, least(p_limit, 1000))
     for update skip locked
  )
  update public.attachment_versions v set status = 'expired', failure_reason = 'expired'
    from due where v.id = due.id;
  get diagnostics v_count = row_count;
  -- New files whose only upload expired are removed entirely.
  delete from public.attachments a
   where a.kind = 'upload' and a.current_version_id is null
     and not exists (select 1 from public.attachment_versions v where v.attachment_id = a.id and v.status = 'pending')
     and exists (select 1 from public.attachment_versions v where v.attachment_id = a.id);
  return v_count;
end;
$$;
revoke execute on function public.expire_file_uploads(int) from public, anon, authenticated;
grant execute on function public.expire_file_uploads(int) to service_role;

-- Leases a batch of object removals for the worker.
create or replace function public.claim_file_object_removals(p_limit int default 100)
returns setof public.attachment_object_removals
language sql
security definer
set search_path = ''
as $$
  update public.attachment_object_removals r
     set leased_until = now() + interval '2 minutes', attempts = r.attempts + 1
   where r.id in (
     select id from public.attachment_object_removals
      where removed_at is null and (leased_until is null or leased_until < now()) and attempts < 10
      order by enqueued_at
      limit greatest(1, least(p_limit, 500))
      for update skip locked)
  returning r.*;
$$;
revoke execute on function public.claim_file_object_removals(int) from public, anon, authenticated;
grant execute on function public.claim_file_object_removals(int) to service_role;

-- Records the outcome. A path that a ready version uses again is never removed.
create or replace function public.complete_file_object_removals(p_removed bigint[], p_failed bigint[], p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.attachment_object_removals set removed_at = now(), leased_until = null, last_error = null
   where id = any (coalesce(p_removed, '{}'));
  update public.attachment_object_removals set leased_until = null, last_error = left(p_error, 500)
   where id = any (coalesce(p_failed, '{}'));
$$;
revoke execute on function public.complete_file_object_removals(bigint[], bigint[], text) from public, anon, authenticated;
grant execute on function public.complete_file_object_removals(bigint[], bigint[], text) to service_role;

-- ------------------------------------------------------ client hints -------
-- What the signed-in caller may do (the functions above recheck every write).

create or replace function public.can_add_file(p_owner_kind public.file_owner_kind, p_owner_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner record;
begin
  select * into v_owner from private.resolve_file_owner(p_owner_kind, p_owner_id);
  return private.file_writer((select auth.uid()), v_owner.organization_id, p_owner_kind, v_owner.plan_id, v_owner.service_type_id);
exception when sqlstate 'P0002' then
  return false;
end;
$$;
revoke execute on function public.can_add_file(public.file_owner_kind, uuid) from public, anon;
grant execute on function public.can_add_file(public.file_owner_kind, uuid) to authenticated, service_role;

create or replace function public.writable_file_ids(p_ids uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from unnest(coalesce(p_ids, '{}')) id
   where cardinality(p_ids) <= 500 and private.can_write_attachment((select auth.uid()), id);
$$;
revoke execute on function public.writable_file_ids(uuid[]) from public, anon;
grant execute on function public.writable_file_ids(uuid[]) to authenticated, service_role;
