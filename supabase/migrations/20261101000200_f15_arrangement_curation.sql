-- F15 C: metadata is additive; legacy item key strings remain the effective key.
create table public.arrangement_keys (
  id uuid primary key default gen_random_uuid(),
  arrangement_id uuid not null references public.arrangements(id) on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 80),
  song_key text not null check (song_key ~ '^[A-G](#|b)?(m)?$'),
  capo integer check (capo between 0 and 11),
  vocal_label text check (length(vocal_label) <= 80),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  unique (arrangement_id, song_key), unique (id, arrangement_id)
);
create table public.arrangement_file_links (
  id uuid primary key default gen_random_uuid(),
  arrangement_id uuid not null references public.arrangements(id) on delete cascade,
  attachment_id uuid not null references public.attachments(id) on delete no action deferrable initially immediate,
  key_id uuid,
  foreign key (key_id, arrangement_id) references public.arrangement_keys(id, arrangement_id) on delete cascade,
  unique nulls not distinct (arrangement_id, attachment_id, key_id)
);
create index arrangement_file_links_attachment on public.arrangement_file_links(attachment_id);
create index arrangement_file_links_key on public.arrangement_file_links(key_id);
create table public.library_operations (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  actor_id uuid not null references auth.users(id), idempotency_key uuid not null,
  kind text not null check (kind in ('duplicate_arrangement','save_key','merge_song')),
  input jsonb not null, before_state jsonb not null, result jsonb not null,
  created_at timestamptz not null default now(), unique (organization_id,actor_id,idempotency_key)
);
alter table public.arrangement_keys enable row level security;
alter table public.arrangement_file_links enable row level security;
alter table public.library_operations enable row level security;
create policy arrangement_keys_read on public.arrangement_keys for select to authenticated using (
  exists (select 1 from public.arrangements a join public.songs s on s.id=a.song_id
    where a.id=arrangement_id and public.is_org_member(s.organization_id)));
create policy arrangement_file_links_read on public.arrangement_file_links for select to authenticated using (
  exists (select 1 from public.arrangements a join public.songs s on s.id=a.song_id
    where a.id=arrangement_id and public.is_org_member(s.organization_id))
  and private.can_read_attachment(auth.uid(),attachment_id));
create policy library_operations_read on public.library_operations for select to authenticated using (
  actor_id=(select auth.uid()) and private.can_import(organization_id,'songs'));
revoke all on public.arrangement_keys,public.arrangement_file_links,public.library_operations from anon,authenticated;
grant select on public.arrangement_keys,public.arrangement_file_links to authenticated;
-- Full before snapshots remain private; they can contain later-revoked material.
grant select(id,organization_id,actor_id,kind,result,created_at) on public.library_operations to authenticated;
create trigger arrangement_keys_revision before update on public.arrangement_keys for each row execute function private.bump_library_revision();

create function private.curation_arrangement(p_org uuid,p_id uuid,p_write boolean default false) returns public.arrangements
language plpgsql security definer set search_path='' as $$
declare a public.arrangements; s public.songs;
begin
  select * into a from public.arrangements where id=p_id;
  select * into s from public.songs where id=a.song_id and organization_id=p_org;
  if s.id is null or not public.is_org_member(p_org) then raise exception 'Arrangement unavailable' using errcode='PT404'; end if;
  if p_write and (not private.can_import(p_org,'songs') or s.archived_at is not null or a.archived_at is not null) then
    raise exception 'Active library and songs.manage required' using errcode='42501'; end if;
  return a;
end $$;

-- Returns only F13-readable materials. No content, paths or signed URLs.
create function public.arrangement_materials(p_org uuid,p_arrangement uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a public.arrangements; result jsonb;
begin
  a:=private.curation_arrangement(p_org,p_arrangement);
  select jsonb_build_object('keys',coalesce((select jsonb_agg(to_jsonb(k)||jsonb_build_object('file_ids',coalesce((
      select jsonb_agg(l.attachment_id order by l.attachment_id) from public.arrangement_file_links l
      where l.key_id=k.id and private.can_read_attachment(auth.uid(),l.attachment_id)), '[]')) order by k.label,k.id)
      from public.arrangement_keys k where k.arrangement_id=a.id),'[]'),
    'files',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'title',f.title,'revision',f.revision,
      'reused',f.arrangement_id is distinct from a.id,'key_ids',coalesce((select jsonb_agg(l.key_id order by l.key_id)
        from public.arrangement_file_links l where l.arrangement_id=a.id and l.attachment_id=f.id and l.key_id is not null),'[]')) order by f.title,f.id)
      from public.attachments f where f.song_id=a.song_id and f.archived_at is null
        and private.can_read_attachment(auth.uid(),f.id)
        and (f.arrangement_id=a.id or f.owner_kind='song' or exists (select 1 from public.arrangement_file_links l where l.arrangement_id=a.id and l.attachment_id=f.id))), '[]')) into result;
  return result;
