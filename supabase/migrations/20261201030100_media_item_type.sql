-- Media as its own order item type.
--
-- A `media` item stands for one bundle from the media library (a video,
-- countdown, announcement loop...). It must name that bundle, so the order can
-- show it, LIVE can run it and rehearsal can play it.
--
-- Existing rows are left alone: a regular `item` that links media (F14,
-- `PUT /items/:id/media`) is still valid. It is a talk or reading that happens
-- to use media, which is different from "the item IS the media". Nothing here
-- rewrites user data.
--
-- Where an item type is switched on, `media` is handled like this:
--   * plan_items.media_id may be set on `item` and `media` rows (was `item`
--     only); a `media` row requires it (plan_items_media_ref).
--   * add_plan_item writes media_id; a media item without a title takes the
--     bundle's.
--   * set_plan_item_media changes a media item's bundle but never clears it.
--   * Plan copy (copy_plan_children: duplicate, import, reschedule, create
--     from a plan) keeps media items. Media archived since becomes a regular
--     item without media, the same rule a regular item's link already follows.
--   * Templates save a media item's media_id, check it belongs to the
--     organization, and on apply/generate degrade it to a regular item when
--     the bundle has been archived since.
--   * LIVE snapshots, the next-runnable rule (headers only are skipped),
--     reports, the developer API and song-usage history already treat any
--     non-header item as a timed, non-song row, so they need no change.
--   * RLS on plan_items does not look at item_type; creating a media item is
--     governed by the same plan-edit policies as any other item.

-- ------------------------------------------------------------- constraint --
alter table public.plan_items
  add constraint plan_items_media_ref check (item_type <> 'media' or media_id is not null) not valid;
alter table public.plan_items validate constraint plan_items_media_ref;

-- -------------------------------------------------------------- helpers --

-- The bundle id when it is still in the library (not archived), else null.
-- Security invoker: the caller's RLS decides what it may see, as before.
create or replace function private.plan_item_media_kept(p_media uuid)
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select m.id from public.media m where m.id = p_media and not private.media_is_archived(m);
$$;
revoke all on function private.plan_item_media_kept(uuid) from public, anon, authenticated;
grant execute on function private.plan_item_media_kept(uuid) to authenticated, service_role;

-- Patches one anchored fragment of a function definition, failing loudly when
-- the anchor moved (so a later redefinition can never be silently skipped).
create function pg_temp.media_patch(p_def text, p_from text, p_to text)
returns text
language plpgsql
as $$
begin
  if strpos(p_def, p_from) = 0 then
    raise exception 'media item type migration: anchor not found: %', left(p_from, 120);
  end if;
  return replace(p_def, p_from, p_to);
end;
$$;

-- ------------------------------------------------- media link validation --
create or replace function private.validate_plan_item_media()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_media public.media;
begin
  -- Songs and headers never carry media; items and media items may.
  if new.item_type not in ('item', 'media') then
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

-- ------------------------------------------------------- change the media --
create or replace function public.set_plan_item_media(
  p_plan_id uuid,
  p_item_id uuid,
  p_media_id uuid,
  p_expected_revision bigint default null
)
returns jsonb
language plpgsql
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
  if v_item.item_type not in ('item', 'media') then
    raise exception 'Only a regular item or a media item can link media' using errcode = '22023';
  end if;
  if v_item.item_type = 'media' and p_media_id is null then
    raise exception 'A media item needs its media; choose other media or remove the item'
      using errcode = '22023', hint = 'media_item_needs_media';
  end if;
  update public.plan_items set media_id = p_media_id, updated_at = now()
   where id = p_item_id returning * into v_item;
  return jsonb_build_object(
    'item', to_jsonb(v_item),
    'content_revision', (select content_revision from public.plans where id = p_plan_id));
end;
$$;

-- ------------------------------------------------------------- add item --
do $patch$
declare
  d text := pg_get_functiondef('public.add_plan_item(uuid, jsonb, text)'::regprocedure);
begin
  d := pg_temp.media_patch(d,
$f$    v_title := coalesce(v_title, 'Untitled song');
  end if;$f$,
$t$    v_title := coalesce(v_title, 'Untitled song');
  end if;
  -- A media item may omit the title; it takes the bundle's.
  if v_title is null and v_type = 'media' then
    select m.title into v_title from public.media m where m.id = (p_item ->> 'media_id')::uuid;
    v_title := coalesce(v_title, 'Untitled media');
  end if;$t$);
  d := pg_temp.media_patch(d,
$f$    length_seconds, description, leader_person_id, leader_position_id, service_segment, sort_order
  ) values ($f$,
$t$    length_seconds, description, leader_person_id, leader_position_id, service_segment, sort_order, media_id
  ) values ($t$);
  d := pg_temp.media_patch(d,
$f$    coalesce(p_item ->> 'service_segment', 'service'),
    v_sort
  )$f$,
$t$    coalesce(p_item ->> 'service_segment', 'service'),
    v_sort,
    (p_item ->> 'media_id')::uuid
  )$t$);
  execute d;
end;
$patch$;

