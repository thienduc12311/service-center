-- F15 Pass A. Additive: archived rows remain readable, including charts/files.
alter table public.songs add column archived_at timestamptz,
  add column revision bigint not null default 1 check (revision > 0);
alter table public.arrangements add column archived_at timestamptz,
  add column revision bigint not null default 1 check (revision > 0);
create index songs_library_order on public.songs (organization_id, title, id);

create function private.bump_library_revision() returns trigger language plpgsql as $$
begin
  new.revision := old.revision + 1;
  return new;
end $$;
create trigger songs_revision before update on public.songs for each row execute function private.bump_library_revision();
create trigger arrangements_revision before update on public.arrangements for each row execute function private.bump_library_revision();

-- Protect historical references from legacy DELETE endpoints/direct SQL too.
create function private.guard_library_delete() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (tg_table_name = 'songs' and exists (select 1 from public.plan_items where song_id = old.id))
    or (tg_table_name = 'arrangements' and exists (select 1 from public.plan_items where arrangement_id = old.id)) then
    raise exception 'Referenced library records must be archived' using errcode = '23503';
  end if;
  return old;
end $$;
create trigger songs_history before delete on public.songs for each row execute function private.guard_library_delete();
create trigger arrangements_history before delete on public.arrangements for each row execute function private.guard_library_delete();

-- RLS still governs all plan access. Only new/replaced references are rejected;
-- editing an unrelated property on a historical plan remains possible.
create function private.guard_archived_plan_song() returns trigger language plpgsql security definer set search_path = '' as $$
declare s public.songs; a public.arrangements;
begin
  if tg_op = 'UPDATE' and new.song_id is not distinct from old.song_id
    and new.arrangement_id is not distinct from old.arrangement_id then return new; end if;
  if new.song_id is not null then
    select * into s from public.songs where id = new.song_id for share;
    if s.archived_at is not null then raise exception 'Restore the song before scheduling it' using errcode = '22023'; end if;
  end if;
  if new.arrangement_id is not null then
    select * into a from public.arrangements where id = new.arrangement_id for share;
    if a.archived_at is not null then raise exception 'Restore the arrangement before scheduling it' using errcode = '22023'; end if;
  end if;
  return new;
end $$;
create trigger plan_items_active_song before insert or update of song_id, arrangement_id on public.plan_items
  for each row execute function private.guard_archived_plan_song();

-- Query before pagination; EXISTS avoids multiplying songs by arrangements or
-- usage. All source reads execute as the caller (including plans/plan_items).
create function public.list_curated_songs(p_org uuid, p_query jsonb default '{}') returns jsonb
language sql stable security invoker set search_path = '' as $$
  with filtered as (
    select s.*, (
      select max(p.service_date) from public.plan_items i join public.plans p on p.id = i.plan_id where i.song_id = s.id
    ) as last_scheduled_at,
    coalesce((select jsonb_agg(to_jsonb(a) order by a.is_default desc, a.name, a.id)
      from public.arrangements a where a.song_id = s.id
      and (coalesce(p_query->>'archive', 'active') <> 'active' or a.archived_at is null)), '[]') as arrangements
    from public.songs s
    where s.organization_id = p_org
      and case coalesce(p_query->>'archive', 'active') when 'active' then s.archived_at is null
        when 'archived' then s.archived_at is not null else true end
      and (p_query->>'q' is null or s.title ilike '%' || (p_query->>'q') || '%')
      and (p_query->>'theme' is null or s.themes @> array[p_query->>'theme'])
      and (p_query->>'song_type' is null or s.song_types @> array[p_query->>'song_type'])
      and (p_query->>'style' is null or s.style = p_query->>'style')
      and (p_query->>'speed' is null or s.speed = p_query->>'speed')
      and (p_query->>'author' is null or s.author ilike '%' || (p_query->>'author') || '%')
      -- Musical constraints must match the same active arrangement, or the song defaults.
      and ((p_query->>'key' is null and p_query->>'bpm_min' is null and p_query->>'bpm_max' is null)
        or ((p_query->>'key' is null or s.default_key = p_query->>'key')
          and (p_query->>'bpm_min' is null or s.default_bpm >= (p_query->>'bpm_min')::int)
          and (p_query->>'bpm_max' is null or s.default_bpm <= (p_query->>'bpm_max')::int))
        or exists (select 1 from public.arrangements a where a.song_id = s.id and a.archived_at is null
          and (p_query->>'key' is null or a.song_key = p_query->>'key')
          and (p_query->>'bpm_min' is null or a.bpm >= (p_query->>'bpm_min')::int)
          and (p_query->>'bpm_max' is null or a.bpm <= (p_query->>'bpm_max')::int)))
      and ((p_query->>'scheduled_from' is null and p_query->>'scheduled_to' is null) or exists (
        select 1 from public.plan_items i join public.plans p on p.id = i.plan_id where i.song_id = s.id
          and (p_query->>'scheduled_from' is null or p.service_date >= (p_query->>'scheduled_from')::timestamptz)
          and (p_query->>'scheduled_to' is null or p.service_date < (p_query->>'scheduled_to')::timestamptz)))
  ), ordered as (
    select *, row_number() over (order by
      case when p_query->>'sort' = 'recent' then updated_at end desc,
      case when coalesce(p_query->>'sort', 'title') <> 'recent' then title end, id) as rn from filtered
  ), bounds as (
    select greatest(1, coalesce((p_query->>'page')::int, 1)) as page,
      greatest(1, least(200, coalesce((p_query->>'per_page')::int, 25))) as per_page
  )
  select jsonb_build_object('page', b.page, 'per_page', b.per_page, 'total', (select count(*) from filtered),
    'data', coalesce((select jsonb_agg(to_jsonb(o) - 'rn' order by rn) from ordered o
      where rn > (b.page::bigint - 1) * b.per_page and rn <= b.page::bigint * b.per_page), '[]')) from bounds b;