end $$;

create function public.save_arrangement_key(p_org uuid,p_arrangement uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.arrangements; k public.arrangement_keys; f uuid; existing public.library_operations; snapshot jsonb; result jsonb;
begin
  -- Parent lock serializes key edits, duplication and archive of this arrangement.
  perform 1 from public.songs where id=(select song_id from public.arrangements where id=p_arrangement) for update;
  perform 1 from public.arrangements where id=p_arrangement for update;
  a:=private.curation_arrangement(p_org,p_arrangement,true);
  if coalesce(jsonb_typeof(p_input->'file_ids'),'null')<>'array' or jsonb_array_length(p_input->'file_ids')>100 then raise exception 'Invalid files' using errcode='22023'; end if;
  select * into k from public.arrangement_keys where id=(p_input->>'id')::uuid for update;
  if k.id is not null and (k.arrangement_id<>a.id or k.song_key<>p_input->>'song_key') then raise exception 'Key pitch and parent cannot change; add another key' using errcode='22023'; end if;
  if (k.id is null and p_input->>'expected_revision' is not null) or (k.id is not null and k.revision is distinct from (p_input->>'expected_revision')::bigint) then
    -- Repeating an identical create is safe, without overwriting later edits.
    select * into existing from public.library_operations where organization_id=p_org and actor_id=auth.uid() and idempotency_key=(p_input->>'id')::uuid and kind='save_key';
    if p_input->>'expected_revision' is null and existing.input=p_input then return existing.result; end if;
    raise exception 'Key changed; reload' using errcode='PT409',hint='library_changed';
  end if;
  if coalesce(p_input->>'label','')='' or coalesce(p_input->>'song_key','') !~ '^[A-G](#|b)?m?$'
    or exists(select 1 from jsonb_object_keys(p_input) fields(field) where fields.field not in ('id','expected_revision','label','song_key','capo','vocal_label','file_ids'))
    or (select count(distinct value) from jsonb_array_elements_text(p_input->'file_ids'))<>jsonb_array_length(p_input->'file_ids') then
    raise exception 'Invalid labeled key' using errcode='22023'; end if;
  snapshot:=to_jsonb(k);
  for f in select value::uuid from jsonb_array_elements_text(p_input->'file_ids') loop
    if not exists (select 1 from public.attachments where id=f and song_id=a.song_id and owner_kind in ('song','arrangement') and archived_at is null)
      or not private.can_read_attachment(auth.uid(),f) or not private.can_write_attachment(auth.uid(),f) then raise exception 'File unavailable for reuse' using errcode='42501'; end if;
    perform 1 from public.attachments where id=f for share;
  end loop;
  if k.id is null then
    insert into public.arrangement_keys(id,arrangement_id,label,song_key,capo,vocal_label)
    values ((p_input->>'id')::uuid,a.id,p_input->>'label',p_input->>'song_key',(p_input->>'capo')::int,p_input->>'vocal_label') returning * into k;
  else
    update public.arrangement_keys set label=p_input->>'label',capo=(p_input->>'capo')::int,vocal_label=p_input->>'vocal_label' where id=k.id returning * into k;
  end if;
  -- Removing the last scope retains a reused file as general material. A new
  -- explicit key selection scopes a formerly general reused file too.
  insert into public.arrangement_file_links(arrangement_id,attachment_id,key_id)
    select a.id,l.attachment_id,null from public.arrangement_file_links l
    join public.attachments f on f.id=l.attachment_id
    where l.key_id=k.id and f.owner_kind='arrangement' and f.arrangement_id<>a.id
      and not ((p_input->'file_ids') @> jsonb_build_array(l.attachment_id::text))
      and not exists(select 1 from public.arrangement_file_links other where other.arrangement_id=a.id and other.attachment_id=l.attachment_id and other.key_id<>k.id)
    on conflict do nothing;
  delete from public.arrangement_file_links where key_id=k.id;
  delete from public.arrangement_file_links where arrangement_id=a.id and key_id is null
    and attachment_id in(select value::uuid from jsonb_array_elements_text(p_input->'file_ids'));
  insert into public.arrangement_file_links(arrangement_id,attachment_id,key_id)
    select a.id,value::uuid,k.id from jsonb_array_elements_text(p_input->'file_ids');
  result:=to_jsonb(k)||jsonb_build_object('file_ids',p_input->'file_ids');
  insert into public.library_operations(organization_id,actor_id,idempotency_key,kind,input,before_state,result)
    values(p_org,auth.uid(),case when p_input->>'expected_revision' is null then k.id else gen_random_uuid() end,'save_key',p_input,coalesce(snapshot,'null'),result);
  return result;
end $$;

create function public.preview_arrangement_duplicate(p_org uuid,p_arrangement uuid,p_input jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a public.arrangements; materials jsonb; selected_files jsonb; selected_keys jsonb; x jsonb;
begin
  a:=private.curation_arrangement(p_org,p_arrangement,true);
  if a.revision is distinct from (p_input->>'expected_revision')::bigint then raise exception 'Arrangement changed; reload' using errcode='PT409',hint='library_changed'; end if;
  if coalesce(length(btrim(p_input->>'name')),0) not between 1 and 120 or jsonb_array_length(p_input->'file_ids')>100 or jsonb_array_length(p_input->'key_ids')>100 then raise exception 'Invalid selection' using errcode='22023'; end if;
  if coalesce(jsonb_typeof(p_input->'key_ids'),'null')<>'array' or coalesce(jsonb_typeof(p_input->'file_ids'),'null')<>'array'
    or coalesce(jsonb_typeof(p_input->'metadata'),'null')<>'boolean' or coalesce(jsonb_typeof(p_input->'sections'),'null')<>'boolean' or coalesce(jsonb_typeof(p_input->'chart'),'null')<>'boolean'
    or exists(select 1 from jsonb_object_keys(p_input) fields(field) where fields.field not in ('name','expected_revision','metadata','sections','chart','key_ids','file_ids')) then raise exception 'Invalid duplicate options' using errcode='22023'; end if;
  materials:=public.arrangement_materials(p_org,p_arrangement);
  select coalesce(jsonb_agg(e order by e->>'id'),'[]') into selected_files from jsonb_array_elements(materials->'files') e where p_input->'file_ids' @> jsonb_build_array(e->>'id');
  select coalesce(jsonb_agg(e||jsonb_build_object('file_ids',coalesce((select jsonb_agg(fid) from jsonb_array_elements(e->'file_ids') fid where (p_input->'file_ids') @> jsonb_build_array(fid)),'[]')) order by e->>'id'),'[]') into selected_keys from jsonb_array_elements(materials->'keys') e where p_input->'key_ids' @> jsonb_build_array(e->>'id');
  if jsonb_array_length(selected_files)<>jsonb_array_length(p_input->'file_ids') or jsonb_array_length(selected_keys)<>jsonb_array_length(p_input->'key_ids') then raise exception 'Selection unavailable' using errcode='22023'; end if;
  for x in select * from jsonb_array_elements(selected_files) loop
    if not private.can_write_attachment(auth.uid(),(x->>'id')::uuid) then raise exception 'File reuse denied' using errcode='42501'; end if;
    if x->'key_ids'<>'[]'::jsonb and not ((p_input->'key_ids') @> (x->'key_ids')) then raise exception 'Select the labeled keys for scoped files' using errcode='22023'; end if;
  end loop;
  return jsonb_build_object('source_id',a.id,'selection',p_input,'files',selected_files,'keys',selected_keys,
    'fingerprint',private.import_version(jsonb_build_array(to_jsonb(a),p_input,selected_files,selected_keys)));
end $$;

create function public.duplicate_arrangement(p_org uuid,p_arrangement uuid,p_input jsonb,p_fingerprint text,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.arrangements; n public.arrangements; op public.library_operations; preview jsonb; k jsonb; kid uuid; new_id uuid:=gen_random_uuid(); op_id uuid:=gen_random_uuid(); result jsonb;
begin
  if not private.can_import(p_org,'songs') then raise exception 'songs.manage required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org::text||auth.uid()::text||p_key::text,0));
  select * into op from public.library_operations where organization_id=p_org and actor_id=auth.uid() and idempotency_key=p_key;
  if found then
    if op.kind<>'duplicate_arrangement' or op.input<>jsonb_build_object('source',p_arrangement,'selection',p_input,'fingerprint',p_fingerprint) then raise exception 'Idempotency key reused' using errcode='PT409'; end if;
    return op.result;
  end if;
  perform 1 from public.songs where id=(select song_id from public.arrangements where id=p_arrangement) for update;
  perform 1 from public.arrangements where id=p_arrangement for update;
  a:=private.curation_arrangement(p_org,p_arrangement,true);
  perform 1 from public.attachments where id in (select value::uuid from jsonb_array_elements_text(p_input->'file_ids')) order by id for share;
  preview:=public.preview_arrangement_duplicate(p_org,p_arrangement,p_input);
  if preview->>'fingerprint' is distinct from p_fingerprint then raise exception 'Materials changed; preview again' using errcode='PT409',hint='library_changed'; end if;
  n:=a; n.id:=new_id; n.name:=p_input->>'name'; n.is_default:=false; n.archived_at:=null; n.revision:=1; n.created_at:=now(); n.updated_at:=now();
  if not (p_input->>'metadata')::boolean then n.song_key:=case when (p_input->>'chart')::boolean then coalesce(a.song_key,(select default_key from public.songs where id=a.song_id)) else null end; n.capo:=null; n.bpm:=null; n.meter:=null; n.length_seconds:=null; end if;
  if not (p_input->>'sections')::boolean then n.sequence:='{}'; end if;
  if not (p_input->>'chart')::boolean then n.chord_chart:=null; n.chord_chart_format:='chordpro'; n.chart_columns:=1; n.chart_font:=null; n.chart_font_size:=null; n.chart_chord_color:=null; end if;
  insert into public.arrangements select n.*;
  for k in select * from jsonb_array_elements(preview->'keys') loop
    kid:=gen_random_uuid();
    insert into public.arrangement_keys(id,arrangement_id,label,song_key,capo,vocal_label) values(kid,new_id,k->>'label',k->>'song_key',(k->>'capo')::int,k->>'vocal_label');
    insert into public.arrangement_file_links(arrangement_id,attachment_id,key_id)
      select new_id,(f->>'id')::uuid,kid from jsonb_array_elements(preview->'files') f where f->'key_ids' @> jsonb_build_array(k->>'id');
  end loop;
  insert into public.arrangement_file_links(arrangement_id,attachment_id,key_id)
    select new_id,(f->>'id')::uuid,null from jsonb_array_elements(preview->'files') f where f->'key_ids'='[]'::jsonb;
  result:=jsonb_build_object('arrangement_id',new_id,'operation_id',op_id);
  insert into public.library_operations(id,organization_id,actor_id,idempotency_key,kind,input,before_state,result)
    values(op_id,p_org,auth.uid(),p_key,'duplicate_arrangement',jsonb_build_object('source',p_arrangement,'selection',p_input,'fingerprint',p_fingerprint),preview||jsonb_build_object('source',to_jsonb(a)),result);
  return result;
end $$;

-- The list is selection, never authorization: F13 is checked again on every read/download.
create function public.arrangement_effective_file_ids(p_org uuid,p_arrangement uuid,p_key text default null) returns uuid[]
language plpgsql stable security definer set search_path='' as $$
declare a public.arrangements; result uuid[];
begin
  a:=private.curation_arrangement(p_org,p_arrangement);
  select coalesce(array_agg(f.id order by f.id),'{}') into result from public.attachments f
  where f.song_id=a.song_id and f.archived_at is null and private.can_read_attachment(auth.uid(),f.id)
    and (f.arrangement_id=a.id or f.owner_kind='song' or exists(select 1 from public.arrangement_file_links l where l.arrangement_id=a.id and l.attachment_id=f.id))
    and (not exists(select 1 from public.arrangement_file_links l where l.arrangement_id=a.id and l.attachment_id=f.id and l.key_id is not null)
      or exists(select 1 from public.arrangement_file_links l left join public.arrangement_keys k on k.id=l.key_id
        where l.arrangement_id=a.id and l.attachment_id=f.id and (l.key_id is null or k.song_key=coalesce(p_key,a.song_key,(select default_key from public.songs where id=a.song_id)))));
  return result;
end $$;
revoke all on function private.curation_arrangement(uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.arrangement_materials(uuid,uuid),public.save_arrangement_key(uuid,uuid,jsonb),public.preview_arrangement_duplicate(uuid,uuid,jsonb),public.duplicate_arrangement(uuid,uuid,jsonb,text,uuid),public.arrangement_effective_file_ids(uuid,uuid,text) from public,anon;
grant execute on function public.arrangement_materials(uuid,uuid),public.save_arrangement_key(uuid,uuid,jsonb),public.preview_arrangement_duplicate(uuid,uuid,jsonb),public.duplicate_arrangement(uuid,uuid,jsonb,text,uuid),public.arrangement_effective_file_ids(uuid,uuid,text) to authenticated;

-- F13 permanent deletion must account for arrangement reuse as well as plan
-- links. FK protection also covers cascading deletion through an old owner.
do $$ declare d text; begin
  d:=pg_get_functiondef('public.delete_file(uuid,bigint)'::regprocedure);
  if strpos(d,'if exists (select 1 from public.attachment_links where attachment_id = p_attachment) then')=0 then
    raise exception 'F13 deletion integration point missing'; end if;
  execute replace(replace(d,
    'if exists (select 1 from public.attachment_links where attachment_id = p_attachment) then',
    'if exists (select 1 from public.attachment_links where attachment_id = p_attachment) or exists (select 1 from public.arrangement_file_links where attachment_id = p_attachment) then'),
    'Plans use this file. Archive it instead, or remove it from those plans first.',
    'Plans or arrangement keys use this file. Archive it instead, or remove those references first.');
end $$;
