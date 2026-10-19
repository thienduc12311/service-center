begin;
create temporary table f15b_ids(k text primary key,id uuid) on commit drop;
insert into f15b_ids values('org','aaaaaaaa-0000-4000-8000-000000000001'),('actor','22222222-2222-4222-8222-222222222222'),('member','33333333-3333-4333-8333-333333333333'),('other',gen_random_uuid()),('person',gen_random_uuid()),('foreign',gen_random_uuid()),('song',gen_random_uuid());
grant select on f15b_ids to authenticated;
create function pg_temp.id(k0 text) returns uuid language sql as $$select id from f15b_ids where k=k0$$;
create function pg_temp.assert(ok boolean,msg text) returns void language plpgsql as $$begin if ok is not true then raise exception 'FAIL: %',msg; end if; end$$;
create function pg_temp.source(kind text,content text default E'Title\nF15 imported') returns jsonb language sql as $$select jsonb_build_object('kind',kind,'filename','test.csv','content_type','text/csv','content',content,'mapping','{}'::jsonb,'resolutions','[]'::jsonb)$$;
create function pg_temp.save(kind text,key text,rows jsonb) returns public.structured_import_jobs language sql as $$
 select public.save_structured_import(pg_temp.id('org'),pg_temp.source(kind),encode(extensions.digest(pg_temp.source(kind)->>'content','sha256'),'hex'),repeat('a',64),rows,key)
$$;
insert into public.organizations(id,name,slug) values(pg_temp.id('other'),'F15B other','f15b-other');
insert into public.people(id,organization_id,first_name,last_name,email,medical_note) values
 (pg_temp.id('person'),pg_temp.id('org'),'F15B','Person','f15b@example.com','private medical'),
 (pg_temp.id('foreign'),pg_temp.id('other'),'Foreign','Person','f15b@example.com','foreign medical');
insert into public.songs(id,organization_id,title) values(pg_temp.id('song'),pg_temp.id('org'),'F15B original');
create function pg_temp.private_note() returns text language sql security definer as $$select medical_note from public.people where id=pg_temp.id('person')$$;
create function pg_temp.force_import_failure() returns trigger language plpgsql as $$
begin if new.title='F15B forced failure' and current_setting('f15.fail',true)='on' then raise exception 'forced import failure' using errcode='22023'; end if; return new; end$$;
create trigger f15b_test_failure before insert on public.songs for each row execute function pg_temp.force_import_failure();
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.id('actor')::text,true);
select set_config('request.jwt.claims',json_build_object('sub',pg_temp.id('actor'),'role','authenticated')::text,true);
do $$declare ctx jsonb; j public.structured_import_jobs; j2 public.structured_import_jobs; version text; r jsonb; new_id uuid; old_profile uuid; n int; begin
 -- Read-only context returns allowlisted data, exact org matches and versions.
 select count(*) into n from public.structured_import_jobs;
 ctx:=public.structured_import_context(pg_temp.id('org'),'people','[{"row":2,"data":{"email":"f15b@example.com"}}]');
 perform pg_temp.assert((ctx->0->>'candidate_count')::int=1,'same-email suggestion is org-scoped');
 perform pg_temp.assert(not (ctx->0->'candidates'->0->'data') ? 'medical_note' and not (ctx->0->'candidates'->0->'data') ? 'profile_id','context excludes protected person fields');
 perform pg_temp.assert((select count(*)=n from public.structured_import_jobs),'context writes no tracking records');
 version:=ctx->0->'candidates'->0->>'version';
 select profile_id into old_profile from public.people where id=pg_temp.id('person');
 j:=pg_temp.save('people','f15b-person-key',jsonb_build_array(
   jsonb_build_object('row',2,'action','update','target_id',pg_temp.id('person'),'expected_version',version,'data',jsonb_build_object('campus','North')),
   jsonb_build_object('row',3,'action','create','data',jsonb_build_object('first_name','F15B new','email','f15b@example.com')),
   jsonb_build_object('row',4,'action','skip','data','{}'::jsonb)));
 perform pg_temp.assert((select campus is null from public.people where id=pg_temp.id('person')),'saving review does not update person');
 j2:=public.commit_structured_import(pg_temp.id('org'),j.id,1);
 perform pg_temp.assert(j2.status='committed' and j2.revision=2,'committed job');
 perform pg_temp.assert((select campus='North' and profile_id is not distinct from old_profile and pg_temp.private_note()='private medical' from public.people where id=pg_temp.id('person')),'update preserves identity and restricted metadata');
 select result_id into new_id from public.structured_import_rows where job_id=j.id and row_number=3;
 perform pg_temp.assert((select profile_id is null and email='f15b@example.com' from public.people where id=new_id),'same email creates separate no-login Person, never merges');
 perform pg_temp.assert((select result_id is null and after_data is null from public.structured_import_rows where job_id=j.id and row_number=4),'skip provenance');
 perform pg_temp.assert(public.commit_structured_import(pg_temp.id('org'),j.id,1)=j2,'committed replay');
 perform pg_temp.assert((pg_temp.save('people','f15b-person-key','[]')).id=j.id,'save replay after commit');
 begin update public.structured_import_rows set data='{}' where job_id=j.id; raise exception 'FAIL: edited saved review'; exception when insufficient_privilege then null; end;
 -- Stale versions roll back every row and retain a resumable reviewed job.
 ctx:=public.structured_import_context(pg_temp.id('org'),'songs',jsonb_build_array(jsonb_build_object('row',2,'target_id',pg_temp.id('song'),'data','{}'::jsonb)));
 version:=ctx->0->'candidates'->0->>'version';
 j:=pg_temp.save('songs','f15b-stale-key',jsonb_build_array(
   jsonb_build_object('row',2,'action','create','data',jsonb_build_object('title','F15B must not appear')),
   jsonb_build_object('row',3,'action','update','target_id',pg_temp.id('song'),'expected_version',version,'data',jsonb_build_object('notes','old preview'))));
 update public.songs set notes='newer author' where id=pg_temp.id('song');
 begin perform public.commit_structured_import(pg_temp.id('org'),j.id,1); raise exception 'FAIL: stale import committed'; exception when sqlstate 'PT409' then null; end;
 perform pg_temp.assert(not exists(select 1 from public.songs where title='F15B must not appear'),'stale import creates nothing');
 perform pg_temp.assert((select status='reviewed' from public.structured_import_jobs where id=j.id),'stale job retained');
 -- Force a mid-batch failure after a successful song+arrangement create.
 j:=pg_temp.save('songs','f15b-failure-key','[{"row":2,"action":"create","data":{"title":"F15B first row","default_key":"G","default_bpm":75}},{"row":3,"action":"create","data":{"title":"F15B forced failure"}}]');
 perform set_config('f15.fail','on',true);
 begin perform public.commit_structured_import(pg_temp.id('org'),j.id,1); raise exception 'FAIL: forced failure did not fail'; exception when invalid_parameter_value then
   perform pg_temp.assert(sqlerrm='Import record 2 failed; no rows were committed','failure identifies the exact record without content');
 end;
 perform pg_temp.assert(not exists(select 1 from public.songs where title='F15B first row'),'mid-batch row rolled back');
 perform pg_temp.assert(not exists(select 1 from public.structured_import_rows where job_id=j.id and result_id is not null),'mid-batch result IDs rolled back');
 perform pg_temp.assert((select status='reviewed' from public.structured_import_jobs where id=j.id),'failed job resumable');
 perform set_config('f15.fail','off',true);
 j2:=public.commit_structured_import(pg_temp.id('org'),j.id,1);
 perform pg_temp.assert((select count(*)=2 from public.structured_import_rows where job_id=j.id and result_id is not null),'retry completes all rows');
 select result_id into new_id from public.structured_import_rows where job_id=j.id and row_number=2;
 perform pg_temp.assert((select count(*)=1 from public.arrangements where song_id=new_id and is_default and song_key='G' and bpm=75),'song has ordinary default arrangement');
 begin
   perform pg_temp.save('people','f15b-foreign-key',jsonb_build_array(jsonb_build_object('row',2,'action','update','target_id',pg_temp.id('foreign'),'expected_version',version,'data',jsonb_build_object('campus','x'))));
   raise exception 'FAIL: foreign target saved'; exception when no_data_found then null; end;
 begin perform pg_temp.save('people','f15b-link-key','[{"row":2,"action":"create","data":{"first_name":"Bad","profile_id":"22222222-2222-4222-8222-222222222222"}}]'); raise exception 'FAIL: link injection'; exception when invalid_parameter_value then null; end;
 begin perform pg_temp.save('songs','f15b-rows-key','[{"row":2,"action":"unresolved","data":{}}]'); raise exception 'FAIL: unresolved saved'; exception when invalid_parameter_value then null; end;
 begin perform pg_temp.save('songs','f15b-malformed-key','[{"row":2,"action":"create","data":{"title":"x","default_bpm":999}}]'); raise exception 'FAIL: invalid musical metadata'; exception when invalid_parameter_value then null; end;
