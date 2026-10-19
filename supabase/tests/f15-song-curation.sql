-- Real caller-role projections, archive/history, reviewed bulk, stale rollback.
begin;
create temporary table f15_ids (k text primary key,id uuid) on commit drop;
insert into f15_ids values ('org','aaaaaaaa-0000-4000-8000-000000000001'),
 ('user','22222222-2222-4222-8222-222222222222'),('member','33333333-3333-4333-8333-333333333333'),
 ('song',gen_random_uuid()),('arr',gen_random_uuid()),('otherarr',gen_random_uuid()),('plan',gen_random_uuid()),
 ('song2',gen_random_uuid()),('foreign',gen_random_uuid()),('foreignsong',gen_random_uuid());
grant select on f15_ids to authenticated;
create function pg_temp.id(k0 text) returns uuid language sql as $$select id from f15_ids where k=k0$$;
create function pg_temp.assert(ok boolean,msg text) returns void language plpgsql as $$begin if ok is not true then raise exception 'FAIL: %',msg; end if; end$$;
insert into public.organizations(id,name,slug) values(pg_temp.id('foreign'),'F15 foreign','f15-foreign');
insert into public.songs(id,organization_id,title,default_key,default_bpm,themes,song_types,style,author) values
 (pg_temp.id('song'),pg_temp.id('org'),'F15 target','C',100,array['Hope'],array['Worship'],'Hymn','Test author'),
 (pg_temp.id('song2'),pg_temp.id('org'),'F15 target2','C',100,array['Hope'],array['Worship'],'Hymn','Test author'),
 (pg_temp.id('foreignsong'),pg_temp.id('foreign'),'F15 foreign','C',100,array['Hope'],array['Worship'],'Hymn','Test author');
insert into public.songs(organization_id,title,default_key,default_bpm,themes,song_types,style,author)
 select pg_temp.id('org'),'F15 page '||lpad(n::text,3,'0'),'C',100,array['Hope'],array['Worship'],'Hymn','Test author' from generate_series(1,105) n;
insert into public.arrangements(id,song_id,name,song_key,bpm,is_default,chord_chart) values
 (pg_temp.id('arr'),pg_temp.id('song'),'First','D',80,true,'[D]Hope'),
 (pg_temp.id('otherarr'),pg_temp.id('song'),'Second','E',120,false,'[E]Hope');
insert into public.plans(id,organization_id,title,service_date,status,created_by)
 values(pg_temp.id('plan'),pg_temp.id('org'),'F15 history','2027-08-01 10:00+00','draft',pg_temp.id('user'));
