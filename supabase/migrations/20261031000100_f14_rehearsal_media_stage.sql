-- ============================================================================
-- F14: rehearsal rights, reusable media bundles and stage layouts
--
-- Pass A — playback rights. Every file gets `playback_rights`:
--   download     readers may stream it and save it (the F13 default)
--   stream_only  readers may play it inline; the API refuses a download
--                disposition and offline packs leave it out. Inline bytes can
--                still be captured by a determined reader, so this is a rights
--                statement, not a DRM promise.
-- The rehearsal manifest itself is derived (no table): plan order, F11 chart
-- context and the F13 file versions this caller may read, resolved per call.
--
-- Pass B — media bundles (`media`): reusable title/creator/duration/themes/
-- tags/notes/thumbnail with an optional archive date. A bundle owns its files
-- through F13 (`attachments.owner_kind = 'media'`, so versions, audiences,
-- Storage policies and cleanup are the F13 ones). A regular order item links a
-- bundle with `plan_items.media_id`; usage history is those items. Archive
-- (now or on a date) hides a bundle from pickers and new copies but keeps
-- every existing reference working.
--
-- Pass B — stage layouts: reusable templates (background preset + gear
-- objects) and plan snapshots (`plan_stage_layouts`) with people placed by
-- Person id and a label captured when placed. Staffing changes never move a
-- snapshot; clients compare it with the plan's current assignments and a
-- leader refreshes deliberately (a revisioned save).
-- ============================================================================

-- ======================================================= playback rights ===

alter table public.attachments
  add column playback_rights text not null default 'download'
    constraint attachments_playback_rights check (playback_rights in ('download', 'stream_only'));

