-- F15 B: bounded reviewed imports. Source CSV is private job data, never a
-- public Storage object. Preview is a read-only API computation.
create function private.can_import(p_org uuid,p_kind text) returns boolean language sql stable security definer set search_path='' as $$
 select case p_kind when 'people' then private.capability_for(auth.uid(),p_org,'people.manage',null,null)
 when 'songs' then private.capability_for(auth.uid(),p_org,'songs.manage',null,null) else false end
$$;
create function private.import_fields(p_kind text) returns text[] language sql immutable set search_path='' as $$
 select case p_kind when 'people' then array['first_name','last_name','email','phone','campus','person_type']
 else array['title','author','ccli_number','copyright','administration','default_key','default_bpm','meter','themes','song_types','style','speed','notes'] end
$$;
create function private.import_data(p_kind text,p_row jsonb) returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(p_row) where key=any(private.import_fields(p_kind))
$$;
create function private.import_version(p_row jsonb) returns text language sql immutable set search_path='' as $$
 select encode(extensions.digest((p_row-'medical_note')::text,'sha256'),'hex')
$$;
create function private.validate_import_data(p_kind text,p_data jsonb,p_create boolean) returns void language plpgsql set search_path='' as $$
declare k text; v jsonb; max_length int;
begin
 if p_data is null or jsonb_typeof(p_data)<>'object' or p_data='{}' or exists(
   select 1 from jsonb_object_keys(p_data) keys(field) where not(keys.field=any(private.import_fields(p_kind)))) then
   raise exception 'Unsupported import fields' using errcode='22023'; end if;
 if p_kind='songs' then
   if p_data ? 'title' or p_create then
     if coalesce(jsonb_typeof(p_data->'title'),'null')<>'string' or length(btrim(p_data->>'title')) not between 1 and 200 then
       raise exception 'Invalid song title' using errcode='22023'; end if;
   end if;
   if p_data-'title'<>'{}' then perform private.validate_song_bulk_patch(p_data-'title'); end if;
 elsif p_kind='people' then
   if p_create and not (p_data ? 'first_name') then raise exception 'First name required' using errcode='22023'; end if;
   for k,v in select * from jsonb_each(p_data) loop
     if k in ('first_name','person_type') and v='null' then raise exception 'Required person field' using errcode='22023'; end if;
     if v<>'null' then
       max_length:=case k when 'first_name' then 80 when 'last_name' then 80 when 'phone' then 40 when 'campus' then 120 when 'email' then 254 else 10 end;
       if jsonb_typeof(v)<>'string' or length(v#>>'{}')>max_length then raise exception 'Invalid person field' using errcode='22023'; end if;
       if k='first_name' and length(btrim(v#>>'{}'))=0 then raise exception 'First name required' using errcode='22023'; end if;
       if k='person_type' and (v#>>'{}') not in ('adult','child') then raise exception 'Invalid person type' using errcode='22023'; end if;
       if k='email' and (v#>>'{}') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invalid email' using errcode='22023'; end if;
     end if;
   end loop;
 else raise exception 'Invalid import kind' using errcode='22023'; end if;
end $$;

create table public.structured_import_jobs (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations on delete cascade,
 created_by uuid not null references public.profiles, kind text not null check(kind in ('people','songs')),
 filename text not null, source jsonb not null, source_hash text not null, preview_hash text not null,
 idempotency_key text not null check(length(idempotency_key) between 8 and 200),
 revision bigint not null default 1, status text not null default 'reviewed' check(status in ('reviewed','committed')),
 created_at timestamptz not null default now(), committed_at timestamptz,
 unique(organization_id,created_by,idempotency_key)
);
create index structured_import_jobs_creator on public.structured_import_jobs(created_by);
create index structured_import_jobs_recent on public.structured_import_jobs(organization_id,created_at desc);
create table public.structured_import_rows (
 job_id uuid not null references public.structured_import_jobs on delete cascade,
 row_number int not null check(row_number between 2 and 101),
 action text not null check(action in ('create','update','skip')), target_id uuid, expected_version text,
 data jsonb not null, before_data jsonb, after_data jsonb, result_id uuid,
 primary key(job_id,row_number),
 check((action='update' and target_id is not null and expected_version is not null) or (action<>'update' and target_id is null and expected_version is null))
);
-- API callers use narrow RPCs; raw source/row writes are never client writable.
alter table public.structured_import_jobs enable row level security;
alter table public.structured_import_rows enable row level security;
create policy structured_import_jobs_read on public.structured_import_jobs for select to authenticated
 using(created_by=(select auth.uid()) and private.can_import(organization_id,kind));
create policy structured_import_rows_read on public.structured_import_rows for select to authenticated
 using(exists(select 1 from public.structured_import_jobs j where j.id=job_id));
revoke all on public.structured_import_jobs,public.structured_import_rows from anon,authenticated;
grant select on public.structured_import_rows to authenticated;
-- Source contains contacts: even authorized callers get it only through the
-- import workflow, not a general directory projection.
grant select on public.structured_import_jobs to authenticated;

-- Read-only candidates, bounded per row. Stable target IDs bypass fuzzy matching.
create function public.structured_import_context(p_org uuid,p_kind text,p_rows jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r jsonb; records jsonb; result jsonb:='[]';
begin
 if not private.can_import(p_org,p_kind) then raise insufficient_privilege; end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>100 then raise exception 'Invalid import rows' using errcode='22023'; end if;
 for r in select value from jsonb_array_elements(p_rows) loop
   if p_kind='people' then
     select coalesce(jsonb_agg(jsonb_build_object('id',id,'label',concat_ws(' ',first_name,last_name),
       'version',private.import_version(to_jsonb(p)), 'archived',archived_at is not null,'data',private.import_data(p_kind,to_jsonb(p))) order by id),'[]') into records
     from public.people p where organization_id=p_org and (
       case when r->>'target_id' is not null then id=(r->>'target_id')::uuid else
         (nullif(r->'data'->>'email','') is not null and lower(email)=lower(r->'data'->>'email')) or
         (nullif(r->'data'->>'first_name','') is not null and lower(btrim(first_name))=lower(r->'data'->>'first_name')
          and lower(coalesce(last_name,''))=lower(coalesce(r->'data'->>'last_name',''))) end);
   else
     select coalesce(jsonb_agg(jsonb_build_object('id',id,'label',title,
       'version',private.import_version(to_jsonb(s)), 'archived',archived_at is not null,'data',private.import_data(p_kind,to_jsonb(s))) order by id),'[]') into records
     from public.songs s where organization_id=p_org and (
       case when r->>'target_id' is not null then id=(r->>'target_id')::uuid else
         (nullif(r->'data'->>'ccli_number','') is not null and ccli_number=r->'data'->>'ccli_number') or
         (nullif(r->'data'->>'title','') is not null and lower(btrim(title))=lower(r->'data'->>'title')) end);
   end if;
   result:=result||jsonb_build_array(jsonb_build_object('row',(r->>'row')::int,'candidate_count',jsonb_array_length(records),
     'candidates',(select coalesce(jsonb_agg(value),'[]') from (select value from jsonb_array_elements(records) limit 10) limited)));
 end loop;
 return result;
end $$;

-- Save the approved immutable review. No domain records change here. The
-- source, mapping, row numbers and complete normalized delta survive restart.
create function public.save_structured_import(p_org uuid,p_source jsonb,p_source_hash text,p_preview_hash text,p_rows jsonb,p_key text)
returns public.structured_import_jobs language plpgsql security definer set search_path='' as $$
declare j public.structured_import_jobs; r jsonb; actual jsonb; before_row jsonb;
begin
 if not private.can_import(p_org,p_source->>'kind') then raise insufficient_privilege; end if;
 perform pg_advisory_xact_lock(hashtextextended('import:'||p_org::text||':'||auth.uid()::text||':'||p_key,0));
 select * into j from public.structured_import_jobs where organization_id=p_org and created_by=auth.uid() and idempotency_key=p_key;
 if found then
   if j.source<>p_source or j.preview_hash<>p_preview_hash then raise exception 'Import key reused for another review' using errcode='PT409',hint='import_changed'; end if;
   return j;
 end if;
 if p_key is null or length(p_key) not between 8 and 200
   or coalesce(p_source_hash=encode(extensions.digest(p_source->>'content','sha256'),'hex'),false) is not true
   or coalesce(p_preview_hash ~ '^[a-f0-9]{64}$',false) is not true
   or coalesce(p_source->>'filename' ~* '\.csv$',false) is not true
   or coalesce(length(p_source->>'filename') between 1 and 200,false) is not true
   or coalesce(p_source->>'content_type' in ('text/csv','application/csv','application/vnd.ms-excel','text/plain'),false) is not true
   or coalesce(octet_length(p_source->>'content') between 1 and 262144,false) is not true then
   raise exception 'Invalid import source' using errcode='22023'; end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 100
   or (select count(distinct value->>'row') from jsonb_array_elements(p_rows))<>jsonb_array_length(p_rows)
   or exists(select 1 from jsonb_array_elements(p_rows) e where e->>'action' is null or e->>'action' not in ('create','update','skip')) then
   raise exception 'Resolve every import row' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(p_rows) e where e->>'action'='update' group by e->>'target_id' having count(*)>1) then
   raise exception 'Only one update per target per import' using errcode='22023'; end if;
 insert into public.structured_import_jobs(organization_id,created_by,kind,filename,source,source_hash,preview_hash,idempotency_key)
 values(p_org,auth.uid(),p_source->>'kind',p_source->>'filename',p_source,p_source_hash,p_preview_hash,p_key) returning * into j;
 for r in select value from jsonb_array_elements(p_rows) order by value->>'target_id',value->>'row' loop
   before_row:=null;
   if r->>'action'<>'skip' then perform private.validate_import_data(j.kind,r->'data',r->>'action'='create'); end if;
   if r->>'action'='update' then
     if j.kind='people' then select to_jsonb(p) into actual from public.people p where id=(r->>'target_id')::uuid and organization_id=p_org for share;
     else select to_jsonb(s) into actual from public.songs s where id=(r->>'target_id')::uuid and organization_id=p_org for share; end if;
     if actual is null then raise exception 'Import record % target is unavailable', (r->>'row')::int-1 using errcode='P0002'; end if;
     if r->>'expected_version' is null or private.import_version(actual)<>r->>'expected_version' then raise exception 'Import record % changed; preview again', (r->>'row')::int-1 using errcode='PT409',hint='import_changed'; end if;
     before_row:=private.import_data(j.kind,actual);
   end if;
   insert into public.structured_import_rows(job_id,row_number,action,target_id,expected_version,data,before_data)
   values(j.id,(r->>'row')::int,r->>'action',(r->>'target_id')::uuid,r->>'expected_version',r->'data',before_row);
 end loop;
 return j;
end $$;

create function public.commit_structured_import(p_org uuid,p_job uuid,p_revision bigint) returns public.structured_import_jobs
language plpgsql security definer set search_path='' as $$
declare j public.structured_import_jobs; r public.structured_import_rows; actual jsonb; after_row jsonb; v_result_id uuid;
 p public.people; s public.songs;
begin
 select * into j from public.structured_import_jobs where id=p_job and organization_id=p_org and created_by=auth.uid() for update;
 if not found then raise no_data_found; end if;
 if not private.can_import(p_org,j.kind) then raise insufficient_privilege; end if;
 if j.status='committed' then return j; end if;
 if p_revision is null or j.revision<>p_revision then raise exception 'Import review changed' using errcode='PT409',hint='import_changed'; end if;
 -- Lock/check all existing targets before any domain writes, in stable ID order.
 for r in select * from public.structured_import_rows where job_id=j.id and action='update' order by target_id loop
   actual:=null;
   if j.kind='people' then select to_jsonb(x) into actual from public.people x where id=r.target_id and organization_id=p_org for update;
   else select to_jsonb(x) into actual from public.songs x where id=r.target_id and organization_id=p_org for update; end if;
   if actual is null then raise exception 'Import record % target is unavailable', r.row_number-1 using errcode='P0002'; end if;
   if private.import_version(actual)<>r.expected_version then raise exception 'Import record % changed; preview again', r.row_number-1 using errcode='PT409',hint='import_changed'; end if;
 end loop;
 for r in select * from public.structured_import_rows where job_id=j.id order by row_number loop
  begin
   v_result_id:=null; after_row:=null;
   if r.action<>'skip' then
     perform private.validate_import_data(j.kind,r.data,r.action='create');
     if j.kind='people' then
       if r.action='create' then
         p:=jsonb_populate_record(null::public.people,r.data);
         insert into public.people(organization_id,first_name,last_name,email,phone,campus,person_type,created_by)
         values(p_org,p.first_name,p.last_name,p.email,p.phone,p.campus,coalesce(p.person_type,'adult'),auth.uid()) returning * into p;
       else
         select * into p from public.people where id=r.target_id;
         p:=jsonb_populate_record(p,r.data);
         update public.people set first_name=p.first_name,last_name=p.last_name,email=p.email,phone=p.phone,campus=p.campus,person_type=p.person_type
         where id=r.target_id returning * into p;
       end if;
       v_result_id:=p.id; after_row:=private.import_data(j.kind,to_jsonb(p));
     else
       if r.action='create' then
         s:=jsonb_populate_record(null::public.songs,r.data);
         insert into public.songs(organization_id,title,author,ccli_number,copyright,administration,default_key,default_bpm,meter,themes,song_types,style,speed,notes,created_by)
         values(p_org,s.title,s.author,s.ccli_number,s.copyright,s.administration,s.default_key,s.default_bpm,s.meter,coalesce(s.themes,'{}'),coalesce(s.song_types,'{}'),s.style,s.speed,s.notes,auth.uid()) returning * into s;
         insert into public.arrangements(song_id,name,song_key,bpm,meter,is_default)
         values(s.id,'Default Arrangement',s.default_key,s.default_bpm,s.meter,true);
       else
         select * into s from public.songs where id=r.target_id;
         s:=jsonb_populate_record(s,r.data);
         update public.songs set title=s.title,author=s.author,ccli_number=s.ccli_number,copyright=s.copyright,administration=s.administration,
           default_key=s.default_key,default_bpm=s.default_bpm,meter=s.meter,themes=s.themes,song_types=s.song_types,style=s.style,speed=s.speed,notes=s.notes
           where id=r.target_id returning * into s;
       end if;
       v_result_id:=s.id; after_row:=private.import_data(j.kind,to_jsonb(s));
     end if;
   end if;
   update public.structured_import_rows set after_data=after_row,result_id=v_result_id where job_id=j.id and row_number=r.row_number;
  exception when others then
    raise exception 'Import record % failed; no rows were committed', r.row_number-1 using errcode='22023';
  end;
 end loop;
 update public.structured_import_jobs set status='committed',revision=revision+1,committed_at=now() where id=j.id returning * into j;
 return j;
end $$;
revoke all on function public.structured_import_context(uuid,text,jsonb),public.save_structured_import(uuid,jsonb,text,text,jsonb,text),public.commit_structured_import(uuid,uuid,bigint) from public,anon;
grant execute on function public.structured_import_context(uuid,text,jsonb),public.save_structured_import(uuid,jsonb,text,text,jsonb,text),public.commit_structured_import(uuid,uuid,bigint) to authenticated;
revoke all on function private.can_import(uuid,text),private.import_fields(text),private.import_data(text,jsonb),private.import_version(jsonb),private.validate_import_data(text,jsonb,boolean) from public,anon,authenticated;
grant execute on function private.can_import(uuid,text) to authenticated;
