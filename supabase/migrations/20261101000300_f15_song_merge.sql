-- Selected optional F15 merge. Retain a read-only loser tombstone and all IDs.
alter table public.songs add column merged_into_song_id uuid references public.songs(id) on delete restrict,
  add column merged_default_arrangement_id uuid references public.arrangements(id) on delete restrict,
  add constraint songs_merged_archived check (merged_into_song_id is null or archived_at is not null),
  add constraint songs_merge_not_self check (merged_into_song_id is distinct from id);
create index songs_merged_into on public.songs(merged_into_song_id) where merged_into_song_id is not null;
alter table public.attachments alter constraint attachments_arrangement_fk deferrable initially immediate;
-- Clients cannot forge merge state through legacy table endpoints.
revoke insert,update on public.songs from authenticated;
grant insert(id,organization_id,title,author,ccli_number,copyright,administration,default_key,default_bpm,meter,themes,song_types,style,speed,notes,created_by,created_at,updated_at,archived_at,revision),
  update(id,organization_id,title,author,ccli_number,copyright,administration,default_key,default_bpm,meter,themes,song_types,style,speed,notes,created_by,created_at,updated_at,archived_at,revision) on public.songs to authenticated;
-- One book may deliberately retain both arrangement versions after a merge.
alter table public.songbook_items drop constraint songbook_items_songbook_id_song_id_key;
alter table public.songbook_items add constraint songbook_items_version_key unique nulls not distinct(songbook_id,song_id,arrangement_id);

create function private.guard_merged_song() returns trigger language plpgsql set search_path='' as $$
begin
  if old.merged_into_song_id is not null and current_setting('service_center.merging',true) is distinct from 'yes' then
    raise exception 'Merged songs are retained as read-only history' using errcode='22023';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger songs_merged_guard before update or delete on public.songs for each row execute function private.guard_merged_song();

-- Legacy templates/copy requests may still hold old IDs. Canonicalize only
-- newly selected references; pinned live snapshots and revision JSON stay intact.
create function private.canonical_plan_song() returns trigger language plpgsql security definer set search_path='' as $$
declare s public.songs;
begin
  if tg_op='UPDATE' and new.song_id is not distinct from old.song_id and new.arrangement_id is not distinct from old.arrangement_id then return new; end if;
  if new.song_id is not null then
    select * into s from public.songs where id=new.song_id for share;
    if s.merged_into_song_id is not null then
      new.song_id:=s.merged_into_song_id;
      new.arrangement_id:=coalesce(new.arrangement_id,s.merged_default_arrangement_id);
    end if;
  end if;
  if tg_table_name='songbook_items' then
    if (select organization_id from public.songbooks where id=new.songbook_id) is distinct from
      (select organization_id from public.songs where id=new.song_id)
      or (new.arrangement_id is not null and not exists(select 1 from public.arrangements where id=new.arrangement_id and song_id=new.song_id)) then
      raise exception 'Songbook song and arrangement must belong to its organization' using errcode='22023'; end if;
    if current_setting('service_center.merging',true) is distinct from 'yes' and (
      exists(select 1 from public.songs where id=new.song_id and archived_at is not null)
      or exists(select 1 from public.arrangements where id=new.arrangement_id and archived_at is not null)) then
      raise exception 'Restore the selected song or arrangement first' using errcode='22023'; end if;
  end if;
  return new;
end $$;
create trigger plan_items_00_canonical_song before insert or update of song_id,arrangement_id on public.plan_items for each row execute function private.canonical_plan_song();
create trigger songbook_items_00_canonical_song before insert or update of song_id,arrangement_id on public.songbook_items for each row execute function private.canonical_plan_song();

create function private.canonical_song_content(p_content jsonb) returns jsonb language sql stable security invoker set search_path='' as $$
 select case when jsonb_typeof(p_content->'items')='array' then jsonb_set(p_content,'{items}',coalesce((
   select jsonb_agg(case when s.merged_into_song_id is not null then e.value||jsonb_build_object(
     'song_id',s.merged_into_song_id,'arrangement_id',coalesce(nullif(e.value->>'arrangement_id','')::uuid,s.merged_default_arrangement_id)) else e.value end order by e.ordinality)
   from jsonb_array_elements(p_content->'items') with ordinality e(value,ordinality)
   left join public.songs s on s.id=nullif(e.value->>'song_id','')::uuid),'[]')) else p_content end