-- Writers change rights with the file's revision, like any other metadata.
create or replace function public.set_file_playback_rights(
  p_attachment uuid, p_expected_revision bigint, p_rights text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_file public.attachments;
begin
  if p_rights not in ('download', 'stream_only') then
    raise exception 'Choose download or stream only' using errcode = '22023';
  end if;
  select * into v_file from public.attachments where id = p_attachment for update;
  if not found or not private.can_read_attachment(v_user, p_attachment) then
    raise exception 'File not found' using errcode = 'P0002';
  end if;
  if not private.can_write_attachment(v_user, p_attachment) then
    raise exception 'You cannot change this file' using errcode = '42501';
  end if;
  if v_file.kind <> 'upload' then
    raise exception 'Only uploaded files have download rights' using errcode = '22023';
  end if;
  if p_expected_revision is null or p_expected_revision <> v_file.revision then
    raise exception 'This file changed since you opened it' using errcode = 'PT409', hint = 'file_changed';
  end if;
  update public.attachments
     set playback_rights = p_rights, revision = revision + 1, updated_at = now(), updated_by = v_user
   where id = p_attachment;
  return private.file_json(p_attachment);
end;
$$;
revoke execute on function public.set_file_playback_rights(uuid, bigint, text) from public, anon;
grant execute on function public.set_file_playback_rights(uuid, bigint, text) to authenticated, service_role;

-- ========================================================= media bundles ===

create table public.media (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  title             text not null constraint media_title_length check (char_length(btrim(title)) between 1 and 200),
  creator           text constraint media_creator_length check (creator is null or char_length(creator) <= 200),
  duration_seconds  int constraint media_duration_range check (duration_seconds is null or duration_seconds between 0 and 86400),
  themes            text[] not null default '{}',
  tags              text[] not null default '{}',
  notes             text constraint media_notes_length check (notes is null or char_length(notes) <= 5000),
  -- One of this bundle's own image files (composite FK below).
  thumbnail_file_id uuid,
  -- Hidden from pickers from this date (organization timezone) on.
  archive_on        date,
  archived_at       timestamptz,
  archived_by       uuid references public.profiles (id) on delete set null,
  revision          bigint not null default 1,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles (id) on delete set null,
  updated_at        timestamptz not null default now(),
  constraint media_id_org_key unique (id, organization_id),
  constraint media_labels_bounded check (
    cardinality(themes) <= 20 and cardinality(tags) <= 20
    and array_position(themes, null) is null and array_position(tags, null) is null
  ),
  constraint media_archive_shape check (archived_by is null or archived_at is not null)
);
create index media_organization_title_idx on public.media (organization_id, lower(title));
create index media_thumbnail_idx on public.media (thumbnail_file_id) where thumbnail_file_id is not null;
create index media_archived_by_idx on public.media (archived_by) where archived_by is not null;
create index media_created_by_idx on public.media (created_by) where created_by is not null;
create index media_updated_by_idx on public.media (updated_by) where updated_by is not null;

-- Archived now, or its archive date has arrived in the organization's timezone.
create or replace function private.media_is_archived(m public.media)
returns boolean language sql stable security definer set search_path = '' as $$
  select m.archived_at is not null or (
    m.archive_on is not null and m.archive_on <= coalesce((
      select (now() at time zone o.timezone)::date from public.organizations o where o.id = m.organization_id
    ), current_date)
  );
$$;
revoke execute on function private.media_is_archived(public.media) from public, anon;
grant execute on function private.media_is_archived(public.media) to authenticated, service_role;

-- Files: a new owner kind on the F13 model.
alter table public.attachments add column media_id uuid;
create unique index attachments_id_media_key on public.attachments (id, media_id);
create index attachments_media_idx on public.attachments (media_id) where media_id is not null;
alter table public.attachments
  add constraint attachments_media_fk foreign key (media_id, organization_id)
    references public.media (id, organization_id) on delete cascade,
  drop constraint attachments_owner_shape,
  add constraint attachments_owner_shape check (case owner_kind
    when 'plan' then plan_id is not null and plan_item_id is null and song_id is null
                     and arrangement_id is null and service_type_id is null and media_id is null
    when 'plan_item' then plan_id is not null and plan_item_id is not null and song_id is null
                     and arrangement_id is null and service_type_id is null and media_id is null
    when 'song' then song_id is not null and arrangement_id is null and plan_id is null
                     and plan_item_id is null and service_type_id is null and media_id is null
    when 'arrangement' then song_id is not null and arrangement_id is not null and plan_id is null
                     and plan_item_id is null and service_type_id is null and media_id is null
    when 'service_type' then service_type_id is not null and plan_id is null and plan_item_id is null
                     and song_id is null and arrangement_id is null and media_id is null
    when 'media' then media_id is not null and plan_id is null and plan_item_id is null
                     and song_id is null and arrangement_id is null and service_type_id is null
  end);

-- The thumbnail must be one of the bundle's own files; deleting it clears it.
alter table public.media
  add constraint media_thumbnail_fk foreign key (thumbnail_file_id, id)
    references public.attachments (id, media_id) on delete set null (thumbnail_file_id);

create or replace function private.media_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.title := btrim(new.title);
  new.creator := nullif(btrim(coalesce(new.creator, '')), '');
  new.themes := coalesce((select array_agg(distinct btrim(t) order by btrim(t)) from unnest(new.themes) t
                           where char_length(btrim(t)) between 1 and 60), '{}');
  new.tags := coalesce((select array_agg(distinct btrim(t) order by btrim(t)) from unnest(new.tags) t
                         where char_length(btrim(t)) between 1 and 60), '{}');
  if new.thumbnail_file_id is not null
     and (tg_op = 'INSERT' or new.thumbnail_file_id is distinct from old.thumbnail_file_id)
     and not exists (
       select 1 from public.attachments a
        where a.id = new.thumbnail_file_id and a.media_id = new.id and a.category = 'image'
          and a.kind = 'upload' and a.current_version_id is not null
     ) then
    raise exception 'The thumbnail must be an uploaded image of this media' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then
    if new.organization_id <> old.organization_id then
      raise exception 'Media cannot move between organizations' using errcode = '22023';
    end if;
    new.revision := old.revision + 1;
    new.updated_at := now();
    new.updated_by := (select auth.uid());
    if new.archived_at is not null and old.archived_at is null then
      new.archived_by := (select auth.uid());
    elsif new.archived_at is null then
      new.archived_by := null;
    end if;
  else
    new.revision := 1;
    new.created_by := (select auth.uid());
    new.updated_by := (select auth.uid());
  end if;
  return new;
end;
$$;
revoke execute on function private.media_before_write() from public, anon, authenticated;
create trigger media_before_write
  before insert or update on public.media
  for each row execute function private.media_before_write();

alter table public.media enable row level security;
create policy media_select on public.media
  for select to authenticated using ((select public.is_org_member(organization_id)));
create policy media_insert on public.media
  for insert to authenticated with check ((select public.has_capability(organization_id, 'media.manage')));
create policy media_update on public.media
  for update to authenticated
  using ((select public.has_capability(organization_id, 'media.manage')))
  with check ((select public.has_capability(organization_id, 'media.manage')));
create policy media_delete on public.media
  for delete to authenticated using ((select public.has_capability(organization_id, 'media.manage')));
revoke all on public.media from anon;
grant select, insert, update, delete on public.media to authenticated;
grant all on public.media to service_role;

-- File writers for media are media managers (the first branch of file_writer).
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
         else false
       end
  );
