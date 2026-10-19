-- F16: actual attendance (authority, forged teams, revisions, atomic batches,
-- idempotency, history), report-export jobs and their Storage access, scoped
-- calendar feeds and layers, and public publication — exercised as each
-- caller (role + JWT) against the seeded local database. Everything rolls back.
--
-- Seeded people: Jordan (scheduler, legacy = every capability), Sam, Riley and
-- Morgan (members). Sam gets scheduling.manage on the Worship Band *team* only.
-- Riley and Morgan are on the Band roster; Morgan also on Hospitality.
begin;

create temporary table f16_fx (k text primary key, id uuid) on commit drop;
grant select, insert on f16_fx to authenticated, service_role;
insert into f16_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('st', 'bbbbbbbb-0000-4000-8000-000000000001'),
  ('band', 'cccccccc-0000-4000-8000-000000000001'),
  ('production', 'cccccccc-0000-4000-8000-000000000002'),
  ('hospitality', 'cccccccc-0000-4000-8000-000000000003'),
  ('jordan', '22222222-2222-4222-8222-222222222222'),
  ('sam', '33333333-3333-4333-8333-333333333333'),
  ('riley', '44444444-4444-4444-8444-444444444444'),
  ('morgan', '55555555-5555-4555-8555-555555555555'),
  ('owner', '11111111-1111-4111-8111-111111111111'),
  ('plan', gen_random_uuid()), ('t9', gen_random_uuid()), ('reh', gen_random_uuid()),
  ('a_riley_band', gen_random_uuid()), ('a_riley_prod', gen_random_uuid()), ('a_morgan_hosp', gen_random_uuid()),
  ('a_it_prepared', gen_random_uuid()), ('blockout', gen_random_uuid());
create or replace function pg_temp.fx(p text) returns uuid language sql stable as $$ select id from f16_fx where k = p $$;
create or replace function pg_temp.as_user(p text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', (select id::text from f16_fx where k = p), true);
  select set_config('request.jwt.claims', json_build_object('sub', (select id::text from f16_fx where k = p), 'role', 'authenticated')::text, true);
$$;
-- Resolved once as postgres: members cannot read the people table under RLS.
insert into f16_fx
select 'person:' || f.k, pe.id from f16_fx f
  join public.people pe on pe.profile_id = f.id and pe.organization_id = 'aaaaaaaa-0000-4000-8000-000000000001'
 where f.k in ('jordan', 'sam', 'riley', 'morgan', 'owner');
create or replace function pg_temp.person(p text) returns uuid language sql stable as $$
  select id from f16_fx where k = 'person:' || p
$$;
create or replace function pg_temp.mark(p_person text, p_team text, p_status text, p_rev int) returns jsonb language sql stable as $$
  select jsonb_build_object('person_id', pg_temp.person(p_person), 'team_id', pg_temp.fx(p_team), 'status', p_status, 'expected_revision', p_rev)
$$;

insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by)
values (pg_temp.fx('plan'), pg_temp.fx('org'), pg_temp.fx('st'), 'F16 Plan', '2027-08-01 14:00+00', 'published', pg_temp.fx('jordan'));
insert into public.plan_times (id, plan_id, kind, name, starts_at, ends_at) values
  (pg_temp.fx('t9'), pg_temp.fx('plan'), 'service', '9am', '2027-08-01 14:00+00', '2027-08-01 15:00+00'),
  (pg_temp.fx('reh'), pg_temp.fx('plan'), 'rehearsal', 'Run-through', '2027-07-30 00:00+00', '2027-07-30 01:00+00');