$$;
revoke all on function public.list_curated_songs(uuid,jsonb) from public, anon;
grant execute on function public.list_curated_songs(uuid,jsonb) to authenticated;

create table public.song_bulk_previews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  created_by uuid not null references public.profiles,
  patch jsonb not null,
  rows jsonb not null,
  created_at timestamptz not null default now(),
  committed_at timestamptz
);
create index song_bulk_previews_org on public.song_bulk_previews (organization_id, created_by);
create index song_bulk_previews_creator on public.song_bulk_previews (created_by);
alter table public.song_bulk_previews enable row level security;
create policy song_bulk_previews_read on public.song_bulk_previews for select to authenticated using (
  created_by = (select auth.uid()) and private.capability_for((select auth.uid()), organization_id, 'songs.manage', null, null));
revoke insert, update, delete on public.song_bulk_previews from authenticated, anon;

create table public.song_curation_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  actor_id uuid references public.profiles on delete set null,
  target_kind text not null check (target_kind in ('song','arrangement')),
  target_id uuid not null,
  before_row jsonb not null, after_row jsonb not null,
  preview_id uuid references public.song_bulk_previews,
  created_at timestamptz not null default now()
);
create index song_curation_events_org on public.song_curation_events (organization_id, created_at);
create index song_curation_events_actor on public.song_curation_events (actor_id);
create index song_curation_events_preview on public.song_curation_events (preview_id);
alter table public.song_curation_events enable row level security;
create policy song_curation_events_read on public.song_curation_events for select to authenticated using (
  private.capability_for((select auth.uid()), organization_id, 'songs.manage', null, null));
revoke insert, update, delete on public.song_curation_events from authenticated, anon;