insert into public.plan_items(plan_id,item_type,title,song_id,arrangement_id,sort_order)
 values(pg_temp.id('plan'),'song','F15 history',pg_temp.id('song'),pg_temp.id('arr'),0);
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.id('user')::text,true);
select set_config('request.jwt.claims',json_build_object('sub',pg_temp.id('user'),'role','authenticated')::text,true);
do $$declare r jsonb; p public.song_bulk_previews; p2 public.song_bulk_previews; s public.songs; a public.arrangements; n bigint; begin
 r:=public.list_curated_songs(pg_temp.id('org'),'{"q":"F15","theme":"Hope","song_type":"Worship","style":"Hymn","author":"Test","key":"C","bpm_min":90,"bpm_max":110,"per_page":50,"page":3}');
 perform pg_temp.assert((r->>'total')::int=107 and jsonb_array_length(r->'data')=7,'combined filters + page beyond 100');
 perform pg_temp.assert(r=public.list_curated_songs(pg_temp.id('org'),'{"q":"F15","theme":"Hope","song_type":"Worship","style":"Hymn","author":"Test","key":"C","bpm_min":90,"bpm_max":110,"per_page":50,"page":3}'),'stable pagination');
 r:=public.list_curated_songs(pg_temp.id('org'),'{"q":"F15","key":"D","bpm_min":110}');
 perform pg_temp.assert((r->>'total')::int=0,'key/BPM must match same source');
 r:=public.list_curated_songs(pg_temp.id('org'),'{"q":"F15","key":"D","bpm_max":90,"scheduled_from":"2027-08-01T00:00:00Z","scheduled_to":"2027-08-02T00:00:00Z"}');
 perform pg_temp.assert((r->>'total')::int=1,'arrangement + usage projection');
 r:=public.list_curated_songs(pg_temp.id('org'),'{"q":"F15","scheduled_to":"2027-08-01T10:00:00Z"}');
 perform pg_temp.assert((r->>'total')::int=0,'usage upper bound exclusive');
 -- Historical arrangement is retained after archiving; default moves deterministically.
 r:=public.archive_library_record(pg_temp.id('org'),'arrangement',pg_temp.id('arr'),1,true);
 perform pg_temp.assert(r->>'archived_at' is not null and (r->>'is_default')::boolean=false,'archived arrangement');
 perform pg_temp.assert((select is_default from public.arrangements where id=pg_temp.id('otherarr')),'replacement default');
 begin
   update public.arrangements set is_default=true where id=pg_temp.id('arr');
   raise exception 'FAIL: archived arrangement made default';
 exception when invalid_parameter_value then null; end;
 begin
   insert into public.arrangements(song_id,name,is_default,chart_columns) values(pg_temp.id('song'),'Invalid replacement',true,3);
   raise exception 'FAIL: invalid replacement accepted';
 exception when check_violation then null; end;
 perform pg_temp.assert((select is_default from public.arrangements where id=pg_temp.id('otherarr')),'failed switch keeps default');
 perform pg_temp.assert((select chord_chart='[D]Hope' from public.arrangements where id=pg_temp.id('arr')),'historical chart readable');
 begin
   insert into public.plan_items(plan_id,item_type,title,song_id,arrangement_id,sort_order) values(pg_temp.id('plan'),'song','Archived',pg_temp.id('song'),pg_temp.id('arr'),1);
   raise exception 'FAIL: scheduled archived arrangement';
 exception when invalid_parameter_value then null; end;
 begin
   perform public.archive_library_record(pg_temp.id('org'),'arrangement',pg_temp.id('otherarr'),2,true);
   raise exception 'FAIL: archived last active arrangement';
 exception when invalid_parameter_value then null; end;
 r:=public.archive_library_record(pg_temp.id('org'),'song',pg_temp.id('song'),1,true);
 perform pg_temp.assert((select count(*)=1 from public.plan_items where arrangement_id=pg_temp.id('arr')),'history kept');
 r:=public.list_curated_songs(pg_temp.id('org'),'{"q":"F15 target","archive":"active"}');
 perform pg_temp.assert((r->>'total')::int=1,'archived song absent picker');
 r:=public.list_curated_songs(pg_temp.id('org'),'{"q":"F15 target","archive":"archived"}');
 perform pg_temp.assert((r->>'total')::int=1,'archive browser');
 begin delete from public.songs where id=pg_temp.id('song'); raise exception 'FAIL: deleted historical song'; exception when foreign_key_violation then null; end;
 begin delete from public.arrangements where id=pg_temp.id('arr'); raise exception 'FAIL: deleted historical arrangement'; exception when foreign_key_violation then null; end;
 begin update public.songs set archived_at=null where id=pg_temp.id('song'); raise exception 'FAIL: bypassed archive RPC'; exception when insufficient_privilege then null; end;
 r:=public.archive_library_record(pg_temp.id('org'),'song',pg_temp.id('song'),2,false);
 r:=public.archive_library_record(pg_temp.id('org'),'arrangement',pg_temp.id('arr'),2,false);
 perform pg_temp.assert((select not is_default from public.arrangements where id=pg_temp.id('arr')),'restore keeps existing default');
 -- Preview writes only its tracking record. Stale second row rolls back first.
 select * into p from public.preview_song_bulk(pg_temp.id('org'),jsonb_build_array(
  jsonb_build_object('id',pg_temp.id('song'),'expected_revision',3),jsonb_build_object('id',pg_temp.id('song2'),'expected_revision',1)), '{"themes":["Reviewed"],"default_bpm":88}');
 perform pg_temp.assert((select themes=array['Hope'] from public.songs where id=pg_temp.id('song')),'preview does not change songs');
 update public.songs set notes='newer' where id=pg_temp.id('song2');
 begin perform public.commit_song_bulk(pg_temp.id('org'),p.id); raise exception 'FAIL: stale commit accepted'; exception when sqlstate 'PT409' then null; end;
 perform pg_temp.assert((select themes=array['Hope'] from public.songs where id=pg_temp.id('song')),'stale batch rolled back');
 perform pg_temp.assert((select committed_at is null from public.song_bulk_previews where id=p.id),'stale preview uncommitted');
 select * into p2 from public.preview_song_bulk(pg_temp.id('org'),jsonb_build_array(jsonb_build_object('id',pg_temp.id('song'),'expected_revision',3)), '{"themes":["Reviewed"],"default_bpm":88}');
 p2:=public.commit_song_bulk(pg_temp.id('org'),p2.id);
 select count(*) into n from public.song_curation_events where preview_id=p2.id;
 perform pg_temp.assert(n=1 and p2.committed_at is not null,'commit audited');
 perform pg_temp.assert(public.commit_song_bulk(pg_temp.id('org'),p2.id)=p2,'retry identical committed result');
 perform pg_temp.assert((select count(*)=n from public.song_curation_events where preview_id=p2.id),'retry no duplicate audit');
 begin perform public.preview_song_bulk(pg_temp.id('org'),jsonb_build_array(jsonb_build_object('id',pg_temp.id('foreignsong'),'expected_revision',1)), '{"themes":[]}'); raise exception 'FAIL: foreign id'; exception when no_data_found then null; end;
 begin perform public.preview_song_bulk(pg_temp.id('org'),'[]','{"title":"forbidden"}'); raise exception 'FAIL: arbitrary patch'; exception when invalid_parameter_value then null; end;
 begin update public.song_bulk_previews set patch='{}' where id=p.id; raise exception 'FAIL: preview tampered'; exception when insufficient_privilege then null; end;