end$$;
select set_config('request.jwt.claim.sub',pg_temp.id('member')::text,true);
select set_config('request.jwt.claims',json_build_object('sub',pg_temp.id('member'),'role','authenticated')::text,true);
do $$begin
 perform pg_temp.assert((select count(*)=0 from public.structured_import_jobs),'member cannot read source/jobs');
 perform pg_temp.assert((select count(*)=0 from public.structured_import_rows),'member cannot read rows');
 begin perform public.structured_import_context(pg_temp.id('org'),'people','[]'); raise exception 'FAIL: member candidates'; exception when insufficient_privilege then null; end;
 begin perform pg_temp.save('songs','f15b-member-key','[]'); raise exception 'FAIL: member save'; exception when insufficient_privilege then null; end;
end$$;
reset role;
-- A capability granted for review is rechecked at commit and subsequent reads.
insert into public.access_grants(organization_id,user_id,capability,scope_type)
values(pg_temp.id('org'),pg_temp.id('member'),'songs.manage','organization');
create temporary table f15b_revoked_job(id uuid) on commit drop;
grant all on f15b_revoked_job to authenticated;
set local role authenticated;
insert into f15b_revoked_job select (pg_temp.save('songs','f15b-revoked-key','[{"row":2,"action":"create","data":{"title":"F15B revoked create"}}]')).id;
reset role;
delete from public.access_grants where organization_id=pg_temp.id('org') and user_id=pg_temp.id('member') and capability='songs.manage';
set local role authenticated;
do $$begin
 perform pg_temp.assert((select count(*)=0 from public.structured_import_jobs),'revoked capability hides source');
 begin perform public.commit_structured_import(pg_temp.id('org'),(select id from f15b_revoked_job),1); raise exception 'FAIL: revoked commit'; exception when insufficient_privilege then null; end;
end$$;
reset role;
select pg_temp.assert(not exists(select 1 from public.songs where title='F15B revoked create'),'revoked commit creates nothing');
rollback;
