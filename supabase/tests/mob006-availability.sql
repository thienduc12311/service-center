-- MOB-006 timezone intent, bounded series, stale edits, exceptions and privacy.
-- Run after migrations against seeded local Supabase; everything rolls back.
begin;

create temporary table mob006_fx(k text primary key, id uuid) on commit drop;
grant select, insert on mob006_fx to authenticated, service_role;
insert into mob006_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('person', (select id from public.people where organization_id='aaaaaaaa-0000-4000-8000-000000000001' and profile_id='33333333-3333-4333-8333-333333333333')),
  ('plan', gen_random_uuid()), ('released_time', gen_random_uuid()), ('prepared_time', gen_random_uuid()),
  ('released_assignment', gen_random_uuid()), ('prepared_assignment', gen_random_uuid());

insert into public.plans(id,organization_id,service_type_id,title,service_date,status,created_by)
values((select id from mob006_fx where k='plan'),(select id from mob006_fx where k='org'),
  'bbbbbbbb-0000-4000-8000-000000000001','MOB-006 overlap','2027-03-14','published','22222222-2222-4222-8222-222222222222');
insert into public.plan_times(id,plan_id,kind,name,starts_at,ends_at,sort_order) values
  ((select id from mob006_fx where k='released_time'),(select id from mob006_fx where k='plan'),'rehearsal','Rehearsal','2027-03-14T13:30:00Z','2027-03-14T14:30:00Z',0),
  ((select id from mob006_fx where k='prepared_time'),(select id from mob006_fx where k='plan'),'service','Service','2027-03-21T13:30:00Z','2027-03-21T14:30:00Z',1);
insert into public.assignments(id,plan_id,user_id,person_id,team_id,position_id,status,visibility,attendance_mode,created_by) values
  ((select id from mob006_fx where k='released_assignment'),(select id from mob006_fx where k='plan'),'33333333-3333-4333-8333-333333333333',(select id from mob006_fx where k='person'),'cccccccc-0000-4000-8000-000000000001','dddddddd-0000-4000-8000-000000000003','unconfirmed','released','selected','22222222-2222-4222-8222-222222222222'),
  ((select id from mob006_fx where k='prepared_assignment'),(select id from mob006_fx where k='plan'),'33333333-3333-4333-8333-333333333333',(select id from mob006_fx where k='person'),'cccccccc-0000-4000-8000-000000000001','dddddddd-0000-4000-8000-000000000004','unconfirmed','prepared','selected','22222222-2222-4222-8222-222222222222');
insert into public.assignment_attendance_times(assignment_id,plan_time_id) values
  ((select id from mob006_fx where k='released_assignment'),(select id from mob006_fx where k='released_time')),
  ((select id from mob006_fx where k='prepared_assignment'),(select id from mob006_fx where k='prepared_time'));

set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';

do $$ begin
  begin
    perform public.create_blockout_series(
      (select id from mob006_fx where k='org'),
      (select id from public.people where organization_id=(select id from mob006_fx where k='org')
        and profile_id='22222222-2222-4222-8222-222222222222'),
      '{}'::jsonb,'[]'::jsonb,'60060000-0000-4000-8000-000000000099');
    raise exception 'member managed another Person';
  exception when sqlstate 'P0002' then null;
  end;
end $$;

select id from public.create_blockout_series(
  (select id from mob006_fx where k='org'), (select id from mob006_fx where k='person'),
  jsonb_build_object('timezone','America/New_York','all_day',false,'local_start_date','2027-03-07',
    'local_start_time','09:00','local_end_date','2027-03-07','local_end_time','10:00','reason','Private reason',
    'frequency','weekly','interval_count',1,'end_type','count','occurrence_count',3,'ambiguous_time_policy','earlier'),
  jsonb_build_array(
    jsonb_build_object('occurrence_key','2027-03-07T09:00','local_start_date','2027-03-07','local_start_time','09:00','local_end_date','2027-03-07','local_end_time','10:00','starts_at','2027-03-07T14:00:00Z','ends_at','2027-03-07T15:00:00Z'),
    jsonb_build_object('occurrence_key','2027-03-14T09:00','local_start_date','2027-03-14','local_start_time','09:00','local_end_date','2027-03-14','local_end_time','10:00','starts_at','2027-03-14T13:00:00Z','ends_at','2027-03-14T14:00:00Z'),
    jsonb_build_object('occurrence_key','2027-03-21T09:00','local_start_date','2027-03-21','local_start_time','09:00','local_end_date','2027-03-21','local_end_time','10:00','starts_at','2027-03-21T13:00:00Z','ends_at','2027-03-21T14:00:00Z')
  ), '60060000-0000-4000-8000-000000000001'
);

-- Replay creates one series, and wall time remains 09:00 across DST.
select id from public.create_blockout_series(
  (select id from mob006_fx where k='org'), (select id from mob006_fx where k='person'),
  jsonb_build_object('timezone','America/New_York','all_day',false,'local_start_date','2027-03-07',
    'local_start_time','09:00','local_end_date','2027-03-07','local_end_time','10:00','reason','Private reason',
    'frequency','weekly','interval_count',1,'end_type','count','occurrence_count',3,'ambiguous_time_policy','earlier'),
  '[]'::jsonb, '60060000-0000-4000-8000-000000000001'
);