$$;

-- Owner resolution gains the media id (a new OUT column, so drop + create).
drop function private.resolve_file_owner(public.file_owner_kind, uuid);
create function private.resolve_file_owner(p_kind public.file_owner_kind, p_owner uuid,
  out organization_id uuid, out plan_id uuid, out plan_item_id uuid, out song_id uuid,
  out arrangement_id uuid, out service_type_id uuid, out media_id uuid)
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
    when 'media' then
      select m.organization_id, m.id into organization_id, media_id from public.media m where m.id = p_owner;
  end case;
  if organization_id is null then
    raise exception 'That parent was not found' using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function private.resolve_file_owner(public.file_owner_kind, uuid) from public, anon, authenticated;

-- ---------------------------------------------- plan items link a bundle --

-- Restrict: a bundle a plan uses is archived, never deleted out from under it.
alter table public.plan_items
  add column media_id uuid references public.media (id) on delete restrict;
create index plan_items_media_idx on public.plan_items (media_id) where media_id is not null;

-- Only regular items carry media; the bundle must be in the plan's
-- organization and, when newly chosen, not archived. Changing an item to a
-- song or header drops its media (like F11 drops song fields the other way).
create or replace function private.validate_plan_item_media()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_media public.media;
begin
  if new.item_type <> 'item' then
    new.media_id := null;
    return new;
  end if;
  if new.media_id is not null and (tg_op = 'INSERT' or new.media_id is distinct from old.media_id) then
    select m.* into v_media from public.media m
      join public.plans p on p.organization_id = m.organization_id
     where m.id = new.media_id and p.id = new.plan_id;
    if not found then
      raise exception 'That media is not in this organization''s library' using errcode = '22023';
    end if;
    if private.media_is_archived(v_media) then
      raise exception 'That media is archived; restore it before adding it to a plan' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function private.validate_plan_item_media() from public, anon, authenticated;
create trigger plan_items_validate_media
  before insert or update of item_type, media_id on public.plan_items
  for each row execute function private.validate_plan_item_media();