-- Validate SQL callers as well as the HTTP schema. Whole-field replacement is
-- intentional: no additive tag operation with ambiguous replay semantics.
create function private.validate_song_bulk_patch(p jsonb) returns void language plpgsql set search_path = '' as $$
declare k text; v jsonb; n int;
begin
  if p is null or jsonb_typeof(p) <> 'object' or p = '{}' then raise exception 'Empty metadata patch' using errcode = '22023'; end if;
  for k,v in select * from jsonb_each(p) loop
    if k not in ('author','ccli_number','copyright','administration','default_key','default_bpm','meter','themes','song_types','style','speed','notes') then
      raise exception 'Unsupported metadata field' using errcode = '22023';
    end if;
    if k in ('themes','song_types') then
      if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 20 then raise exception 'Invalid tags' using errcode = '22023'; end if;
      if exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'string' or length(e#>>'{}') not between 1 and 40) then
        raise exception 'Invalid tag' using errcode = '22023'; end if;
    elsif v <> 'null' then
      if k = 'default_bpm' then
        if jsonb_typeof(v) <> 'number' or (v#>>'{}')::numeric <> trunc((v#>>'{}')::numeric) or (v#>>'{}')::numeric not between 20 and 300 then
          raise exception 'Invalid BPM' using errcode = '22023'; end if;
      else
        n := case k when 'notes' then 4000 when 'copyright' then 300 when 'administration' then 300 when 'author' then 200 when 'meter' then 20 else 40 end;
        if jsonb_typeof(v) <> 'string' or length(v#>>'{}') > n then raise exception 'Invalid metadata' using errcode = '22023'; end if;
        if k = 'default_key' and length(v#>>'{}') > 8 then raise exception 'Invalid key' using errcode = '22023'; end if;
      end if;
    end if;
  end loop;
end $$;

create function public.preview_song_bulk(p_org uuid, p_rows jsonb, p_patch jsonb) returns public.song_bulk_previews
language plpgsql security definer set search_path = '' as $$
declare r jsonb; s public.songs; a public.songs; result public.song_bulk_previews; outcomes jsonb := '[]';
begin
  if not private.capability_for(auth.uid(), p_org, 'songs.manage', null, null) then raise insufficient_privilege; end if;
  perform private.validate_song_bulk_patch(p_patch);
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 100
    or (select count(distinct e->>'id') from jsonb_array_elements(p_rows) e) <> jsonb_array_length(p_rows) then
    raise exception 'Choose 1 to 100 distinct songs' using errcode = '22023';
  end if;
  for r in select value from jsonb_array_elements(p_rows) order by value->>'id' loop
    select * into s from public.songs where id = (r->>'id')::uuid and organization_id = p_org;
    if not found then raise no_data_found; end if;
    if r->>'expected_revision' is null or s.revision <> (r->>'expected_revision')::bigint then
      raise exception 'song_revision_stale' using errcode = 'PT409', hint = 'song_revision_stale'; end if;
    a := jsonb_populate_record(s, p_patch);
    a.revision := s.revision + 1;
    outcomes := outcomes || jsonb_build_array(jsonb_build_object('id',s.id,'before',to_jsonb(s),'after',to_jsonb(a),'outcome','updated'));
  end loop;
  insert into public.song_bulk_previews (organization_id,created_by,patch,rows) values (p_org,auth.uid(),p_patch,outcomes) returning * into result;
  return result;
end $$;

create function public.commit_song_bulk(p_org uuid, p_preview uuid) returns public.song_bulk_previews
language plpgsql security definer set search_path = '' as $$
declare p public.song_bulk_previews; r jsonb; s public.songs; a public.songs; outcomes jsonb := '[]';
begin
  if not private.capability_for(auth.uid(), p_org, 'songs.manage', null, null) then raise insufficient_privilege; end if;
  select * into p from public.song_bulk_previews where id = p_preview and organization_id = p_org and created_by = auth.uid() for update;
  if not found then raise no_data_found; end if;
  if p.committed_at is not null then return p; end if;
  for r in select value from jsonb_array_elements(p.rows) order by value->>'id' loop
    select * into s from public.songs where id = (r->>'id')::uuid and organization_id = p_org for update;
    if not found then raise no_data_found; end if;
    if s.revision <> (r->'before'->>'revision')::bigint then raise exception 'song_revision_stale' using errcode = 'PT409', hint = 'song_revision_stale'; end if;
    a := jsonb_populate_record(s, p.patch);
    update public.songs set author=a.author, ccli_number=a.ccli_number, copyright=a.copyright,
      administration=a.administration, default_key=a.default_key, default_bpm=a.default_bpm,
      meter=a.meter, themes=a.themes, song_types=a.song_types, style=a.style, speed=a.speed, notes=a.notes
      where id=s.id returning * into a;
    insert into public.song_curation_events (organization_id,actor_id,target_kind,target_id,before_row,after_row,preview_id)
      values (p_org,auth.uid(),'song',s.id,to_jsonb(s),to_jsonb(a),p.id);
    outcomes := outcomes || jsonb_build_array(jsonb_build_object('id',s.id,'before',to_jsonb(s),'after',to_jsonb(a),'outcome','updated'));
  end loop;
  update public.song_bulk_previews set rows=outcomes, committed_at=now() where id=p.id returning * into p;
  return p;
end $$;

create function public.archive_library_record(p_org uuid,p_kind text,p_id uuid,p_revision bigint,p_archived boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.songs; a public.arrangements; before_row jsonb; result jsonb; replacement uuid;
begin
  if not private.capability_for(auth.uid(),p_org,'songs.manage',null,null) then raise insufficient_privilege; end if;
  if p_archived is null then raise exception 'Choose archive or restore' using errcode='22023'; end if;
  if p_kind = 'song' then
    select * into s from public.songs where id=p_id and organization_id=p_org for update;
    if not found then raise no_data_found; end if;
    if p_revision is null or s.revision <> p_revision then raise exception 'song_revision_stale' using errcode='PT409', hint='song_revision_stale'; end if;
    if not p_archived and not exists (select 1 from public.arrangements where song_id=s.id and archived_at is null) then
      raise exception 'Restore an arrangement before restoring the song' using errcode='22023'; end if;
    before_row := to_jsonb(s);
    update public.songs set archived_at=case when p_archived then coalesce(archived_at,now()) end where id=p_id returning to_jsonb(songs) into result;
  elsif p_kind = 'arrangement' then
    -- Parent first: serialize archive/default changes within a song.
    select s0.* into s from public.songs s0 join public.arrangements a0 on a0.song_id=s0.id
      where a0.id=p_id and s0.organization_id=p_org for update of s0;
    if not found then raise no_data_found; end if;
    select * into a from public.arrangements where id=p_id for update;
    if p_revision is null or a.revision <> p_revision then raise exception 'arrangement_revision_stale' using errcode='PT409', hint='arrangement_revision_stale'; end if;
    if p_archived and a.archived_at is null then
      select id into replacement from public.arrangements where song_id=s.id and id<>a.id and archived_at is null order by is_default desc, created_at, id limit 1 for update;
      if replacement is null and s.archived_at is null then raise exception 'Archive the song before its last arrangement' using errcode='22023'; end if;
    end if;
    before_row := to_jsonb(a);
    update public.arrangements set archived_at=case when p_archived then coalesce(archived_at,now()) end,
      is_default=case when p_archived then false else is_default end where id=p_id returning to_jsonb(arrangements) into result;
    if p_archived and a.is_default and replacement is not null then
      update public.arrangements set is_default=true where id=replacement;
    elsif not p_archived and not exists (select 1 from public.arrangements where song_id=s.id and is_default) then
      update public.arrangements set is_default=true where id=p_id returning to_jsonb(arrangements) into result;
    end if;
  else raise exception 'Invalid library kind' using errcode='22023'; end if;
  insert into public.song_curation_events (organization_id,actor_id,target_kind,target_id,before_row,after_row)
    values (p_org,auth.uid(),p_kind,p_id,before_row,result);
  return result;
end $$;
revoke all on function public.preview_song_bulk(uuid,jsonb,jsonb),public.commit_song_bulk(uuid,uuid),public.archive_library_record(uuid,text,uuid,bigint,boolean) from public,anon;
grant execute on function public.preview_song_bulk(uuid,jsonb,jsonb),public.commit_song_bulk(uuid,uuid),public.archive_library_record(uuid,text,uuid,bigint,boolean) to authenticated;

-- Table writers cannot bypass the reviewed archive operation. Existing metadata
-- writers retain their contract; revisions are always generated by triggers.
create function private.guard_library_archive_columns() returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated','anon') and
    ((tg_op='INSERT' and new.archived_at is not null) or
     (tg_op='UPDATE' and new.archived_at is distinct from old.archived_at)) then
    raise exception 'Use the revisioned archive operation' using errcode='42501';
  end if;
  return new;
end $$;
create trigger songs_archive_columns before insert or update on public.songs for each row execute function private.guard_library_archive_columns();
create trigger arrangements_archive_columns before insert or update on public.arrangements for each row execute function private.guard_library_archive_columns();
alter table public.arrangements add constraint arrangements_archived_not_default check (archived_at is null or not is_default);
-- Private helpers must not be exposed as callable RPCs.
revoke all on function private.validate_song_bulk_patch(jsonb), private.bump_library_revision(),
  private.guard_library_delete(), private.guard_archived_plan_song(), private.guard_library_archive_columns() from public,anon,authenticated;

-- A default switch belongs to the arrangement write transaction. In particular,
-- choosing an archived/invalid replacement must not clear the working default.
create function private.switch_arrangement_default() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.songs where id=new.song_id for update;
  if new.is_default and new.archived_at is not null then
    raise exception 'Restore the arrangement before making it the default' using errcode='22023';
  end if;
  if new.is_default and (tg_op='INSERT' or not old.is_default or new.song_id is distinct from old.song_id) then
    update public.arrangements set is_default=false where song_id=new.song_id and id<>new.id and is_default;
  end if;
  return new;
end $$;
create trigger arrangements_default_switch before insert or update on public.arrangements
  for each row execute function private.switch_arrangement_default();
revoke all on function private.switch_arrangement_default() from public,anon,authenticated;