do $$ begin
  if (select count(*) from public.blockout_series) <> 1 or (select count(*) from public.blockouts where series_id is not null) <> 3 then
    raise exception 'series replay duplicated rows';
  end if;
  if exists(select 1 from public.blockouts where series_id is not null and local_start_time <> time '09:00') then
    raise exception 'wall time drifted';
  end if;
  if (select count(*) from public.blockout_affected_assignments(
      (select id from mob006_fx where k='org'),(select id from mob006_fx where k='person'),
      '[{"starts_at":"2027-03-14T13:00:00Z","ends_at":"2027-03-21T14:00:00Z"}]')) <> 1 then
    raise exception 'recipient preview leaked prepared assignment or missed released rehearsal';
  end if;
end $$;

insert into mob006_fx select 'series',id from public.blockout_series limit 1;
insert into mob006_fx select 'occurrence',id from public.blockouts
 where series_id=(select id from mob006_fx where k='series') order by starts_at limit 1;
select public.change_blockout_series(
  (select id from mob006_fx where k='series'),0,'occurrence',(select id from mob006_fx where k='occurrence'),
  'delete',null,null,'60060000-0000-4000-8000-000000000003');
-- Lost-response retry returns the same result and does not duplicate the exception.
select public.change_blockout_series(
  (select id from mob006_fx where k='series'),0,'occurrence',(select id from mob006_fx where k='occurrence'),
  'delete',null,null,'60060000-0000-4000-8000-000000000003');
do $$ begin
  if (select count(*) from public.blockouts where series_id=(select id from mob006_fx where k='series')) <> 2
     or (select count(*) from public.blockout_series_exceptions where series_id=(select id from mob006_fx where k='series')) <> 1 then
    raise exception 'occurrence exception/retry was not idempotent';
  end if;
  begin
    perform public.change_blockout_series(
      (select id from mob006_fx where k='series'),0,'series',null,'delete',null,null,
      '60060000-0000-4000-8000-000000000004');
    raise exception 'stale series maintenance succeeded';
  exception when sqlstate 'PT409' then null;
  end;
end $$;

-- Actual all-day storage spans the 23-hour spring-forward Sunday.
insert into public.blockouts(organization_id,person_id,starts_at,ends_at,timezone,all_day,
  local_start_date,local_end_date,reason,idempotency_key)
values((select id from mob006_fx where k='org'),(select id from mob006_fx where k='person'),
  '2027-03-14T05:00:00Z','2027-03-15T04:00:00Z','America/New_York',true,'2027-03-14','2027-03-15','Sunday',
  '60060000-0000-4000-8000-000000000002');
insert into mob006_fx select 'oneoff',id from public.blockouts where idempotency_key='60060000-0000-4000-8000-000000000002';
do $$ begin
  if (select extract(epoch from ends_at-starts_at)/3600 from public.blockouts where id=(select id from mob006_fx where k='oneoff')) <> 23 then
    raise exception 'all-day spring interval is not 23 hours';
  end if;
  begin
    perform public.update_blockout((select id from mob006_fx where k='oneoff'),99,
      '{"starts_at":"2027-03-14T05:00:00Z","ends_at":"2027-03-15T04:00:00Z","timezone":"America/New_York","all_day":true,"local_start_date":"2027-03-14","local_end_date":"2027-03-15"}');
    raise exception 'stale update succeeded';
  exception when sqlstate 'PT409' then null;
  end;
  begin
    insert into public.blockouts(organization_id,person_id,starts_at,ends_at,timezone,all_day,local_start_date,local_end_date)
    values((select id from mob006_fx where k='org'),(select id from mob006_fx where k='person'),
      '2027-03-14T00:00:00Z','2027-03-15T00:00:00Z','America/New_York',true,'2027-03-14','2027-03-15');
    raise exception 'mismatched local and absolute interval persisted';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- A scheduler gets a generic reason through conflict output.
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$ begin
  if exists(select 1 from public.scheduling_conflicts_for_people(
    (select id from mob006_fx where k='org'),array[(select id from mob006_fx where k='person')],
    array[(select id from mob006_fx where k='released_time')],'{}') where conflict_type='blockout' and detail <> 'Unavailable') then
    raise exception 'private blockout reason leaked';
  end if;
end $$;

select public.change_blockout_series(
  (select id from mob006_fx where k='series'),1,'series',null,'delete',null,null,
  '60060000-0000-4000-8000-000000000005');
select public.change_blockout_series(
  (select id from mob006_fx where k='series'),1,'series',null,'delete',null,null,
  '60060000-0000-4000-8000-000000000005');
do $$ begin
  if exists(select 1 from public.blockout_series where id=(select id from mob006_fx where k='series'))
     or (select count(*) from public.blockout_operations where idempotency_key='60060000-0000-4000-8000-000000000005') <> 1 then
    raise exception 'whole-series delete retry was not idempotent';
  end if;
end $$;

rollback;