-- Riley: Band (all times, confirmed) and Production (9am only, pending) → one Person, two roles.
-- Morgan: Hospitality only. IT (owner's Person): a prepared Band request.
insert into public.assignments (id, plan_id, person_id, user_id, team_id, status, visibility, created_by) values
  (pg_temp.fx('a_riley_band'), pg_temp.fx('plan'), pg_temp.person('riley'), pg_temp.fx('riley'), pg_temp.fx('band'), 'confirmed', 'released', pg_temp.fx('jordan')),
  (pg_temp.fx('a_riley_prod'), pg_temp.fx('plan'), pg_temp.person('riley'), pg_temp.fx('riley'), pg_temp.fx('production'), 'unconfirmed', 'released', pg_temp.fx('jordan')),
  (pg_temp.fx('a_morgan_hosp'), pg_temp.fx('plan'), pg_temp.person('morgan'), pg_temp.fx('morgan'), pg_temp.fx('hospitality'), 'confirmed', 'released', pg_temp.fx('jordan')),
  (pg_temp.fx('a_it_prepared'), pg_temp.fx('plan'), pg_temp.person('owner'), pg_temp.fx('owner'), pg_temp.fx('band'), 'unconfirmed', 'prepared', pg_temp.fx('jordan'));
update public.assignments set attendance_mode = 'selected' where id = pg_temp.fx('a_riley_prod');
insert into public.assignment_attendance_times (assignment_id, plan_time_id) values (pg_temp.fx('a_riley_prod'), pg_temp.fx('t9'));
insert into public.access_grants (organization_id, user_id, capability, scope_type, team_id)
values (pg_temp.fx('org'), pg_temp.fx('sam'), 'scheduling.manage', 'team', pg_temp.fx('band'));

set local role authenticated;

-- ============================================================ attendance =====
select pg_temp.as_user('sam');
do $$
declare r jsonb; v_rev bigint;
begin
  -- Mark Riley through Band (Sam schedules Band; Riley is on it at 9am).
  r := public.record_attendance(pg_temp.fx('t9'), jsonb_build_array(pg_temp.mark('riley', 'band', 'present', 0)), null, 'k-sam-1');
  if (r ->> 'applied')::int <> 1 or (r -> 'records' -> 0 ->> 'revision')::int <> 1 then
    raise exception 'FAIL: first mark %', r;
  end if;

  -- Forged team: Morgan is not on Band at this time.
  begin
    perform public.record_attendance(pg_temp.fx('t9'), jsonb_build_array(pg_temp.mark('morgan', 'band', 'present', 0)), null, 'k-sam-forged');
    raise exception 'FAIL: forged team accepted';
  exception when insufficient_privilege then null; end;
  -- Real team the caller does not schedule.
  begin
    perform public.record_attendance(pg_temp.fx('t9'), jsonb_build_array(pg_temp.mark('morgan', 'hospitality', 'present', 0)), null, 'k-sam-hosp');
    raise exception 'FAIL: other team accepted';
  exception when insufficient_privilege then null; end;
  -- Riley through Production (Sam does not schedule Production) is refused too.
  begin
    perform public.record_attendance(pg_temp.fx('t9'), jsonb_build_array(pg_temp.mark('riley', 'production', 'absent', 1)), null, 'k-sam-prod');
    raise exception 'FAIL: unscheduled team accepted';
  exception when insufficient_privilege then null; end;
  -- A prepared request is nobody's schedule yet.
  begin
    perform public.record_attendance(pg_temp.fx('t9'), jsonb_build_array(pg_temp.mark('owner', 'band', 'present', 0)), null, 'k-sam-prepared');
    raise exception 'FAIL: prepared request markable';
  exception when insufficient_privilege then null; end;

  -- Stale revision (saw nothing, but a record exists).
  begin
    perform public.record_attendance(pg_temp.fx('t9'), jsonb_build_array(pg_temp.mark('riley', 'band', 'absent', 0)), null, 'k-sam-stale');
    raise exception 'FAIL: stale revision accepted';
  exception when sqlstate 'PT409' then null; end;

  -- Correction with the revision seen.
  r := public.record_attendance(pg_temp.fx('t9'), jsonb_build_array(pg_temp.mark('riley', 'band', 'absent', 1)), 'Left before service', 'k-sam-2');
  if (r -> 'records' -> 0 ->> 'revision')::int <> 2 then raise exception 'FAIL: correction revision %', r; end if;

  -- Same status again: unchanged, no new revision.
  r := public.record_attendance(pg_temp.fx('t9'), jsonb_build_array(pg_temp.mark('riley', 'band', 'absent', 2)), null, 'k-sam-3');
  if (r ->> 'unchanged')::int <> 1 or (r -> 'records' -> 0 ->> 'revision')::int <> 2 then raise exception 'FAIL: unchanged %', r; end if;

  -- Replay returns the stored result; a different payload under the key is refused.
  r := public.record_attendance(pg_temp.fx('t9'), jsonb_build_array(pg_temp.mark('riley', 'band', 'absent', 1)), 'Left before service', 'k-sam-2');
  if not (r ->> 'replayed')::boolean then raise exception 'FAIL: replay %', r; end if;
  begin
    perform public.record_attendance(pg_temp.fx('t9'), jsonb_build_array(pg_temp.mark('riley', 'band', 'present', 2)), null, 'k-sam-2');
    raise exception 'FAIL: key reuse accepted';
  exception when sqlstate 'PT409' then null; end;

  -- Rehearsal: Riley's Band request covers every time.
  r := public.record_attendance(pg_temp.fx('reh'), jsonb_build_array(pg_temp.mark('riley', 'band', 'present', 0)), null, 'k-sam-reh');
  if (r ->> 'applied')::int <> 1 then raise exception 'FAIL: rehearsal mark'; end if;

  -- Direct writes are refused.
  begin
    insert into public.attendance_records (organization_id, plan_id, plan_time_id, person_id, status, time_kind, time_starts_at, time_ends_at)
    values (pg_temp.fx('org'), pg_temp.fx('plan'), pg_temp.fx('t9'), pg_temp.person('morgan'), 'present', 'service', now(), now() + interval '1 hour');
    raise exception 'FAIL: direct insert';
  exception when insufficient_privilege then null; end;
  begin
    update public.attendance_records set status = 'present' where plan_time_id = pg_temp.fx('t9');
    raise exception 'FAIL: direct update';
  exception when insufficient_privilege then null; end;
end $$;

-- Jordan: an atomic batch where one mark is invalid applies nothing.
select pg_temp.as_user('jordan');
do $$
declare v_rev bigint; v_count int;
begin
  begin
    perform public.record_attendance(pg_temp.fx('t9'), jsonb_build_array(
      pg_temp.mark('riley', 'band', 'present', 2),
      pg_temp.mark('morgan', 'band', 'present', 0)), null, 'k-jordan-atomic');
    raise exception 'FAIL: partial batch accepted';
  exception when insufficient_privilege then null; end;
  select revision into v_rev from public.attendance_records where plan_time_id = pg_temp.fx('t9') and person_id = pg_temp.person('riley');
  if v_rev <> 2 then raise exception 'FAIL: atomic batch leaked (rev %)', v_rev; end if;
  -- Jordan (legacy scheduler) marks Morgan through Hospitality and Riley through Production in one batch.
  perform public.record_attendance(pg_temp.fx('t9'), jsonb_build_array(
    pg_temp.mark('morgan', 'hospitality', 'present', 0),
    pg_temp.mark('riley', 'production', 'present', 2)), 'Arrived late', 'k-jordan-ok');
  select count(*) into v_count from public.attendance_records where plan_time_id = pg_temp.fx('t9');
  if v_count <> 2 then raise exception 'FAIL: one record per person expected, got %', v_count; end if;
  -- Duplicate person in one batch is refused.
  begin
    perform public.record_attendance(pg_temp.fx('t9'), jsonb_build_array(
      pg_temp.mark('morgan', 'hospitality', 'absent', 1), pg_temp.mark('morgan', 'hospitality', 'present', 1)), null, 'k-jordan-dup');
    raise exception 'FAIL: duplicate person accepted';
  exception when invalid_parameter_value then null; end;
  -- History: 3 events for Riley at 9am, with previous status and reason.
  select count(*) into v_count from public.attendance_events e join public.attendance_records r on r.id = e.record_id
   where r.plan_time_id = pg_temp.fx('t9') and r.person_id = pg_temp.person('riley');
  if v_count <> 3 then raise exception 'FAIL: history count %', v_count; end if;
  if not exists (select 1 from public.attendance_events e join public.attendance_records r on r.id = e.record_id
                  where r.person_id = pg_temp.person('riley') and e.previous_status = 'present' and e.status = 'absent'
                    and e.reason = 'Left before service') then
    raise exception 'FAIL: correction history';
  end if;
end $$;

-- Confirmation is untouched by absence.
reset role;
do $$ begin
  if (select status from public.assignments where id = pg_temp.fx('a_riley_band')) <> 'confirmed' then
    raise exception 'FAIL: attendance changed the answer';
  end if;
  begin
    update public.attendance_events set reason = 'x';
    raise exception 'FAIL: history update';
  exception when sqlstate 'PT409' then null; end;
end $$;
set local role authenticated;

-- Reads: Riley sees own records; Morgan sees only own; Sam sees Band people only.
select pg_temp.as_user('riley');
do $$ begin
  if (select count(*) from public.attendance_records where plan_id = pg_temp.fx('plan')) <> 2 then
    raise exception 'FAIL: own records (9am + rehearsal)';
  end if;
end $$;
select pg_temp.as_user('morgan');
do $$ begin
  if exists (select 1 from public.attendance_records where person_id <> pg_temp.person('morgan')) then
    raise exception 'FAIL: member read another person''s attendance';
  end if;
end $$;
select pg_temp.as_user('sam');
do $$ begin
  if exists (select 1 from public.attendance_records where person_id = pg_temp.person('morgan')) then
    raise exception 'FAIL: Band scheduler read a Hospitality-only person';
  end if;
  if not exists (select 1 from public.attendance_records where person_id = pg_temp.person('riley')) then
    raise exception 'FAIL: Band scheduler cannot read Band person';
  end if;
end $$;

-- History survives an archived Person and a deleted time.
reset role;
update public.people set archived_at = now() where id = pg_temp.person('riley');
delete from public.plan_times where id = pg_temp.fx('reh');
do $$ begin
  if not exists (select 1 from public.attendance_records where person_id = pg_temp.person('riley') and plan_time_id is null
                  and time_kind = 'rehearsal' and time_name = 'Run-through') then
    raise exception 'FAIL: rehearsal record lost with its time';
  end if;
end $$;
update public.people set archived_at = null where id = pg_temp.person('riley');
set local role authenticated;

-- ============================================================== exports =====
select pg_temp.as_user('riley');
do $$ begin
  begin
    perform public.request_report_export(pg_temp.fx('org'), 'staffing', '{"from":"2027-08-01","to":"2027-08-31"}', 'k-riley-export');
    raise exception 'FAIL: member queued a staffing export';
  exception when insufficient_privilege then null; end;
  begin
    perform public.claim_report_exports(5, 60);
    raise exception 'FAIL: member claimed exports';
  exception when insufficient_privilege then null; end;
end $$;
select pg_temp.as_user('sam');
do $$
declare v public.report_exports;
begin
  -- Sam schedules a team: staffing yes, song usage no.
  v := public.request_report_export(pg_temp.fx('org'), 'staffing', '{"from":"2027-08-01","to":"2027-08-31"}', 'k-sam-export');
  if v.status <> 'queued' then raise exception 'FAIL: export not queued'; end if;
  begin
    perform public.request_report_export(pg_temp.fx('org'), 'song_usage', '{"from":"2027-08-01","to":"2027-08-31"}', 'k-sam-songs');
    raise exception 'FAIL: Sam queued song usage';
  exception when insufficient_privilege then null; end;
end $$;
select pg_temp.as_user('jordan');
do $$
declare v1 public.report_exports; v2 public.report_exports;
begin
  v1 := public.request_report_export(pg_temp.fx('org'), 'participation', '{"from":"2027-08-01","to":"2027-08-31"}', 'k-jordan-export');
  v2 := public.request_report_export(pg_temp.fx('org'), 'participation', '{"from":"2027-08-01","to":"2027-08-31"}', 'k-jordan-export');
  if v1.id <> v2.id then raise exception 'FAIL: export idempotency'; end if;
  begin
    perform public.request_report_export(pg_temp.fx('org'), 'participation', '{"from":"2027-08-02","to":"2027-08-31"}', 'k-jordan-export');
    raise exception 'FAIL: export key reuse';
  exception when sqlstate 'PT409' then null; end;
  insert into f16_fx values ('export', v1.id);
  -- Jordan sees only own jobs.
  if exists (select 1 from public.report_exports where requested_by <> pg_temp.fx('jordan')) then
    raise exception 'FAIL: another requester''s export visible';
  end if;
end $$;

-- A finished export: only the requester reads the object, only while permitted and unexpired.
reset role;
update public.report_exports
   set status = 'ready', storage_path = 'f16-test/' || id || '.csv', generated_at = now(), expires_at = now() + interval '1 day'
 where id = pg_temp.fx('export');
insert into storage.objects (bucket_id, name, owner_id) values ('report-exports', 'f16-test/' || pg_temp.fx('export') || '.csv', null);
set local role authenticated;
select pg_temp.as_user('jordan');
do $$ begin
  if not exists (select 1 from storage.objects where bucket_id = 'report-exports' and name = 'f16-test/' || pg_temp.fx('export') || '.csv') then
    raise exception 'FAIL: requester cannot read export object';
  end if;
end $$;
select pg_temp.as_user('sam');
do $$ begin
  if exists (select 1 from storage.objects where bucket_id = 'report-exports' and name = 'f16-test/' || pg_temp.fx('export') || '.csv') then
    raise exception 'FAIL: another user read the export object';
  end if;
end $$;
reset role;
update public.organization_members set role = 'member' where organization_id = pg_temp.fx('org') and user_id = pg_temp.fx('jordan');
set local role authenticated;
select pg_temp.as_user('jordan');
do $$ begin
  if exists (select 1 from storage.objects where bucket_id = 'report-exports' and name = 'f16-test/' || pg_temp.fx('export') || '.csv') then
    raise exception 'FAIL: revoked requester still reads the export';
  end if;
end $$;
reset role;
update public.organization_members set role = 'scheduler' where organization_id = pg_temp.fx('org') and user_id = pg_temp.fx('jordan');
update public.report_exports set expires_at = now() - interval '1 second' where id = pg_temp.fx('export');
set local role authenticated;
select pg_temp.as_user('jordan');
do $$ begin
  if exists (select 1 from storage.objects where bucket_id = 'report-exports' and name = 'f16-test/' || pg_temp.fx('export') || '.csv') then
    raise exception 'FAIL: expired export readable';
  end if;
end $$;

-- ===================================================== feeds and layers =====
reset role;
update public.people set birthdate = '1990-02-28', anniversary_date = '2015-06-20' where id = pg_temp.person('riley');
update public.people set birthdate = '1991-03-03' where id = pg_temp.person('morgan');
insert into public.blockouts (id, organization_id, person_id, user_id, starts_at, ends_at, reason)
values (pg_temp.fx('blockout'), pg_temp.fx('org'), pg_temp.person('riley'), pg_temp.fx('riley'), '2027-02-10 00:00+00', '2027-02-12 00:00+00', 'Private reason');
set local role authenticated;

select pg_temp.as_user('riley');
do $$ begin
  -- Opt in (self) to the birthday only.
  insert into public.person_calendar_sharing (person_id, organization_id, share_birthday, share_anniversary, updated_by)
  values (pg_temp.person('riley'), pg_temp.fx('org'), true, false, pg_temp.fx('riley'))
  on conflict (person_id) do update set share_birthday = true, share_anniversary = false, updated_by = excluded.updated_by;
end $$;
select pg_temp.as_user('morgan');
do $$ begin
  -- Morgan cannot opt Riley in to anything, nor read Riley's choice.
  begin
    update public.person_calendar_sharing set share_anniversary = true, updated_by = pg_temp.fx('morgan') where person_id = pg_temp.person('riley');
    if found then raise exception 'FAIL: member changed another person''s sharing'; end if;
  end;
  if exists (select 1 from public.person_calendar_sharing where person_id = pg_temp.person('riley')) then
    raise exception 'FAIL: member read another person''s sharing';
  end if;
  -- Morgan is on the Band roster: personal dates yes, blockouts never.
  if exists (select 1 from public.team_calendar_layers(pg_temp.fx('band'), '2027-01-01', '2027-12-31', array['blockouts'])) then
    raise exception 'FAIL: roster member saw blockouts';
  end if;
  if (select count(*) from public.team_calendar_layers(pg_temp.fx('band'), '2027-01-01', '2027-12-31', array['birthdays', 'anniversaries'])) <> 1 then
    raise exception 'FAIL: opted-in birthday only (Morgan did not opt in; Riley''s anniversary is not shared)';
  end if;
  -- Feeds: Morgan may subscribe to the Band (on roster) but not Production.
  insert into public.calendar_scoped_feeds (organization_id, user_id, scope_type, team_id, token_hash)
  values (pg_temp.fx('org'), pg_temp.fx('morgan'), 'team', pg_temp.fx('band'), 'hash-morgan-band');
  begin
    insert into public.calendar_scoped_feeds (organization_id, user_id, scope_type, team_id, token_hash)
    values (pg_temp.fx('org'), pg_temp.fx('morgan'), 'team', pg_temp.fx('production'), 'hash-morgan-prod');
    raise exception 'FAIL: feed for a team the user is not on';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.calendar_scoped_feeds (organization_id, user_id, scope_type, team_id, token_hash)
    values (pg_temp.fx('org'), pg_temp.fx('riley'), 'team', pg_temp.fx('band'), 'hash-forged-owner');
    raise exception 'FAIL: feed created for another user';
  exception when insufficient_privilege then null; end;
  -- Revocation is the only update.
  begin
    update public.calendar_scoped_feeds set team_id = pg_temp.fx('production') where token_hash = 'hash-morgan-band';
    raise exception 'FAIL: feed scope changed';
  exception when insufficient_privilege then null; end;
end $$;

select pg_temp.as_user('sam');
do $$
declare v record;
begin
  -- Sam schedules the Band: blockouts without reasons, and the birthday as month/day in the year asked.
  select * into v from public.team_calendar_layers(pg_temp.fx('band'), '2027-01-01', '2027-12-31', array['blockouts'])
   where source_id = pg_temp.fx('blockout');
  if v.layer is distinct from 'blockouts' or v.person_name not like 'Riley%' then
    raise exception 'FAIL: blockout layer %', to_jsonb(v);
  end if;
  select * into v from public.team_calendar_layers(pg_temp.fx('band'), '2028-01-01', '2028-12-31', array['birthdays']) limit 1;
  if v.on_date <> '2028-02-28' then raise exception 'FAIL: birthday date %', v.on_date; end if;
  begin
    perform public.team_calendar_layers(pg_temp.fx('band'), '2027-01-01', '2028-06-01', array['birthdays']);
    raise exception 'FAIL: unbounded layer range';
  exception when invalid_parameter_value then null; end;
end $$;

reset role;
do $$ begin
  if (public.scoped_feed_access_for(pg_temp.fx('sam'), pg_temp.fx('org'), 'team', null, pg_temp.fx('band')) ->> 'names')::boolean is not true then
    raise exception 'FAIL: scheduler feed access';
  end if;
  if (public.scoped_feed_access_for(pg_temp.fx('morgan'), pg_temp.fx('org'), 'team', null, pg_temp.fx('band')) ->> 'names')::boolean is not false then
    raise exception 'FAIL: roster feed access shows names';
  end if;
  -- Deactivated membership: the feed must not be served.
  update public.organization_members set status = 'inactive' where organization_id = pg_temp.fx('org') and user_id = pg_temp.fx('morgan');
  if public.scoped_feed_access_for(pg_temp.fx('morgan'), pg_temp.fx('org'), 'team', null, pg_temp.fx('band')) is not null then
    raise exception 'FAIL: inactive member keeps feed access';
  end if;
  update public.organization_members set status = 'active' where organization_id = pg_temp.fx('org') and user_id = pg_temp.fx('morgan');
end $$;
set local role authenticated;

-- ========================================================== publication =====
select pg_temp.as_user('sam');
do $$ begin
  begin
    perform public.publish_plan(pg_temp.fx('plan'), array['title'], 'now', 0);
    raise exception 'FAIL: non-editor published';
  exception when insufficient_privilege then null; end;
end $$;
select pg_temp.as_user('jordan');
do $$
declare v public.plan_publications; v_slug text; l1 public.public_set_list_links; l2 public.public_set_list_links;
begin
  v := public.publish_plan(pg_temp.fx('plan'), array['songs', 'title', 'title'], 'service_day', 0);
  if v.fields <> array['songs', 'title'] or v.revision <> 1 or v.slug is null then raise exception 'FAIL: publish %', to_jsonb(v); end if;
  v_slug := v.slug;
  begin
    perform public.publish_plan(pg_temp.fx('plan'), array['people'], 'now', 1);
    raise exception 'FAIL: people field accepted';
  exception when check_violation then null; end;
  begin
    perform public.publish_plan(pg_temp.fx('plan'), array['title'], 'now', 0);
    raise exception 'FAIL: stale publish accepted';
  exception when sqlstate 'PT409' then null; end;
  v := public.revoke_plan_publication(pg_temp.fx('plan'), 1);
  if v.revoked_at is null then raise exception 'FAIL: revoke'; end if;
  -- Re-publishing keeps the slug unless a new link is asked for.
  v := public.publish_plan(pg_temp.fx('plan'), array['title'], 'now', 2);
  if v.slug <> v_slug or v.revoked_at is not null then raise exception 'FAIL: republish slug'; end if;
  v := public.publish_plan(pg_temp.fx('plan'), array['title'], 'now', 3, true);
  if v.slug = v_slug then raise exception 'FAIL: new link kept old slug'; end if;

  l1 := public.set_public_set_list_link(pg_temp.fx('st'), 'upcoming', 'create');
  l2 := public.set_public_set_list_link(pg_temp.fx('st'), 'upcoming', 'create');
  if l1.id <> l2.id then raise exception 'FAIL: link create not idempotent'; end if;
  l2 := public.set_public_set_list_link(pg_temp.fx('st'), 'upcoming', 'rotate');
  if l2.slug = l1.slug or (select revoked_at from public.public_set_list_links where id = l1.id) is null then
    raise exception 'FAIL: rotate';
  end if;
end $$;
select pg_temp.as_user('riley');
do $$ begin
  if exists (select 1 from public.plan_publications) or exists (select 1 from public.public_set_list_links) then
    raise exception 'FAIL: member reads publication settings';
  end if;
  begin
    perform public.set_public_set_list_link(pg_temp.fx('st'), 'recent', 'create');
    raise exception 'FAIL: member created a public link';
  exception when no_data_found then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin
    perform 1 from public.plan_publications;
    raise exception 'FAIL: anon reads publications';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select 'f16-attendance-reports: all checks passed' as result;
rollback;