end$$;
-- Member usage matches existing source RLS (org members can read plan order);
-- tracking/audit rows and curation writes remain restricted.
select set_config('request.jwt.claim.sub',pg_temp.id('member')::text,true);
select set_config('request.jwt.claims',json_build_object('sub',pg_temp.id('member'),'role','authenticated')::text,true);
do $$declare r jsonb; begin
 r:=public.list_curated_songs(pg_temp.id('org'),'{"q":"F15 target","scheduled_from":"2027-08-01T00:00:00Z"}');
 perform pg_temp.assert((r->>'total')::int=(select count(distinct song_id) from public.plan_items i join public.plans p on p.id=i.plan_id where p.service_date >= '2027-08-01' and i.song_id in (pg_temp.id('song'),pg_temp.id('song2'))),'usage count matches source RLS');
 perform pg_temp.assert((select count(*)=0 from public.song_bulk_previews),'member preview privacy');
 perform pg_temp.assert((select count(*)=0 from public.song_curation_events),'member audit privacy');
 begin perform public.archive_library_record(pg_temp.id('org'),'song',pg_temp.id('song'),4,true); raise exception 'FAIL: member archive'; exception when insufficient_privilege then null; end;
 begin perform public.preview_song_bulk(pg_temp.id('org'),'[]','{"notes":"x"}'); raise exception 'FAIL: member preview'; exception when insufficient_privilege then null; end;
 perform pg_temp.assert((public.list_curated_songs(pg_temp.id('foreign'),'{}')->>'total')::int=0,'foreign org invisible');
end$$;
rollback;