$$;
-- Preserve the existing F10 implementation and every immutable saved revision.
-- Assert the insertion point so replay cannot silently skip compatibility.
do $$ declare d text; begin
  d:=pg_get_functiondef('private.plan_template_preview(uuid,uuid,uuid,date,uuid,text,text[],jsonb,integer)'::regprocedure);
  if strpos(d,'v_content := v_rev.content;')=0 then raise exception 'F10 preview integration point missing'; end if;
  execute replace(d,'v_content := v_rev.content;','v_content := private.canonical_song_content(v_rev.content);');
  d:=pg_get_functiondef('private.plan_template_normalize(uuid,text,jsonb)'::regprocedure);
  if strpos(d,E'begin\n')=0 then raise exception 'F10 normalize integration point missing'; end if;
  execute replace(d,E'begin\n',E'begin\n  p_content := private.canonical_song_content(p_content);\n');
end $$;

create function public.song_duplicate_candidates(p_org uuid,p_song uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.songs; result jsonb;
begin
  if not private.can_import(p_org,'songs') then raise exception 'songs.manage required' using errcode='42501'; end if;
  select * into s from public.songs where id=p_song and organization_id=p_org;
  if not found then raise exception 'Song unavailable' using errcode='PT404'; end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.title,t.id),'[]') into result from (
    select id,title,case when nullif(btrim(s.ccli_number),'') is not null and btrim(ccli_number)=btrim(s.ccli_number) then 'ccli' else 'title' end as reason
    from public.songs where organization_id=p_org and id<>s.id and archived_at is null and merged_into_song_id is null
      and (lower(btrim(title))=lower(btrim(s.title)) or (nullif(btrim(s.ccli_number),'') is not null and btrim(ccli_number)=btrim(s.ccli_number)))
    order by title,id limit 50) t;
  return result;
end $$;

-- Full private inventory is retained in provenance; only safe counts and policy
-- leave the function. Permission on every affected plan is required first.
create function private.song_merge_state(p_org uuid,p_winner uuid,p_loser uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare w public.songs; l public.songs; state jsonb; history_ids uuid[];
begin
  if not private.can_import(p_org,'songs') then raise exception 'songs.manage required' using errcode='42501'; end if;
  select * into w from public.songs where id=p_winner and organization_id=p_org;
  select * into l from public.songs where id=p_loser and organization_id=p_org;
  if w.id is null or l.id is null or w.id=l.id then raise exception 'Two organization songs required' using errcode='22023'; end if;
  select array_agg(id) into history_ids from public.songs where id in(w.id,l.id) or merged_into_song_id in(w.id,l.id);
  if exists(select 1 from public.plan_items i where i.song_id in(w.id,l.id) and not public.can_edit_plan(i.plan_id)) then
    raise exception 'Merge requires edit access to every affected plan' using errcode='42501'; end if;
  if exists(select 1 from public.attachments f where f.song_id in(w.id,l.id)
    and (not private.can_read_attachment(auth.uid(),f.id) or not private.can_write_attachment(auth.uid(),f.id)))
    or exists(select 1 from public.plan_template_revisions r join public.plan_templates t on t.id=r.template_id
      where r.organization_id=p_org and not private.plan_template_access(auth.uid(),p_org,t.service_type_id,true)
      and exists(select 1 from jsonb_array_elements(r.content->'items') i where i->>'song_id'=any(history_ids::text[]))) then
    raise exception 'Merge requires access to all affected files and template scopes' using errcode='42501'; end if;
  if exists(select 1 from public.songbook_items i join public.songbooks b on b.id=i.songbook_id where i.song_id in(w.id,l.id) and b.organization_id<>p_org) then raise exception 'Merge requires all references in the same organization' using errcode='42501'; end if;
  if exists(select 1 from public.live_runs r where r.organization_id=p_org and not public.can_edit_plan(r.plan_id)
    and exists(select 1 from jsonb_array_elements(r.snapshot) i where i->>'song_id'=any(history_ids::text[]))) then
    raise exception 'Merge requires access to affected live history' using errcode='42501'; end if;
  state:=jsonb_build_object('winner',to_jsonb(w),'loser',to_jsonb(l),
    'arrangements',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.arrangements a where song_id in(w.id,l.id)),'[]'),
    'keys',coalesce((select jsonb_agg(to_jsonb(k) order by k.id) from public.arrangement_keys k join public.arrangements a on a.id=k.arrangement_id where a.song_id in(w.id,l.id)),'[]'),
    'file_links',coalesce((select jsonb_agg(to_jsonb(f) order by f.id) from public.arrangement_file_links f join public.arrangements a on a.id=f.arrangement_id where a.song_id in(w.id,l.id)),'[]'),
    'files',coalesce((select jsonb_agg(to_jsonb(f) order by f.id) from public.attachments f where song_id in(w.id,l.id)),'[]'),
    'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from public.plan_items i where song_id in(w.id,l.id)),'[]'),
    'books',coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from public.songbook_items i where song_id in(w.id,l.id)),'[]'),
    'templates',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'template_id',r.template_id,'revision',r.revision,'content_hash',private.import_version(r.content)) order by r.id)
      from public.plan_template_revisions r where r.organization_id=p_org and exists(select 1 from jsonb_array_elements(r.content->'items') i where i->>'song_id'=any(history_ids::text[]))),'[]'),
    'live_history',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'plan_id',r.plan_id,'snapshot_hash',private.import_version(r.snapshot)) order by r.id) from public.live_runs r where r.organization_id=p_org and exists(select 1 from jsonb_array_elements(r.snapshot) i where i->>'song_id'=any(history_ids::text[]))),'[]'),
    'aliases',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from public.songs s where merged_into_song_id in(w.id,l.id)),'[]'));
  return state;
