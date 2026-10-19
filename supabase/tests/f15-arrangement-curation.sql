-- F15 C: real role-bound keys, F13 reuse, duplicate history and optional merge.
begin;
create temporary table f15c_ids(k text primary key,id uuid) on commit drop;
grant all on f15c_ids to authenticated;
insert into f15c_ids values ('org','aaaaaaaa-0000-4000-8000-000000000001'),('user','22222222-2222-4222-8222-222222222222'),('member','33333333-3333-4333-8333-333333333333'),
 ('winner',gen_random_uuid()),('loser',gen_random_uuid()),('arr',gen_random_uuid()),('winnerarr',gen_random_uuid()),('oldarr',gen_random_uuid()),('plan',gen_random_uuid()),('item',gen_random_uuid()),('olditem',gen_random_uuid()),('book',gen_random_uuid()),('key',gen_random_uuid()),('foreignorg',gen_random_uuid()),('foreignsong',gen_random_uuid()),('foreignarr',gen_random_uuid());
create function pg_temp.id(t text) returns uuid language sql as $$ select id from f15c_ids where k=t $$;
create function pg_temp.assert(ok boolean,msg text) returns void language plpgsql as $$begin if ok is not true then raise exception 'FAIL: %',msg; end if; end$$;
insert into public.organizations(id,name,slug) values(pg_temp.id('foreignorg'),'F15 C foreign','f15-c-foreign');
insert into public.songs(id,organization_id,title,default_key,default_bpm,meter) values
 (pg_temp.id('winner'),pg_temp.id('org'),'F15 C duplicate','C',90,'4/4'),(pg_temp.id('loser'),pg_temp.id('org'),'F15 C duplicate','D',110,'6/8'),(pg_temp.id('foreignsong'),pg_temp.id('foreignorg'),'Foreign','F',90,'4/4');
insert into public.arrangements(id,song_id,name,is_default,sequence,chord_chart) values
 (pg_temp.id('arr'),pg_temp.id('loser'),'Original',true,array['V1','C'],'[D]Sing'),(pg_temp.id('winnerarr'),pg_temp.id('winner'),'Kept default',true,'{}','[C]Sing'),(pg_temp.id('oldarr'),pg_temp.id('loser'),'Historic',false,'{}','[E]Old'),(pg_temp.id('foreignarr'),pg_temp.id('foreignsong'),'Foreign',true,'{}',null);
insert into public.plans(id,organization_id,title,service_date,status,created_by) values(pg_temp.id('plan'),pg_temp.id('org'),'F15 C history','2027-08-01 10:00Z','draft',pg_temp.id('user'));
insert into public.plan_items(id,plan_id,item_type,title,song_id,arrangement_id,sort_order,key_override,sequence_override) values
 (pg_temp.id('item'),pg_temp.id('plan'),'song','Keep item title',pg_temp.id('loser'),null,0,'E',array['C']),
 (pg_temp.id('olditem'),pg_temp.id('plan'),'song','Archived history',pg_temp.id('loser'),pg_temp.id('oldarr'),1,null,null);
update public.arrangements set archived_at=now() where id=pg_temp.id('oldarr');
insert into public.songbooks(id,organization_id,title,created_by) values(pg_temp.id('book'),pg_temp.id('org'),'F15 C versions',pg_temp.id('user'));
insert into public.songbook_items(songbook_id,song_id,sort_order) values(pg_temp.id('book'),pg_temp.id('winner'),0),(pg_temp.id('book'),pg_temp.id('loser'),1);
create function pg_temp.fail_merge() returns trigger language plpgsql as $$begin
 if current_setting('f15c.fail_merge',true)='yes' or current_setting('f15c.fail_duplicate',true)='yes' then raise exception 'forced merge failure' using errcode='23514'; end if;
 return new; end $$;