-- Revisioned like every other order edit (F11).
create or replace function public.set_plan_item_media(
  p_plan_id uuid, p_item_id uuid, p_media_id uuid, p_expected_revision bigint default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item public.plan_items;
begin
  perform private.lock_plan_for_order_edit(p_plan_id, p_expected_revision);
  select * into v_item from public.plan_items where id = p_item_id and plan_id = p_plan_id for update;
  if not found then
    raise exception 'Item not found' using errcode = 'P0002';
  end if;
  if v_item.item_type <> 'item' then
    raise exception 'Only a regular item can link media' using errcode = '22023';
  end if;
  update public.plan_items set media_id = p_media_id, updated_at = now()
   where id = p_item_id returning * into v_item;
  return jsonb_build_object(
    'item', to_jsonb(v_item),
    'content_revision', (select content_revision from public.plans where id = p_plan_id));
end;
$$;
revoke execute on function public.set_plan_item_media(uuid, uuid, uuid, bigint) from public, anon;
grant execute on function public.set_plan_item_media(uuid, uuid, uuid, bigint) to authenticated, service_role;

-- ============================================================ stage layouts ===

-- Objects are placed in a unit square (x, y = centre; w, h = size), so a
-- layout survives any output size. Kinds: person (Person id + the label
-- captured when placed), gear, label.
create or replace function private.stage_objects_valid(p_objects jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_objects) = 'array'
     and jsonb_array_length(p_objects) <= 200
     and not exists (
       select 1 from jsonb_array_elements(p_objects) o
        where jsonb_typeof(o) <> 'object'
           or jsonb_typeof(o -> 'id') <> 'string' or char_length(o ->> 'id') not between 1 and 64
           or coalesce(o ->> 'kind', '') not in ('person', 'gear', 'label')
           or jsonb_typeof(o -> 'x') <> 'number' or (o ->> 'x')::numeric not between 0 and 1
           or jsonb_typeof(o -> 'y') <> 'number' or (o ->> 'y')::numeric not between 0 and 1
           or jsonb_typeof(o -> 'w') <> 'number' or (o ->> 'w')::numeric <= 0 or (o ->> 'w')::numeric > 1
           or jsonb_typeof(o -> 'h') <> 'number' or (o ->> 'h')::numeric <= 0 or (o ->> 'h')::numeric > 1
           or jsonb_typeof(o -> 'rotation') <> 'number' or (o ->> 'rotation')::numeric not between -360 and 360
           or jsonb_typeof(o -> 'label') <> 'string' or char_length(o ->> 'label') > 80
           or (o ? 'color' and jsonb_typeof(o -> 'color') <> 'null'
               and coalesce(o ->> 'color', '') !~ '^#[0-9a-fA-F]{6}$')
           or ((o ->> 'kind') = 'person') <> (jsonb_typeof(o -> 'person_id') = 'string')
     )
     and (select count(distinct o ->> 'id') from jsonb_array_elements(p_objects) o) = jsonb_array_length(p_objects);
$$;

create table public.stage_layout_templates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null constraint stage_layout_templates_name check (char_length(btrim(name)) between 1 and 120),
  background       text not null default 'stage'
    constraint stage_layout_templates_background check (background in ('blank', 'stage', 'thrust', 'round')),
  -- Gear and labels only: people are placed on plan layouts.
  objects          jsonb not null default '[]'
    constraint stage_layout_templates_objects check (
      private.stage_objects_valid(objects)
      and not jsonb_path_exists(objects, '$[*] ? (@.kind == "person")')
    ),
  archived_at      timestamptz,
  revision         bigint not null default 1,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles (id) on delete set null,
  updated_at       timestamptz not null default now()
);
create index stage_layout_templates_org_idx on public.stage_layout_templates (organization_id, lower(name));
create index stage_layout_templates_created_by_idx on public.stage_layout_templates (created_by) where created_by is not null;
create index stage_layout_templates_updated_by_idx on public.stage_layout_templates (updated_by) where updated_by is not null;

create table public.plan_stage_layouts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  plan_id          uuid not null,
  template_id      uuid references public.stage_layout_templates (id) on delete set null,
  name             text not null constraint plan_stage_layouts_name check (char_length(btrim(name)) between 1 and 120),
  background       text not null default 'stage'
    constraint plan_stage_layouts_background check (background in ('blank', 'stage', 'thrust', 'round')),
  objects          jsonb not null default '[]'
    constraint plan_stage_layouts_objects check (private.stage_objects_valid(objects)),
  -- When a leader last deliberately matched people to the plan's staffing.
  refreshed_at     timestamptz,
  revision         bigint not null default 1,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles (id) on delete set null,
  updated_at       timestamptz not null default now(),
  constraint plan_stage_layouts_plan_fk foreign key (plan_id, organization_id)
    references public.plans (id, organization_id) on delete cascade
);
create index plan_stage_layouts_plan_idx on public.plan_stage_layouts (plan_id, created_at);
create index plan_stage_layouts_org_idx on public.plan_stage_layouts (organization_id);
create index plan_stage_layouts_template_idx on public.plan_stage_layouts (template_id) where template_id is not null;
create index plan_stage_layouts_created_by_idx on public.plan_stage_layouts (created_by) where created_by is not null;
create index plan_stage_layouts_updated_by_idx on public.plan_stage_layouts (updated_by) where updated_by is not null;