-- ------------------------------------------------------------ plan copy --
do $patch$
declare
  d text := pg_get_functiondef(
    'private.copy_plan_children(uuid, uuid, boolean, boolean, boolean, interval)'::regprocedure);
begin
  d := pg_temp.media_patch(d,
$f$    select p_target, i.item_type, i.title, i.song_id,$f$,
$t$    select p_target,
           -- A media item whose bundle was archived since copies as a regular item.
           case when i.item_type = 'media' and private.plan_item_media_kept(i.media_id) is null
                then 'item'::public.plan_item_type else i.item_type end,
           i.title, i.song_id,$t$);
  d := pg_temp.media_patch(d,
$f$           case when i.item_type = 'item' and exists (
             select 1 from public.media m where m.id = i.media_id and not private.media_is_archived(m)
           ) then i.media_id end$f$,
$t$           case when i.item_type in ('item', 'media') then private.plan_item_media_kept(i.media_id) end$t$);
  execute d;
end;
$patch$;

-- ------------------------------------------------------------ templates --

-- Saving from a plan keeps a media item's bundle.
do $patch$
declare
  d text := pg_get_functiondef('private.plan_template_content_from_plan(uuid, text[])'::regprocedure);
begin
  d := pg_temp.media_patch(d,
$f$               'length_seconds', i.length_seconds, 'description', i.description
             ) order by i.sort_order, i.created_at, i.id)$f$,
$t$               'length_seconds', i.length_seconds, 'description', i.description,
               'media_id', case when i.item_type = 'media' then i.media_id end
             ) order by i.sort_order, i.created_at, i.id)$t$);
  execute d;
end;
$patch$;

-- A media item needs a bundle of this organization; only media items keep media_id.
do $patch$
declare
  d text := pg_get_functiondef('private.plan_template_normalize(uuid, text, jsonb)'::regprocedure);
begin
  d := pg_temp.media_patch(d,
$f$  v_arr     uuid;
$f$,
$t$  v_arr     uuid;
  v_media   uuid;
$t$);
  d := pg_temp.media_patch(d,
$f$    if v_type not in ('song', 'header', 'item') then
      perform private.f10_bad('Item type must be song, header or item');
    end if;$f$,
$t$    if v_type not in ('song', 'header', 'item', 'media') then
      perform private.f10_bad('Item type must be song, header, item or media');
    end if;$t$);
  d := pg_temp.media_patch(d,
$f$    if v_title is null then
      perform private.f10_bad(format('Item %s needs a title', v_i));
    end if;$f$,
$t$    v_media := null;
    if v_type = 'media' then
      v_media := private.f10_uuid(v_el -> 'media_id', 'Media');
      if v_media is null then
        perform private.f10_bad(format('Media item %s needs media', v_i));
      end if;
      select coalesce(v_title, m.title) into v_title
        from public.media m where m.id = v_media and m.organization_id = p_org;
      if not found then
        perform private.f10_bad(format('Item %s uses media that is not in this organization', v_i));
      end if;
    end if;
    if v_title is null then
      perform private.f10_bad(format('Item %s needs a title', v_i));
    end if;$t$);
  d := pg_temp.media_patch(d,
$f$      'description', private.f10_text(v_el -> 'description', 4000, 'Item description')
    ));$f$,
$t$      'description', private.f10_text(v_el -> 'description', 4000, 'Item description')
    ) || case when v_type = 'media' then jsonb_build_object('media_id', v_media) else '{}'::jsonb end);$t$);
  execute d;
end;
$patch$;

-- Applying/generating writes the bundle; one archived since degrades the item.
do $patch$
declare
  d text := pg_get_functiondef('private.plan_template_write(uuid, jsonb, text)'::regprocedure);
begin
  d := pg_temp.media_patch(d,
$f$        plan_id, item_type, title, song_id, arrangement_id, key_override, length_seconds, description, sort_order
      )
      select p_plan, (e.value ->> 'item_type')::public.plan_item_type, e.value ->> 'title',$f$,
$t$        plan_id, item_type, title, song_id, arrangement_id, key_override, length_seconds, description, sort_order, media_id
      )
      select p_plan,
             case when (e.value ->> 'item_type') = 'media'
                       and private.plan_item_media_kept((e.value ->> 'media_id')::uuid) is null
                  then 'item'::public.plan_item_type
                  else (e.value ->> 'item_type')::public.plan_item_type end,
             e.value ->> 'title',$t$);
  d := pg_temp.media_patch(d,
$f$             (e.value ->> 'length_seconds')::int, e.value ->> 'description', v_at + e.ord::int - 1
        from jsonb_array_elements(p_preview #> '{items,add}') with ordinality e(value, ord);$f$,
$t$             (e.value ->> 'length_seconds')::int, e.value ->> 'description', v_at + e.ord::int - 1,
             case when (e.value ->> 'item_type') = 'media'
                  then private.plan_item_media_kept((e.value ->> 'media_id')::uuid) end
        from jsonb_array_elements(p_preview #> '{items,add}') with ordinality e(value, ord);$t$);
  execute d;
end;
$patch$;

drop function pg_temp.media_patch(text, text, text);