create trigger f15c_fail_merge before update of song_id on public.plan_items for each row execute function pg_temp.fail_merge();
create trigger f15c_fail_duplicate before insert on public.arrangement_keys for each row execute function pg_temp.fail_merge();
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.id('user')::text,true);
do $$declare r jsonb; f uuid; general uuid; k jsonb; options jsonb; preview jsonb; copy jsonb; merge_preview jsonb; merge_result jsonb; rev_id uuid; saved_content jsonb; tpl jsonb; op_key uuid:=gen_random_uuid(); dup_key uuid:=gen_random_uuid(); before_arr jsonb; copied_key jsonb; third uuid:=gen_random_uuid(); a public.arrangements;
begin
 r:=public.save_file_content('arrangement',pg_temp.id('arr'),null,null,'link','D chart','https://example.com/d',null,'chart','organization','{}','{}',gen_random_uuid()::text);
 f:=(r#>>'{attachment,id}')::uuid;
 insert into f15c_ids values('file',f);
 r:=public.save_file_content('arrangement',pg_temp.id('arr'),null,null,'link','General track','https://example.com/track',null,'other','organization','{}','{}',gen_random_uuid()::text);
 general:=(r#>>'{attachment,id}')::uuid;
 insert into f15c_ids values('general',general);
 k:=jsonb_build_object('id',pg_temp.id('key'),'expected_revision',null,'label','High vocal','song_key','E','capo',2,'vocal_label','Soprano','file_ids',jsonb_build_array(f));
 r:=public.save_arrangement_key(pg_temp.id('org'),pg_temp.id('arr'),k);
 perform pg_temp.assert(r->>'label'='High vocal' and (r->>'revision')::int=1,'key create');
 perform pg_temp.assert(public.save_arrangement_key(pg_temp.id('org'),pg_temp.id('arr'),k)=r,'key create retry');
 perform pg_temp.assert(f=any(public.arrangement_effective_file_ids(pg_temp.id('org'),pg_temp.id('arr'),'E')),'matching key file');
 perform pg_temp.assert(not f=any(public.arrangement_effective_file_ids(pg_temp.id('org'),pg_temp.id('arr'),'D')) and general=any(public.arrangement_effective_file_ids(pg_temp.id('org'),pg_temp.id('arr'),'D')),'other key excludes scoped file, keeps general');
 begin
   perform public.save_arrangement_key(pg_temp.id('org'),pg_temp.id('arr'),k||'{"expected_revision":1,"song_key":"F"}'); raise exception 'FAIL pitch mutation';
 exception when invalid_parameter_value then null; end;
 begin
   perform public.save_arrangement_key(pg_temp.id('org'),pg_temp.id('arr'),k||'{"expected_revision":2,"label":"stale"}'); raise exception 'FAIL stale key';
 exception when sqlstate 'PT409' then null; end;
 begin
   perform public.save_arrangement_key(pg_temp.id('org'),pg_temp.id('foreignarr'),k); raise exception 'FAIL foreign key parent';
 exception when sqlstate 'PT404' then null; end;
 select to_jsonb(x) into before_arr from public.arrangements x where id=pg_temp.id('arr');
 options:=jsonb_build_object('name','Selected copy','expected_revision',1,'metadata',false,'sections',true,'chart',false,'key_ids',jsonb_build_array(pg_temp.id('key')),'file_ids',jsonb_build_array(f,general));
 preview:=public.preview_arrangement_duplicate(pg_temp.id('org'),pg_temp.id('arr'),options);
 perform pg_temp.assert((select count(*)=2 from public.arrangements where song_id=pg_temp.id('loser')),'preview writes nothing');
 perform set_config('f15c.fail_duplicate','yes',true);
 begin perform public.duplicate_arrangement(pg_temp.id('org'),pg_temp.id('arr'),options,preview->>'fingerprint',dup_key); raise exception 'FAIL forced duplicate failure missing'; exception when check_violation then null; end;
 perform pg_temp.assert((select count(*)=2 from public.arrangements where song_id=pg_temp.id('loser')),'duplicate key failure rolls back new arrangement');
 perform set_config('f15c.fail_duplicate','no',true);
 copy:=public.duplicate_arrangement(pg_temp.id('org'),pg_temp.id('arr'),options,preview->>'fingerprint',dup_key);
 perform pg_temp.assert(copy=public.duplicate_arrangement(pg_temp.id('org'),pg_temp.id('arr'),options,preview->>'fingerprint',dup_key),'duplicate retry');
 insert into f15c_ids values('copy',(copy->>'arrangement_id')::uuid);
 select * into a from public.arrangements where id=(copy->>'arrangement_id')::uuid;
 perform pg_temp.assert(a.sequence=array['V1','C'] and a.chord_chart is null and a.song_key is null and not a.is_default,'selected sections only, independent identity');
 perform pg_temp.assert((select to_jsonb(x)=before_arr from public.arrangements x where id=pg_temp.id('arr')),'source unchanged');
 perform pg_temp.assert((select count(*)=1 from public.arrangement_keys where arrangement_id=a.id and id<>pg_temp.id('key')),'new key IDs');
 perform pg_temp.assert(f=any(public.arrangement_effective_file_ids(pg_temp.id('org'),a.id,'E')) and not f=any(public.arrangement_effective_file_ids(pg_temp.id('org'),a.id,'C')),'copied file key scope');
 perform pg_temp.assert((select arrangement_id=pg_temp.id('arr') and audience='organization' from public.attachments where id=f),'F13 owner/audience retained');
 -- Re-scoping reused files is reversible without losing their original identity.
 r:=public.arrangement_materials(pg_temp.id('org'),a.id); copied_key:=r#>'{keys,0}';
 r:=public.save_arrangement_key(pg_temp.id('org'),a.id,(copied_key-'revision'-'arrangement_id'-'created_at')||'{"expected_revision":1,"file_ids":[]}');
 perform pg_temp.assert(f=any(public.arrangement_effective_file_ids(pg_temp.id('org'),a.id,'C')),'clear scope retains general reuse');
 r:=public.save_arrangement_key(pg_temp.id('org'),a.id,(copied_key-'revision'-'arrangement_id'-'created_at')||jsonb_build_object('expected_revision',2,'file_ids',jsonb_build_array(f)));
 perform pg_temp.assert(not f=any(public.arrangement_effective_file_ids(pg_temp.id('org'),a.id,'C')),'general reuse can become key scoped');
 begin perform public.delete_file(f,(select revision from public.attachments where id=f)); raise exception 'FAIL reused file deleted'; exception when sqlstate 'PT409' then null; end;
 -- Chart-only duplication must carry the source pitch for correct transposition.
 preview:=public.preview_arrangement_duplicate(pg_temp.id('org'),pg_temp.id('arr'),options||'{"name":"Chart only","chart":true,"key_ids":[],"file_ids":[]}');
 r:=public.duplicate_arrangement(pg_temp.id('org'),pg_temp.id('arr'),preview->'selection',preview->>'fingerprint',gen_random_uuid());
 perform pg_temp.assert((select song_key='D' and chord_chart='[D]Sing' from public.arrangements where id=(r->>'arrangement_id')::uuid),'chart-only copy preserves sounding pitch');
 -- A source revision change invalidates the exact reviewed selection.
 update public.arrangements set name='changed source' where id=pg_temp.id('arr');
 begin
   perform public.duplicate_arrangement(pg_temp.id('org'),pg_temp.id('arr'),options,preview->>'fingerprint',gen_random_uuid()); raise exception 'FAIL stale duplicate';
 exception when sqlstate 'PT409' then null; end;
 -- Save an immutable F10 revision before merge, including inherited arrangement.
 tpl:=public.save_plan_template(pg_temp.id('org'),null,null,'plan',null,'F15 C template',null,null,pg_temp.id('plan'),array['items']);
 select r.id,r.content into rev_id,saved_content from public.plan_template_revisions r where template_id=(tpl->>'template_id')::uuid and revision=1;
 insert into f15c_ids values('revision',rev_id);
 perform pg_temp.assert(jsonb_array_length(public.song_duplicate_candidates(pg_temp.id('org'),pg_temp.id('loser')))=1,'deliberate duplicate candidates');
 update public.songs set default_key=null where id=pg_temp.id('loser');
 r:=public.preview_song_merge(pg_temp.id('org'),pg_temp.id('winner'),pg_temp.id('loser'));
 perform pg_temp.assert(jsonb_array_length(r->'blockers')>0,'unknown losing key cannot silently inherit winner pitch');
 update public.songs set default_key='D' where id=pg_temp.id('loser');
 merge_preview:=public.preview_song_merge(pg_temp.id('org'),pg_temp.id('winner'),pg_temp.id('loser'));
 perform pg_temp.assert(merge_preview->'blockers'='[]'::jsonb and (merge_preview->>'plan_items')::int=2 and (merge_preview->>'songbook_items')::int=2 and (merge_preview->>'template_revisions')::int=1,'merge inventory');
 -- Late change forces complete rollback with unchanged identity.
 update public.songs set notes='late edit' where id=pg_temp.id('loser');
 begin
   perform public.commit_song_merge(pg_temp.id('org'),pg_temp.id('winner'),pg_temp.id('loser'),merge_preview->>'fingerprint',op_key); raise exception 'FAIL stale merge';
 exception when sqlstate 'PT409' then null; end;
 perform pg_temp.assert((select song_id=pg_temp.id('loser') from public.plan_items where id=pg_temp.id('item')),'stale merge no remap');
 merge_preview:=public.preview_song_merge(pg_temp.id('org'),pg_temp.id('winner'),pg_temp.id('loser'));
 -- A forced failure AFTER arrangement/file writes must roll everything back.
 perform set_config('f15c.fail_merge','yes',true);
 begin
   perform public.commit_song_merge(pg_temp.id('org'),pg_temp.id('winner'),pg_temp.id('loser'),merge_preview->>'fingerprint',op_key); raise exception 'FAIL forced failure missing';
 exception when check_violation then null; end;
 perform pg_temp.assert((select song_id=pg_temp.id('loser') from public.arrangements where id=pg_temp.id('arr')) and (select song_id=pg_temp.id('loser') from public.attachments where id=f),'forced merge failure rolls back arrangements/files');
 perform set_config('f15c.fail_merge','no',true);
 merge_result:=public.commit_song_merge(pg_temp.id('org'),pg_temp.id('winner'),pg_temp.id('loser'),merge_preview->>'fingerprint',op_key);
 perform pg_temp.assert(merge_result=public.commit_song_merge(pg_temp.id('org'),pg_temp.id('winner'),pg_temp.id('loser'),merge_preview->>'fingerprint',op_key),'merge replay');
 perform pg_temp.assert((select merged_into_song_id=pg_temp.id('winner') and archived_at is not null from public.songs where id=pg_temp.id('loser')),'loser retained');
 perform pg_temp.assert((select song_id=pg_temp.id('winner') and arrangement_id=pg_temp.id('arr') and key_override='E' and sequence_override=array['C'] and title='Keep item title' from public.plan_items where id=pg_temp.id('item')),'plan IDs and overrides retained, inherited arrangement frozen');
 perform pg_temp.assert((select song_id=pg_temp.id('winner') and arrangement_id=pg_temp.id('oldarr') from public.plan_items where id=pg_temp.id('olditem')),'archived arrangement history remapped');
 perform pg_temp.assert((select song_id=pg_temp.id('winner') and song_key='D' and bpm=110 and meter='6/8' and not is_default from public.arrangements where id=pg_temp.id('arr')),'losing fallback/default frozen');
 perform pg_temp.assert((select is_default from public.arrangements where id=pg_temp.id('winnerarr')),'winner default unchanged');
 perform pg_temp.assert((select count(*)=2 from public.songbook_items where songbook_id=pg_temp.id('book') and song_id=pg_temp.id('winner')),'book preserves both versions');
 perform pg_temp.assert((select r.content=saved_content from public.plan_template_revisions r where r.id=rev_id),'immutable revision unchanged');
 r:=public.preview_plan_template_apply(pg_temp.id('plan'),rev_id,'append',array['items']);
 perform pg_temp.assert(r::text like '%'||pg_temp.id('winner')::text||'%' and r::text not like '%'||pg_temp.id('loser')::text||'%','old template canonical resolution');
 begin perform public.archive_library_record(pg_temp.id('org'),'song',pg_temp.id('loser'),(select revision from public.songs where id=pg_temp.id('loser')),false); raise exception 'FAIL tombstone restore'; exception when invalid_parameter_value then null; end;
 begin delete from public.songs where id=pg_temp.id('loser'); raise exception 'FAIL tombstone delete'; exception when invalid_parameter_value then null; end;
 begin update public.songs set merged_into_song_id=pg_temp.id('loser') where id=pg_temp.id('winner'); raise exception 'FAIL direct merge injection'; exception when insufficient_privilege then null; end;
 -- A second merge inventories old aliases and flattens them without rewriting history.
 insert into public.songs(id,organization_id,title,default_key) values(third,pg_temp.id('org'),'Second canonical winner','G');
 insert into public.arrangements(song_id,name,is_default) values(third,'Third default',true);
 merge_preview:=public.preview_song_merge(pg_temp.id('org'),third,pg_temp.id('winner'));
 perform pg_temp.assert((merge_preview->>'template_revisions')::int=1,'history through older alias included in second preview');
 perform public.commit_song_merge(pg_temp.id('org'),third,pg_temp.id('winner'),merge_preview->>'fingerprint',gen_random_uuid());
 perform pg_temp.assert((select merged_into_song_id=third from public.songs where id=pg_temp.id('loser')),'aliases flattened');
 r:=public.preview_plan_template_apply(pg_temp.id('plan'),rev_id,'append',array['items']);
 perform pg_temp.assert(r::text like '%'||third::text||'%' and r::text not like '%'||pg_temp.id('loser')::text||'%','old template survives repeated merge');

end $$;

-- Member cannot author keys/duplicates/merge or read creator provenance. Reuse
-- does not grant access to a restricted source file.
select set_config('request.jwt.claim.sub',pg_temp.id('member')::text,true);
do $$declare r jsonb; begin
  r:=public.arrangement_materials(pg_temp.id('org'),pg_temp.id('copy'));
  perform pg_temp.assert(jsonb_array_length(r->'keys')=1,'member reads keys');
  perform pg_temp.assert((select count(*)=0 from public.library_operations),'provenance creator isolation');
  begin perform public.save_arrangement_key(pg_temp.id('org'),pg_temp.id('copy'),'{}'); raise exception 'FAIL member key edit'; exception when insufficient_privilege then null; end;
  begin perform public.preview_song_merge(pg_temp.id('org'),pg_temp.id('winner'),pg_temp.id('loser')); raise exception 'FAIL member merge'; exception when insufficient_privilege then null; end;
  begin perform public.preview_arrangement_duplicate(pg_temp.id('org'),pg_temp.id('copy'),'{}'); raise exception 'FAIL member duplicate'; exception when insufficient_privilege then null; end;
  begin insert into public.arrangement_keys(arrangement_id,label,song_key) values(pg_temp.id('copy'),'Injected','F'); raise exception 'FAIL direct key insert'; exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.attachments set audience='leaders' where id=pg_temp.id('file');
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.id('member')::text,true);
do $$declare r jsonb; begin
 r:=public.arrangement_materials(pg_temp.id('org'),pg_temp.id('copy'));
 perform pg_temp.assert(not(r->'files' @> jsonb_build_array(jsonb_build_object('id',pg_temp.id('file')))),'restricted reused file metadata hidden');
 perform pg_temp.assert(not pg_temp.id('file')=any(public.arrangement_effective_file_ids(pg_temp.id('org'),pg_temp.id('copy'),'E')),'restricted reused file absent from effective manifest');
 perform pg_temp.assert((select count(*)=0 from public.arrangement_file_links where attachment_id=pg_temp.id('file')),'raw association RLS');
end $$;
rollback;