-- Templates: anyone who edits plans somewhere, or manages media.
create or replace function private.can_manage_stage_templates(p_user uuid, p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_active_member(p_user, p_org) and (
    private.capability_anywhere(p_user, p_org, 'plans.edit')
    or private.capability_for(p_user, p_org, 'media.manage', null, null)
  );
$$;
-- Plan layouts name who stands where (including people not yet asked), so
-- only the plan's editors and leaders read them; editors write them.
create or replace function private.can_read_plan_stage_layout(p_user uuid, p_plan uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_edit_plan(p_user, p_plan) or private.is_plan_leader(p_user, p_plan);
$$;
do $$
declare f text;
begin
  foreach f in array array[
    'private.can_manage_stage_templates(uuid, uuid)',
    'private.can_read_plan_stage_layout(uuid, uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

create or replace function private.stage_layout_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan_org uuid;
begin
  new.name := btrim(new.name);
  if tg_table_name = 'plan_stage_layouts' then
    if tg_op = 'UPDATE' and (new.plan_id <> old.plan_id or new.organization_id <> old.organization_id) then
      raise exception 'A layout cannot move to another plan' using errcode = '22023';
    end if;
    -- People are this organization's roster (archived people may stay on an
    -- old snapshot; clients flag them).
    if (tg_op = 'INSERT' or new.objects is distinct from old.objects) and exists (
      select 1 from jsonb_array_elements(new.objects) o
       where o ->> 'kind' = 'person'
         and not exists (
           select 1 from public.people p
            where p.id::text = o ->> 'person_id' and p.organization_id = new.organization_id)
    ) then
      raise exception 'Someone on this layout is not on the roster' using errcode = '22023';
    end if;
    if new.template_id is not null and (tg_op = 'INSERT' or new.template_id is distinct from old.template_id)
       and not exists (select 1 from public.stage_layout_templates t
                        where t.id = new.template_id and t.organization_id = new.organization_id) then
      raise exception 'Template not found' using errcode = '22023';
    end if;
  elsif tg_op = 'UPDATE' and new.organization_id <> old.organization_id then
    raise exception 'A template cannot move between organizations' using errcode = '22023';
  end if;

  if tg_op = 'UPDATE' then
    new.revision := old.revision + 1;
    new.updated_at := now();
    new.updated_by := (select auth.uid());
  else
    new.revision := 1;
    new.created_by := (select auth.uid());
    new.updated_by := (select auth.uid());
  end if;
  return new;
end;
$$;
revoke execute on function private.stage_layout_before_write() from public, anon, authenticated;
create trigger stage_layout_templates_before_write
  before insert or update on public.stage_layout_templates
  for each row execute function private.stage_layout_before_write();
create trigger plan_stage_layouts_before_write
  before insert or update on public.plan_stage_layouts
  for each row execute function private.stage_layout_before_write();

alter table public.stage_layout_templates enable row level security;
create policy stage_layout_templates_select on public.stage_layout_templates
  for select to authenticated using ((select public.is_org_member(organization_id)));
create policy stage_layout_templates_insert on public.stage_layout_templates
  for insert to authenticated
  with check ((select private.can_manage_stage_templates((select auth.uid()), organization_id)));
create policy stage_layout_templates_update on public.stage_layout_templates
  for update to authenticated
  using ((select private.can_manage_stage_templates((select auth.uid()), organization_id)))
  with check ((select private.can_manage_stage_templates((select auth.uid()), organization_id)));
create policy stage_layout_templates_delete on public.stage_layout_templates
  for delete to authenticated
  using ((select private.can_manage_stage_templates((select auth.uid()), organization_id)));

alter table public.plan_stage_layouts enable row level security;
create policy plan_stage_layouts_select on public.plan_stage_layouts
  for select to authenticated using ((select private.can_read_plan_stage_layout((select auth.uid()), plan_id)));
create policy plan_stage_layouts_insert on public.plan_stage_layouts
  for insert to authenticated with check ((select private.can_edit_plan((select auth.uid()), plan_id)));
create policy plan_stage_layouts_update on public.plan_stage_layouts
  for update to authenticated
  using ((select private.can_edit_plan((select auth.uid()), plan_id)))
  with check ((select private.can_edit_plan((select auth.uid()), plan_id)));
create policy plan_stage_layouts_delete on public.plan_stage_layouts
  for delete to authenticated using ((select private.can_edit_plan((select auth.uid()), plan_id)));

revoke all on public.stage_layout_templates, public.plan_stage_layouts from anon;
grant select, insert, update, delete on public.stage_layout_templates, public.plan_stage_layouts to authenticated;
grant all on public.stage_layout_templates, public.plan_stage_layouts to service_role;

-- At most 10 layouts per plan, checked under the plan row lock.
create or replace function private.plan_stage_layouts_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.plans where id = new.plan_id for update;
  if (select count(*) from public.plan_stage_layouts where plan_id = new.plan_id) >= 10 then
    raise exception 'A plan can have at most 10 stage layouts' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke execute on function private.plan_stage_layouts_limit() from public, anon, authenticated;
create trigger plan_stage_layouts_limit
  before insert on public.plan_stage_layouts
  for each row execute function private.plan_stage_layouts_limit();

-- ============================================ F13/F11 functions + media ====
-- The functions below are the F13/F11 definitions with the media owner
-- (and plan item media) added; everything else is unchanged.

-- ---- create_file_upload_intent (F13 text + media owner) ----
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
             when 'arrangement' then v_file.arrangement_id when 'service_type' then v_file.service_type_id when 'media' then v_file.media_id end)) then
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
      id, organization_id, owner_kind, plan_id, plan_item_id, song_id, arrangement_id, service_type_id, media_id,
      kind, title, category, audience, filename, mime_type, size_bytes, created_by, updated_by
    ) values (
      v_id, v_owner.organization_id, p_owner_kind, v_owner.plan_id, v_owner.plan_item_id, v_owner.song_id,
      v_owner.arrangement_id, v_owner.service_type_id, v_owner.media_id, 'upload', left(v_title, 200),
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

-- ---- save_file_content (F13 text + media owner) ----
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
      id, organization_id, owner_kind, plan_id, plan_item_id, song_id, arrangement_id, service_type_id, media_id,
      kind, title, category, audience, external_url, filename, mime_type, size_bytes, created_by, updated_by
    ) values (
      case when p_kind = 'link' then private.file_link_id(v_owner.organization_id, v_user, p_idempotency_key) else gen_random_uuid() end,
      v_owner.organization_id, p_owner_kind, v_owner.plan_id, v_owner.plan_item_id, v_owner.song_id,
      v_owner.arrangement_id, v_owner.service_type_id, v_owner.media_id, p_kind, v_title, coalesce(p_category, 'other'),
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

-- ---- copy_plan_children (F11 text + media_id) ----
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
  v_map jsonb := '{}'::jsonb;
  v_source_date timestamptz;
  v_target_date timestamptz;
  v_people uuid[];
  v_selected jsonb;
begin
  if p_items then
    select coalesce(max(sort_order) + 1, 0) into v_base from public.plan_items where plan_id = p_target;
    insert into public.plan_items (
      plan_id, item_type, title, song_id, arrangement_id, key_override,
      length_seconds, description, sort_order,
      sequence_override, leader_person_id, leader_position_id, service_segment, media_id
    )
    -- A legacy row naming another song's arrangement copies as "no
    -- arrangement chosen" instead of failing the whole copy.
    select p_target, i.item_type, i.title, i.song_id,
           case when i.item_type = 'song' and exists (
             select 1 from public.arrangements a where a.id = i.arrangement_id and a.song_id = i.song_id
           ) then i.arrangement_id end,
           i.key_override,
           i.length_seconds, i.description,
           v_base + (row_number() over (order by i.sort_order, i.created_at, i.id))::int - 1,
           case when i.item_type = 'song' then i.sequence_override end,
           case when exists (select 1 from public.people p where p.id = i.leader_person_id and p.archived_at is null)
                then i.leader_person_id end,
           case when exists (select 1 from public.team_positions tp where tp.id = i.leader_position_id and tp.plan_id is null)
                then i.leader_position_id end,
           i.service_segment,
           -- F14: media carries over unless it was archived since (pickers hide it too).
           case when i.item_type = 'item' and exists (
             select 1 from public.media m where m.id = i.media_id and not private.media_is_archived(m)
           ) then i.media_id end
      from public.plan_items i
     where i.plan_id = p_source;
  end if;

  if p_time_offset is not null then
    with source_times as (
      select t.*, gen_random_uuid() new_id from public.plan_times t where t.plan_id = p_source
    ), copied as (
      insert into public.plan_times (id, plan_id, kind, name, starts_at, ends_at, sort_order)
      select s.new_id, p_target, s.kind, s.name, s.starts_at + p_time_offset, s.ends_at + p_time_offset, s.sort_order
        from source_times s
      returning id
    )
    select coalesce(jsonb_object_agg(s.id::text, s.new_id), '{}'::jsonb) into v_map
      from source_times s where s.new_id in (select id from copied);
  else
    select service_date into v_source_date from public.plans where id = p_source;
    select service_date into v_target_date from public.plans where id = p_target;
    select coalesce(jsonb_object_agg(s.id::text, m.id), '{}'::jsonb) into v_map
      from public.plan_times s
      cross join lateral (
        select t.id from public.plan_times t
         where t.plan_id = p_target and t.kind = s.kind
           and coalesce(t.name, '') = coalesce(s.name, '')
           and t.starts_at - v_target_date = s.starts_at - v_source_date
           and t.ends_at - t.starts_at = s.ends_at - s.starts_at
         order by t.sort_order, t.id limit 1
      ) m
     where s.plan_id = p_source;
  end if;

  if p_needs then
    insert into public.plan_position_needs (plan_id, position_id, needed)
    select p_target, n.position_id, n.needed
      from public.plan_position_needs n
      join public.team_positions tp on tp.id = n.position_id and tp.plan_id is null
     where n.plan_id = p_source and n.needed > 0
       and (public.can_edit_plan(p_target)
            or public.can_schedule_on_plan(p_target, private.position_team(n.position_id)))
    on conflict (plan_id, position_id) do nothing;
  end if;

  if p_assignments then
    select coalesce(array_agg(distinct a.person_id), '{}') into v_people
      from public.assignments a where a.plan_id = p_source;
    perform private.lock_scheduling_people(v_people);

    with eligible as (
      select a.*,
             case when a.attendance_mode = 'selected' then array(
               select (v_map->>aat.plan_time_id::text)::uuid
                 from public.assignment_attendance_times aat
                where aat.assignment_id = a.id and v_map ? aat.plan_time_id::text
             ) end mapped_times
        from public.assignments a
       where a.plan_id = p_source
         and exists (select 1 from private.resolve_scheduling_person(p_target, a.person_id, null))
         and (a.position_id is null
              or exists (select 1 from public.team_positions tp where tp.id = a.position_id and tp.plan_id is null))
         and public.can_schedule_on_plan(p_target, a.team_id)
    ), inserted as (
      insert into public.assignments (plan_id, person_id, team_id, position_id, status, created_by, attendance_mode)
      select p_target, e.person_id, e.team_id, e.position_id, 'unconfirmed', (select auth.uid()), e.attendance_mode
        from eligible e
       where e.attendance_mode = 'all' or cardinality(e.mapped_times) > 0
      on conflict do nothing
      returning id, person_id, team_id, position_id
    )
    select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'times', to_jsonb(e.mapped_times))), '[]'::jsonb)
      into v_selected
      from inserted i
      join eligible e on e.person_id = i.person_id and e.team_id = i.team_id
                     and e.position_id is not distinct from i.position_id
     where e.attendance_mode = 'selected';

    -- A separate statement: the policy on selections must see the new rows.
    insert into public.assignment_attendance_times (assignment_id, plan_time_id)
    select (x->>'id')::uuid, t.id::uuid
      from jsonb_array_elements(v_selected) x
      cross join jsonb_array_elements_text(x->'times') t(id)
    on conflict do nothing;

    perform private.check_pending_conflicts();
  end if;
end;
$$;