end $$;
create function private.song_merge_preview(p_state jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare w jsonb:=p_state->'winner'; l jsonb:=p_state->'loser'; blockers jsonb:='[]';
begin
  if w->>'merged_into_song_id' is not null or l->>'merged_into_song_id' is not null then blockers:=blockers||'"Choose canonical songs"'::jsonb; end if;
  if w->>'archived_at' is not null or l->>'archived_at' is not null then blockers:=blockers||'"Restore both songs first"'::jsonb; end if;
  -- NULL means inherit in the legacy arrangement contract. An unknown
  -- losing fallback cannot be frozen as NULL under a different known parent.
  if exists(select 1 from jsonb_array_elements(p_state->'arrangements') a where a->>'song_id'=l->>'id' and (
    (a->>'song_key' is null and l->>'default_key' is null and w->>'default_key' is not null)
    or (a->>'bpm' is null and l->>'default_bpm' is null and w->>'default_bpm' is not null)
    or (a->>'meter' is null and l->>'meter' is null and w->>'meter' is not null))) then
    blockers:=blockers||'"Resolve unknown losing key/tempo/meter before inheriting a different known song default"'::jsonb; end if;
  if not exists(select 1 from jsonb_array_elements(p_state->'arrangements') a where a->>'song_id'=l->>'id' and (a->>'is_default')::boolean and a->>'archived_at' is null) then blockers:=blockers||'"The losing song needs an active default arrangement to preserve inherited history"'::jsonb; end if;
  if not exists(select 1 from jsonb_array_elements(p_state->'arrangements') a where a->>'song_id'=w->>'id' and (a->>'is_default')::boolean and a->>'archived_at' is null) then blockers:=blockers||'"The kept song needs an active default arrangement"'::jsonb; end if;
  if exists(select 1 from jsonb_array_elements(p_state->'books') b where b->>'arrangement_id' is not null and not exists(
    select 1 from jsonb_array_elements(p_state->'arrangements') a where a->>'id'=b->>'arrangement_id' and a->>'song_id'=b->>'song_id')) then
    blockers:=blockers||'"Resolve inconsistent songbook arrangement references first"'::jsonb; end if;
  if exists(select 1 from jsonb_array_elements(p_state->'books') b group by b->>'songbook_id',
    case when b->>'song_id'=l->>'id' then coalesce(b->>'arrangement_id',(select a->>'id' from jsonb_array_elements(p_state->'arrangements') a where a->>'song_id'=l->>'id' and (a->>'is_default')::boolean limit 1)) else b->>'arrangement_id' end having count(*)>1) then
    blockers:=blockers||'"Resolve duplicate songbook arrangement entries first"'::jsonb; end if;
  if jsonb_array_length(p_state->'items')>1000 or jsonb_array_length(p_state->'books')>1000 or jsonb_array_length(p_state->'arrangements')>200 or jsonb_array_length(p_state->'files')>500 then blockers:=blockers||'"Merge exceeds the bounded transaction; curate smaller groups first"'::jsonb; end if;
  return jsonb_build_object('winner_id',w->>'id','loser_id',l->>'id','winner_title',w->>'title','loser_title',l->>'title',
    'fingerprint',private.import_version(p_state),'arrangements',jsonb_array_length(p_state->'arrangements'),
    'files',jsonb_array_length(p_state->'files'),'keys',jsonb_array_length(p_state->'keys'),
    'plan_items',jsonb_array_length(p_state->'items'),'songbook_items',jsonb_array_length(p_state->'books'),
    'template_revisions',jsonb_array_length(p_state->'templates'),'blockers',blockers,
    'live_history',jsonb_array_length(p_state->'live_history'),
    'metadata',(select jsonb_agg(jsonb_build_object('field',field,'kept',w->field,'losing',l->field) order by field) from unnest(array['title','author','ccli_number','copyright','administration','default_key','default_bpm','meter','themes','song_types','style','speed','notes']) field),
    'arrangement_details',(select coalesce(jsonb_agg(jsonb_build_object('id',a->'id','song_id',a->'song_id','name',a->'name','is_default',a->'is_default','archived_at',a->'archived_at','song_key',a->'song_key')),'[]') from jsonb_array_elements(p_state->'arrangements') a),
    'file_details',(select coalesce(jsonb_agg(jsonb_build_object('id',f->'id','title',f->'title','arrangement_id',f->'arrangement_id','audience',f->'audience','playback_rights',f->'playback_rights')),'[]') from jsonb_array_elements(p_state->'files') f),
    'key_details',(select coalesce(jsonb_agg(jsonb_build_object('id',k->'id','arrangement_id',k->'arrangement_id','label',k->'label','song_key',k->'song_key','capo',k->'capo','vocal_label',k->'vocal_label')),'[]') from jsonb_array_elements(p_state->'keys') k),
    'plan_references',(select coalesce(jsonb_agg(jsonb_build_object('id',i->'id','parent_id',i->'plan_id','title',i->'title','song_id',i->'song_id','arrangement_id',i->'arrangement_id','key_override',i->'key_override')),'[]') from jsonb_array_elements(p_state->'items') i),
    'book_references',(select coalesce(jsonb_agg(jsonb_build_object('id',i->'id','parent_id',i->'songbook_id','song_id',i->'song_id','arrangement_id',i->'arrangement_id')),'[]') from jsonb_array_elements(p_state->'books') i),
    'template_details',(select coalesce(jsonb_agg(t-'content_hash'),'[]') from jsonb_array_elements(p_state->'templates') t),
    'policy','Keep winner metadata/default. Move losing arrangements and files with IDs, audiences and versions intact. Freeze inherited losing key/BPM/meter/default on existing references. Preserve both songbook versions. Retain immutable template/live history and a read-only historical song; old templates continue to use the moved arrangements. Key labels and scoped files stay under their arrangements. Provenance retains the full before state; no automatic undo.');
end $$;
create function public.preview_song_merge(p_org uuid,p_winner uuid,p_loser uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select private.song_merge_preview(private.song_merge_state(p_org,p_winner,p_loser))
$$;
create function public.commit_song_merge(p_org uuid,p_winner uuid,p_loser uuid,p_fingerprint text,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='3s' set statement_timeout='15s' as $$
declare op public.library_operations; state jsonb; preview jsonb; l public.songs; old_default uuid; result jsonb; op_id uuid:=gen_random_uuid();
begin
  if not private.can_import(p_org,'songs') then raise exception 'songs.manage required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org::text||auth.uid()::text||p_key::text,0));
  select * into op from public.library_operations where organization_id=p_org and actor_id=auth.uid() and idempotency_key=p_key;
  if found then
    if op.kind<>'merge_song' or op.input<>jsonb_build_object('winner',p_winner,'loser',p_loser,'fingerprint',p_fingerprint) then raise exception 'Idempotency key reused' using errcode='PT409'; end if;
    -- Recheck plan scope even on replay.
    perform private.song_merge_state(p_org,p_winner,p_loser);
    return op.result;
  end if;
  -- Rare explicit maintenance operation. Stable table lock order closes races
  -- with legacy writers lacking parent locks; no network work in this transaction.
  lock table public.songs,public.arrangements,public.arrangement_keys,public.arrangement_file_links,
    public.attachments,public.plan_items,public.songbook_items,public.plan_template_revisions,public.live_runs in share row exclusive mode;
  state:=private.song_merge_state(p_org,p_winner,p_loser);
  preview:=private.song_merge_preview(state);
  if preview->>'fingerprint' is distinct from p_fingerprint then raise exception 'Library or references changed; preview again' using errcode='PT409',hint='library_changed'; end if;
  if preview->'blockers'<>'[]'::jsonb then raise exception 'Resolve merge blockers first' using errcode='22023'; end if;
  select * into l from public.songs where id=p_loser;
  select id into old_default from public.arrangements where song_id=l.id and is_default and archived_at is null;
  set constraints public.attachments_arrangement_fk deferred;
  perform set_config('service_center.merging','yes',true);
  update public.arrangements set is_default=false where song_id=l.id and is_default;
  update public.arrangements set song_id=p_winner,song_key=coalesce(song_key,l.default_key),bpm=coalesce(bpm,l.default_bpm),meter=coalesce(meter,l.meter) where song_id=l.id;
  update public.attachments set song_id=p_winner where song_id=l.id;
  -- The FK/reference validators now see the final canonical parent.
  update public.plan_items set song_id=p_winner,arrangement_id=coalesce(arrangement_id,old_default) where song_id=l.id;
  update public.songbook_items set song_id=p_winner,arrangement_id=coalesce(arrangement_id,old_default) where song_id=l.id;
  update public.songs set merged_into_song_id=p_winner where merged_into_song_id=l.id;
  update public.songs set archived_at=now(),merged_into_song_id=p_winner,merged_default_arrangement_id=old_default where id=l.id;
  set constraints public.attachments_arrangement_fk immediate;
  result:=jsonb_build_object('winner_id',p_winner,'loser_id',p_loser,'operation_id',op_id);
  insert into public.library_operations(id,organization_id,actor_id,idempotency_key,kind,input,before_state,result)
    values(op_id,p_org,auth.uid(),p_key,'merge_song',jsonb_build_object('winner',p_winner,'loser',p_loser,'fingerprint',p_fingerprint),state,result);
  perform set_config('service_center.merging','no',true);
  return result;
end $$;
revoke all on function private.guard_merged_song(),private.canonical_plan_song(),private.canonical_song_content(jsonb),private.song_merge_state(uuid,uuid,uuid),private.song_merge_preview(jsonb) from public,anon,authenticated;
revoke all on function public.song_duplicate_candidates(uuid,uuid),public.preview_song_merge(uuid,uuid,uuid),public.commit_song_merge(uuid,uuid,uuid,text,uuid) from public,anon;
grant execute on function public.song_duplicate_candidates(uuid,uuid),public.preview_song_merge(uuid,uuid,uuid),public.commit_song_merge(uuid,uuid,uuid,text,uuid) to authenticated;

create or replace function private.guard_archived_plan_song() returns trigger language plpgsql security definer set search_path='' as $$
declare s public.songs; a public.arrangements;
begin
  if tg_op='UPDATE' and new.song_id is not distinct from old.song_id and new.arrangement_id is not distinct from old.arrangement_id then return new; end if;
  if tg_op='UPDATE' and current_setting('service_center.merging',true)='yes'
    and (old.arrangement_id is null or old.arrangement_id=new.arrangement_id)
    and exists(select 1 from public.arrangements where id=new.arrangement_id and song_id=new.song_id) then return new; end if;
  if new.song_id is not null then
    select * into s from public.songs where id=new.song_id for share;
    if s.archived_at is not null then raise exception 'Restore the song before scheduling it' using errcode='22023'; end if;
  end if;
  if new.arrangement_id is not null then
    select * into a from public.arrangements where id=new.arrangement_id for share;
    if a.archived_at is not null then raise exception 'Restore the arrangement before scheduling it' using errcode='22023'; end if;
  end if;
  return new;
end $$;

grant execute on function private.canonical_song_content(jsonb) to authenticated;
