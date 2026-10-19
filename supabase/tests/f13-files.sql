-- F13: file ownership, versions, audiences and raw Storage access.
-- Callers act through their own role and JWT; Storage uploads are simulated
-- by inserting into storage.objects *as the caller*, so the bucket's INSERT
-- policy is what is under test. Run against the seeded local database.
-- Everything rolls back.
--
-- Seeded people: Jordan (scheduler, legacy = every capability), Sam (member;
-- Worship Band: Electric Guitar, Bass), Riley (member; Worship Band: Drums;
-- Production), Morgan (member; Worship Band: Keys; Hospitality).
begin;

create temporary table f13_fx (k text primary key, id uuid) on commit drop;
grant select, insert on f13_fx to authenticated, service_role;
insert into f13_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('st', 'bbbbbbbb-0000-4000-8000-000000000001'),
  ('band', 'cccccccc-0000-4000-8000-000000000001'),
  ('production', 'cccccccc-0000-4000-8000-000000000002'),
  ('bass', 'dddddddd-0000-4000-8000-000000000004'),
  ('jordan', '22222222-2222-4222-8222-222222222222'),
  ('sam', '33333333-3333-4333-8333-333333333333'),
  ('riley', '44444444-4444-4444-8444-444444444444'),
  ('morgan', '55555555-5555-4555-8555-555555555555'),
  ('plan', gen_random_uuid()), ('plan2', gen_random_uuid()), ('item', gen_random_uuid()), ('item2', gen_random_uuid()),
  ('song', gen_random_uuid()), ('arr', gen_random_uuid()),
  ('other_org', gen_random_uuid()), ('other_plan', gen_random_uuid()), ('other_team', gen_random_uuid()),
  ('other_pos', gen_random_uuid());
create or replace function pg_temp.fx(p text) returns uuid language sql stable as $$ select id from f13_fx where k = p $$;
create temporary table f13_v (k text primary key, id uuid, path text, rev bigint) on commit drop;
grant all on f13_v to authenticated, service_role;
create or replace function pg_temp.v(p text) returns uuid language sql stable as $$ select id from f13_v where k = p $$;
create or replace function pg_temp.p(p text) returns text language sql stable as $$ select path from f13_v where k = p $$;

-- Simulates the Storage upload of one object as the current caller.
create or replace function pg_temp.put(p_path text, p_size bigint, p_type text) returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
  values ('attachments', p_path, (select auth.uid()), (select auth.uid())::text,
          jsonb_build_object('size', p_size, 'mimetype', p_type));
$$;
create or replace function pg_temp.as_user(p text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', (select id::text from f13_fx where k = p), true);
  select set_config('request.jwt.claims', json_build_object('sub', (select id::text from f13_fx where k = p), 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.sees(p_file uuid) returns boolean language sql stable as $$
  select exists (select 1 from public.attachments where id = p_file);
$$;
create or replace function pg_temp.sees_version(p_version uuid) returns boolean language sql stable as $$
  select exists (select 1 from public.attachment_versions where id = p_version);
$$;
create or replace function pg_temp.sees_bytes(p_path text) returns boolean language sql stable as $$
  select exists (select 1 from storage.objects where bucket_id = 'attachments' and name = p_path);
$$;

insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by) values
  (pg_temp.fx('plan'), pg_temp.fx('org'), pg_temp.fx('st'), 'F13 Files', '2027-06-06 14:00+00', 'published', pg_temp.fx('jordan')),
  (pg_temp.fx('plan2'), pg_temp.fx('org'), null, 'F13 Other plan', '2027-06-13 14:00+00', 'published', pg_temp.fx('jordan'));
insert into public.plan_items (id, plan_id, item_type, title, sort_order) values
  (pg_temp.fx('item'), pg_temp.fx('plan'), 'item', 'Welcome', 0),
  (pg_temp.fx('item2'), pg_temp.fx('plan2'), 'item', 'Elsewhere', 0);
insert into public.songs (id, organization_id, title) values (pg_temp.fx('song'), pg_temp.fx('org'), 'F13 Song');
insert into public.arrangements (id, song_id, name) values (pg_temp.fx('arr'), pg_temp.fx('song'), 'F13 Arr');
-- Riley: released request on the plan (Production). Morgan: prepared only.
insert into public.assignments (plan_id, person_id, user_id, team_id, status, visibility, created_by)
select pg_temp.fx('plan'), pe.id, pe.profile_id, pg_temp.fx('production'), 'confirmed', 'released', pg_temp.fx('jordan')
  from public.people pe where pe.organization_id = pg_temp.fx('org') and pe.profile_id = pg_temp.fx('riley');
insert into public.assignments (plan_id, person_id, user_id, team_id, status, visibility, created_by)
select pg_temp.fx('plan'), pe.id, pe.profile_id, pg_temp.fx('band'), 'unconfirmed', 'prepared', pg_temp.fx('jordan')
  from public.people pe where pe.organization_id = pg_temp.fx('org') and pe.profile_id = pg_temp.fx('morgan');
-- Another organization.
insert into public.organizations (id, name, slug) values (pg_temp.fx('other_org'), 'F13 Other', 'f13-other-' || substr(md5(random()::text), 1, 6));
insert into public.plans (id, organization_id, title, service_date, status) values
  (pg_temp.fx('other_plan'), pg_temp.fx('other_org'), 'Elsewhere', '2027-06-06 14:00+00', 'published');
insert into public.teams (id, organization_id, name) values (pg_temp.fx('other_team'), pg_temp.fx('other_org'), 'Other band');
insert into public.team_positions (id, team_id, name) values (pg_temp.fx('other_pos'), pg_temp.fx('other_team'), 'Other bass');

set local role authenticated;

-- ======================================================= upload intent ====
select pg_temp.as_user('sam');
do $$ begin
  begin
    perform public.create_file_upload_intent('plan', pg_temp.fx('plan'), null, null, 'a.pdf', 'application/pdf', 10,
      null, 'chart', 'organization', '{}', '{}', 'k-sam-1');
    raise exception 'FAIL: member created an upload intent';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.attachments (organization_id, owner_kind, plan_id, title, filename)
    values (pg_temp.fx('org'), 'plan', pg_temp.fx('plan'), 'x', 'x');
    raise exception 'FAIL: direct insert allowed';
  exception when insufficient_privilege then null; end;
  -- Raw upload to a guessed path in the organization folder.
  begin
    perform pg_temp.put(pg_temp.fx('org')::text || '/guess/file.pdf', 10, 'application/pdf');
    raise exception 'FAIL: raw upload to a guessed path';
  exception when insufficient_privilege then null; end;
end $$;

select pg_temp.as_user('jordan');
do $$
declare r jsonb; r2 jsonb;
begin
  begin
    perform public.create_file_upload_intent('plan', pg_temp.fx('other_plan'), null, null, 'a.pdf', 'application/pdf', 10,
      null, 'chart', 'organization', '{}', '{}', 'k-foreign');
    raise exception 'FAIL: foreign parent accepted';
  exception when no_data_found then null; end;
  begin
    perform public.create_file_upload_intent('plan', pg_temp.fx('plan'), null, null, 'a.html', 'text/html', 10,
      null, 'chart', 'organization', '{}', '{}', 'k-html');
    raise exception 'FAIL: unsupported type accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.create_file_upload_intent('plan', pg_temp.fx('plan'), null, null, 'a.pdf', 'application/pdf', 26214401,
      null, 'chart', 'organization', '{}', '{}', 'k-big');
    raise exception 'FAIL: oversize accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.create_file_upload_intent('song', pg_temp.fx('song'), null, null, 'a.pdf', 'application/pdf', 10,
      null, 'chart', 'positions', '{}', array[pg_temp.fx('other_pos')], 'k-otherpos');
    raise exception 'FAIL: another organization''s position accepted';
  exception when no_data_found then null; end;
  begin
    perform public.create_file_upload_intent('song', pg_temp.fx('song'), null, null, 'a.pdf', 'application/pdf', 10,
      null, 'chart', 'scheduled', '{}', '{}', 'k-sched-song');
    raise exception 'FAIL: scheduled audience on a song file';
  exception when check_violation then null; end;

  -- Plan file, audience: scheduled.
  r := public.create_file_upload_intent('plan', pg_temp.fx('plan'), null, null, 'Run Sheet.pdf', 'application/pdf', 1234,
    'Run sheet', 'document', 'scheduled', '{}', '{}', 'k-sched');
  if r->'version'->>'status' <> 'pending' or (r->>'replayed')::boolean then raise exception 'FAIL: intent %', r; end if;
  if r->'version'->>'storage_path' <> pg_temp.fx('org')::text || '/' || (r->'attachment'->>'id') || '/' || (r->'version'->>'id') || '/run-sheet.pdf' then
    raise exception 'FAIL: path %', r->'version'->>'storage_path';
  end if;
  if (r->'version'->>'upload_expires_at')::timestamptz not between now() + interval '119 minutes' and now() + interval '121 minutes' then
    raise exception 'FAIL: intent expiry';
  end if;
  insert into f13_v values ('sched', (r->'version'->>'id')::uuid, r->'version'->>'storage_path', null),
                           ('sched_file', (r->'attachment'->>'id')::uuid, null, null);
  -- Replay: same key and bytes → same intent; same key, other bytes → refused.
  r2 := public.create_file_upload_intent('plan', pg_temp.fx('plan'), null, null, 'Run Sheet.pdf', 'application/pdf', 1234,
    'Run sheet', 'document', 'scheduled', '{}', '{}', 'k-sched');
  if not (r2->>'replayed')::boolean or r2->'version'->>'id' <> r->'version'->>'id' then raise exception 'FAIL: replay'; end if;
  begin
    perform public.create_file_upload_intent('plan', pg_temp.fx('plan'), null, null, 'Run Sheet.pdf', 'application/pdf', 99,
      null, 'document', 'scheduled', '{}', '{}', 'k-sched');
    raise exception 'FAIL: key reused for other bytes';
  exception when sqlstate 'PT409' then null; end;
  -- Same key and bytes for another parent is not a replay of this intent.
  begin
    perform public.create_file_upload_intent('plan', pg_temp.fx('plan2'), null, null, 'Run Sheet.pdf', 'application/pdf', 1234,
      'Run sheet', 'document', 'scheduled', '{}', '{}', 'k-sched');
    raise exception 'FAIL: key replayed for another parent';
  exception when sqlstate 'PT409' then null; end;
end $$;

-- Writer may upload only to the exact intent path; nobody else may.
do $$ begin
  begin
    perform pg_temp.put(pg_temp.fx('org')::text || '/' || pg_temp.v('sched_file')::text || '/other/x.pdf', 1234, 'application/pdf');
    raise exception 'FAIL: writer uploaded outside the intent path';
  exception when insufficient_privilege then null; end;
end $$;
select pg_temp.as_user('sam');
do $$ begin
  begin
    perform pg_temp.put(pg_temp.p('sched'), 1234, 'application/pdf');
    raise exception 'FAIL: another user used the intent path';
  exception when insufficient_privilege then null; end;
  begin
    perform public.finalize_file_version(pg_temp.v('sched'));
    raise exception 'FAIL: member finalized';
  exception when no_data_found then null; end;
  if pg_temp.sees(pg_temp.v('sched_file')) then raise exception 'FAIL: member sees a pending file'; end if;
end $$;

select pg_temp.as_user('jordan');
do $$
declare r jsonb;
begin
  r := public.finalize_file_version(pg_temp.v('sched'));
  if r->>'outcome' <> 'not_uploaded' then raise exception 'FAIL: finalize without bytes %', r->>'outcome'; end if;
  perform pg_temp.put(pg_temp.p('sched'), 1234, 'application/pdf');
  r := public.finalize_file_version(pg_temp.v('sched'));
  if r->>'outcome' <> 'ready' or (r->'version'->>'version_number')::int <> 1 or (r->'version'->>'size_bytes')::bigint <> 1234 then
    raise exception 'FAIL: finalize %', r;
  end if;
  if (r->'attachment'->>'current_version_id')::uuid <> pg_temp.v('sched') then raise exception 'FAIL: not current'; end if;
  r := public.finalize_file_version(pg_temp.v('sched'));
  if r->>'outcome' <> 'ready' or not (r->>'replayed')::boolean then raise exception 'FAIL: finalize not idempotent'; end if;
end $$;

-- =================================================== audience: scheduled ==
select pg_temp.as_user('riley');   -- released request on the plan
do $$ begin
  if not (pg_temp.sees(pg_temp.v('sched_file')) and pg_temp.sees_version(pg_temp.v('sched')) and pg_temp.sees_bytes(pg_temp.p('sched'))) then
    raise exception 'FAIL: scheduled person cannot read';
  end if;
end $$;
select pg_temp.as_user('morgan');  -- prepared request only
do $$ begin
  if pg_temp.sees(pg_temp.v('sched_file')) or pg_temp.sees_version(pg_temp.v('sched')) or pg_temp.sees_bytes(pg_temp.p('sched')) then
    raise exception 'FAIL: prepared request reads a scheduled-only file';
  end if;
  if exists (select 1 from public.attachment_audience_targets where attachment_id = pg_temp.v('sched_file')) then
    raise exception 'FAIL: targets leak';
  end if;
end $$;
select pg_temp.as_user('sam');     -- not scheduled
do $$ begin
  if pg_temp.sees(pg_temp.v('sched_file')) or pg_temp.sees_bytes(pg_temp.p('sched')) then
    raise exception 'FAIL: unscheduled member reads a scheduled-only file';
  end if;
  if exists (select 1 from public.writable_file_ids(array[pg_temp.v('sched_file')])) then
    raise exception 'FAIL: member reported as writer';
  end if;
end $$;

-- ================================================ teams/positions/leaders ==
select pg_temp.as_user('jordan');
do $$
declare r jsonb; v_rev bigint;
begin
  -- Same file, audience → Production team.
  select revision into v_rev from public.attachments where id = pg_temp.v('sched_file');
  perform public.update_file(pg_temp.v('sched_file'), v_rev, 'Run sheet', 'document', 'teams',
    array[pg_temp.fx('production')], '{}', null, null);
end $$;
select pg_temp.as_user('riley');
do $$ begin if not pg_temp.sees_bytes(pg_temp.p('sched')) then raise exception 'FAIL: team member cannot read'; end if; end $$;
select pg_temp.as_user('sam');
do $$ begin if pg_temp.sees_bytes(pg_temp.p('sched')) then raise exception 'FAIL: non-team member reads'; end if; end $$;

select pg_temp.as_user('jordan');
do $$
declare v_rev bigint;
begin
  select revision into v_rev from public.attachments where id = pg_temp.v('sched_file');
  perform public.update_file(pg_temp.v('sched_file'), v_rev, 'Run sheet', 'document', 'positions',
    '{}', array[pg_temp.fx('bass')], null, null);
end $$;
select pg_temp.as_user('sam');     -- holds Bass
do $$ begin if not pg_temp.sees_bytes(pg_temp.p('sched')) then raise exception 'FAIL: position holder cannot read'; end if; end $$;
select pg_temp.as_user('riley');   -- drums, not bass
do $$ begin if pg_temp.sees_bytes(pg_temp.p('sched')) then raise exception 'FAIL: other position reads'; end if; end $$;

select pg_temp.as_user('jordan');
do $$
declare v_rev bigint;
begin
  select revision into v_rev from public.attachments where id = pg_temp.v('sched_file');
  perform public.update_file(pg_temp.v('sched_file'), v_rev, 'Run sheet', 'document', 'leaders', '{}', '{}', null, null);
  -- Stale revision is refused.
  begin
    perform public.update_file(pg_temp.v('sched_file'), v_rev, 'Again', 'document', 'organization', '{}', '{}', null, null);
    raise exception 'FAIL: stale metadata edit';
  exception when sqlstate 'PT409' then null; end;
end $$;
select pg_temp.as_user('sam');
do $$ begin if pg_temp.sees(pg_temp.v('sched_file')) then raise exception 'FAIL: member reads a leaders file'; end if; end $$;

-- ==================================================== moves (bounded) =====
select pg_temp.as_user('jordan');
do $$
declare v_rev bigint;
begin
  select revision into v_rev from public.attachments where id = pg_temp.v('sched_file');
  begin
    perform public.update_file(pg_temp.v('sched_file'), v_rev, 'Run sheet', 'document', 'leaders', '{}', '{}', 'plan_item', pg_temp.fx('item2'));
    raise exception 'FAIL: moved to another plan';
  exception when invalid_parameter_value then null; end;
  perform public.update_file(pg_temp.v('sched_file'), v_rev, 'Run sheet', 'document', 'leaders', '{}', '{}', 'plan_item', pg_temp.fx('item'));
  if (select owner_kind from public.attachments where id = pg_temp.v('sched_file')) <> 'plan_item' then
    raise exception 'FAIL: move within the plan';
  end if;
end $$;

-- ============================================ replace: race, mismatch ======
do $$
declare a jsonb; b jsonb; c jsonb; r jsonb; v_rev bigint;
begin
  -- A song file everyone may read.
  r := public.create_file_upload_intent('song', pg_temp.fx('song'), null, null, 'Chart.pdf', 'application/pdf', 100,
    'Lead sheet', 'chart', 'organization', '{}', '{}', 'k-song-1');
  insert into f13_v values ('s1', (r->'version'->>'id')::uuid, r->'version'->>'storage_path', null),
                           ('song_file', (r->'attachment'->>'id')::uuid, null, null);
  perform pg_temp.put(r->'version'->>'storage_path', 100, 'application/pdf');
  r := public.finalize_file_version(pg_temp.v('s1'));
  v_rev := (r->'attachment'->>'revision')::bigint;

  -- Two replacements requested against v1; the second to finalize is superseded.
  a := public.create_file_upload_intent('song', pg_temp.fx('song'), pg_temp.v('song_file'), v_rev, 'Chart v2.pdf', 'application/pdf', 200,
    null, 'chart', 'organization', '{}', '{}', 'k-song-a');
  b := public.create_file_upload_intent('song', pg_temp.fx('song'), pg_temp.v('song_file'), v_rev, 'Chart v2b.pdf', 'application/pdf', 300,
    null, 'chart', 'organization', '{}', '{}', 'k-song-b');
  insert into f13_v values ('s2', (a->'version'->>'id')::uuid, a->'version'->>'storage_path', null),
                           ('s2b', (b->'version'->>'id')::uuid, b->'version'->>'storage_path', null);
  perform pg_temp.put(a->'version'->>'storage_path', 200, 'application/pdf');
  perform pg_temp.put(b->'version'->>'storage_path', 300, 'application/pdf');
  r := public.finalize_file_version(pg_temp.v('s2'));
  if r->>'outcome' <> 'ready' or (r->'version'->>'version_number')::int <> 2 then raise exception 'FAIL: replacement %', r; end if;
  r := public.finalize_file_version(pg_temp.v('s2b'));
  if r->>'outcome' <> 'failed' or r->>'reason' <> 'superseded' then raise exception 'FAIL: race not refused %', r; end if;
  -- A stale replacement intent is refused up front.
  begin
    perform public.create_file_upload_intent('song', pg_temp.fx('song'), pg_temp.v('song_file'), v_rev, 'x.pdf', 'application/pdf', 5,
      null, 'chart', 'organization', '{}', '{}', 'k-song-stale');
    raise exception 'FAIL: stale replacement intent';
  exception when sqlstate 'PT409' then null; end;

  -- Stored bytes that differ from the intent never become a version.
  select revision into v_rev from public.attachments where id = pg_temp.v('song_file');
  c := public.create_file_upload_intent('song', pg_temp.fx('song'), pg_temp.v('song_file'), v_rev, 'Chart v3.pdf', 'application/pdf', 400,
    null, 'chart', 'organization', '{}', '{}', 'k-song-c');
  insert into f13_v values ('s3', (c->'version'->>'id')::uuid, c->'version'->>'storage_path', null);
  perform pg_temp.put(c->'version'->>'storage_path', 401, 'application/pdf');
  r := public.finalize_file_version(pg_temp.v('s3'));
  if r->>'outcome' <> 'failed' or r->>'reason' <> 'size_mismatch' then raise exception 'FAIL: size mismatch %', r; end if;
  if (select current_version_id from public.attachments where id = pg_temp.v('song_file')) <> pg_temp.v('s2') then
    raise exception 'FAIL: mismatch changed the current version';
  end if;
  -- Version rows are immutable.
  begin
    update public.attachment_versions set filename = 'x' where id = pg_temp.v('s2');
    raise exception 'FAIL: version updated';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
do $$ begin
  if (select count(*) from public.attachment_object_removals where object_path in (pg_temp.p('s2b'), pg_temp.p('s3'))) <> 2 then
    raise exception 'FAIL: failed uploads not queued for removal';
  end if;
  begin
    update public.attachment_versions set filename = 'x' where id = pg_temp.v('s2');
    raise exception 'FAIL: owner rewrote a ready version';
  exception when sqlstate 'PT409' then null; end;
end $$;
set local role authenticated;

-- Readers: current version only; old v1 and failed uploads are writer-only.
select pg_temp.as_user('sam');
do $$ begin
  if not pg_temp.sees_bytes(pg_temp.p('s2')) then raise exception 'FAIL: reader cannot read current'; end if;
  if pg_temp.sees_bytes(pg_temp.p('s1')) or pg_temp.sees_version(pg_temp.v('s1')) then raise exception 'FAIL: reader reads an unpinned old version'; end if;
  if pg_temp.sees_bytes(pg_temp.p('s2b')) or pg_temp.sees_bytes(pg_temp.p('s3')) then raise exception 'FAIL: reader reads failed uploads'; end if;
end $$;

-- ======================================= links, pins, archive, delete ======
select pg_temp.as_user('jordan');
do $$
declare l public.attachment_links; v_rev bigint;
begin
  begin
    perform public.link_file_to_plan(pg_temp.fx('plan'), null, pg_temp.v('sched_file'), true);
    raise exception 'FAIL: plan file reused on a plan';
  exception when invalid_parameter_value then null; end;
  -- Pin v1 explicitly on the plan (historical preparation).
  l := public.link_file_to_plan(pg_temp.fx('plan'), null, pg_temp.v('song_file'), true);
  l := public.set_file_link_pin(l.id, pg_temp.v('s1'), false);
  insert into f13_v values ('link', l.id, null, null);
  if l.pinned_version_id <> pg_temp.v('s1') then raise exception 'FAIL: pin'; end if;
  begin
    perform public.set_file_link_pin(l.id, pg_temp.v('s3'), false);
    raise exception 'FAIL: pinned a failed version';
  exception when no_data_found then null; end;
end $$;
select pg_temp.as_user('sam');
do $$ begin
  if not (pg_temp.sees_bytes(pg_temp.p('s1')) and pg_temp.sees_bytes(pg_temp.p('s2'))) then
    raise exception 'FAIL: pinned v1 and current v2 should both be readable';
  end if;
  begin
    perform public.unlink_file(pg_temp.v('link'));
    raise exception 'FAIL: member unlinked';
  exception when insufficient_privilege then null; end;
end $$;

select pg_temp.as_user('jordan');
do $$
declare v_rev bigint;
begin
  select revision into v_rev from public.attachments where id = pg_temp.v('song_file');
  perform public.set_file_archived(pg_temp.v('song_file'), v_rev, true);
  begin
    perform public.delete_file(pg_temp.v('song_file'), v_rev + 1);
    raise exception 'FAIL: deleted a linked file';
  exception when sqlstate 'PT409' then
    if sqlerrm not like '%Archive it instead%' then raise; end if;
  end;
end $$;
-- Archived: the pin still serves v1; the current version is no longer offered.
select pg_temp.as_user('sam');
do $$ begin
  if not pg_temp.sees_bytes(pg_temp.p('s1')) then raise exception 'FAIL: pin lost on archive'; end if;
  if pg_temp.sees_bytes(pg_temp.p('s2')) then raise exception 'FAIL: archived current still offered'; end if;
end $$;

select pg_temp.as_user('jordan');
do $$
declare v_rev bigint;
begin
  perform public.unlink_file(pg_temp.v('link'));
  if not exists (select 1 from public.attachments where id = pg_temp.v('song_file')) then
    raise exception 'FAIL: unlink deleted the source';
  end if;
  select revision into v_rev from public.attachments where id = pg_temp.v('song_file');
  perform public.delete_file(pg_temp.v('song_file'), v_rev);
end $$;
reset role;
do $$ begin
  if (select count(*) from public.attachment_object_removals where object_path in (pg_temp.p('s1'), pg_temp.p('s2'))) <> 2 then
    raise exception 'FAIL: deleted versions not queued for removal';
  end if;
end $$;
set local role authenticated;

-- ======================================== expiry, abandon, deleted owner ===
select pg_temp.as_user('jordan');
do $$
declare r jsonb;
begin
  r := public.create_file_upload_intent('arrangement', pg_temp.fx('arr'), null, null, 'Track.mp3', 'audio/mpeg', 50,
    null, 'audio', 'organization', '{}', '{}', 'k-exp');
  insert into f13_v values ('exp', (r->'version'->>'id')::uuid, r->'version'->>'storage_path', null),
                           ('exp_file', (r->'attachment'->>'id')::uuid, null, null);
  r := public.create_file_upload_intent('plan', pg_temp.fx('plan'), null, null, 'Gone.pdf', 'application/pdf', 50,
    null, 'other', 'organization', '{}', '{}', 'k-abandon');
  insert into f13_v values ('ab', (r->'version'->>'id')::uuid, r->'version'->>'storage_path', null),
                           ('ab_file', (r->'attachment'->>'id')::uuid, null, null);
  r := public.abandon_file_version(pg_temp.v('ab'));
  if not (r->>'attachment_removed')::boolean then raise exception 'FAIL: abandoned new file kept'; end if;
end $$;
reset role;
update public.attachment_versions set upload_expires_at = now() - interval '1 second' where id = pg_temp.v('exp');
set local role authenticated;
select pg_temp.as_user('jordan');
do $$
declare r jsonb;
begin
  begin
    perform pg_temp.put(pg_temp.p('exp'), 50, 'audio/mpeg');
    raise exception 'FAIL: upload to an expired intent';
  exception when insufficient_privilege then null; end;
  r := public.finalize_file_version(pg_temp.v('exp'));
  if r->>'outcome' <> 'expired' then raise exception 'FAIL: expired finalize %', r; end if;
  begin
    perform public.expire_file_uploads(10);
    raise exception 'FAIL: member ran maintenance';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ declare n int; begin
  n := public.expire_file_uploads(100);
  if exists (select 1 from public.attachments where id = pg_temp.v('exp_file')) then
    raise exception 'FAIL: new file with only an expired upload kept';
  end if;
end $$;
set local role authenticated;

-- Deleting the owner removes the file and queues its bytes.
select pg_temp.as_user('jordan');
do $$
declare r jsonb;
begin
  r := public.create_file_upload_intent('plan_item', pg_temp.fx('item'), null, null, 'Item.pdf', 'application/pdf', 70,
    null, 'other', 'organization', '{}', '{}', 'k-item');
  insert into f13_v values ('item_v', (r->'version'->>'id')::uuid, r->'version'->>'storage_path', null),
                           ('item_file', (r->'attachment'->>'id')::uuid, null, null);
  perform pg_temp.put(r->'version'->>'storage_path', 70, 'application/pdf');
  perform public.finalize_file_version(pg_temp.v('item_v'));
  delete from public.plan_items where id = pg_temp.fx('item');
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.attachments where id = pg_temp.v('item_file')) then raise exception 'FAIL: owner deletion kept file'; end if;
  if not exists (select 1 from public.attachment_object_removals where object_path = pg_temp.p('item_v')) then
    raise exception 'FAIL: owner deletion did not queue bytes';
  end if;
  if exists (select 1 from storage.objects where name = pg_temp.p('item_v')) is false then
    raise exception 'FAIL: test fixture missing';
  end if;
end $$;
set local role authenticated;

-- ==================================== documents, links, defaults ==========
select pg_temp.as_user('jordan');
do $$
declare r jsonb; v_rev bigint; v1 uuid; v_new_plan uuid := gen_random_uuid();
begin
  begin
    perform public.save_file_content('service_type', pg_temp.fx('st'), null, null, 'link', 'Bad', 'javascript:alert(1)', null,
      'other', 'organization', '{}', '{}', 'k-bad-link');
    raise exception 'FAIL: javascript: link accepted';
  exception when check_violation then null; end;
  r := public.save_file_content('service_type', pg_temp.fx('st'), null, null, 'link', 'Rehearsal video',
    'https://example.com/watch?v=1', null, 'video', 'organization', '{}', '{}', 'k-link');
  if not (public.save_file_content('service_type', pg_temp.fx('st'), null, null, 'link', 'Rehearsal video',
    'https://example.com/watch?v=1', null, 'video', 'organization', '{}', '{}', 'k-link') ->> 'replayed')::boolean then
    raise exception 'FAIL: link create not idempotent';
  end if;

  -- A default text document for the service type.
  r := public.save_file_content('service_type', pg_temp.fx('st'), null, null, 'document', 'Stage notes', null,
    '# Notes' || chr(10) || '<b>escaped later</b>', 'document', 'teams', array[pg_temp.fx('band')], '{}', 'k-doc');
  insert into f13_v values ('doc_file', (r->'attachment'->>'id')::uuid, null, (r->'attachment'->>'revision')::bigint);
  v1 := (r->'attachment'->>'current_version_id')::uuid;
  insert into f13_v values ('doc_v1', v1, null, null);

  -- A plan created now links the default, pinned to v1.
  insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by)
  values (v_new_plan, pg_temp.fx('org'), pg_temp.fx('st'), 'F13 Default links', '2027-07-04 14:00+00', 'draft', pg_temp.fx('jordan'));
  insert into f13_fx values ('plan_default', v_new_plan);
  if not exists (select 1 from public.attachment_links where plan_id = v_new_plan and attachment_id = pg_temp.v('doc_file')
                  and pinned_version_id = v1 and source = 'service_type_default') then
    raise exception 'FAIL: default not linked to the new plan';
  end if;

  -- New text → v2. The existing plan keeps v1; a newer plan gets v2.
  select revision into v_rev from public.attachments where id = pg_temp.v('doc_file');
  r := public.save_file_content(null, null, pg_temp.v('doc_file'), v_rev, 'document', 'Stage notes', null,
    '# Notes v2', 'document', 'teams', '{}', '{}', null);
  if (select version_number from public.attachment_versions v join public.attachments a on a.current_version_id = v.id
       where a.id = pg_temp.v('doc_file')) <> 2 then raise exception 'FAIL: document version 2'; end if;
  if (select pinned_version_id from public.attachment_links where plan_id = v_new_plan and attachment_id = pg_temp.v('doc_file')) <> v1 then
    raise exception 'FAIL: changing a default rewrote an existing plan';
  end if;
  insert into public.plans (organization_id, service_type_id, title, service_date, status, created_by)
  values (pg_temp.fx('org'), pg_temp.fx('st'), 'F13 Later', '2027-07-11 14:00+00', 'draft', pg_temp.fx('jordan'));
  if not exists (select 1 from public.attachment_links l join public.attachments a on a.id = l.attachment_id
                  join public.plans p on p.id = l.plan_id
                  where p.title = 'F13 Later' and l.pinned_version_id = a.current_version_id and a.id = pg_temp.v('doc_file')) then
    raise exception 'FAIL: later plan did not get the current default';
  end if;
end $$;

-- Team audience applies to the default file and its pinned text, not widened by the link.
select pg_temp.as_user('sam');    -- Worship Band
do $$ begin
  if not pg_temp.sees_version(pg_temp.v('doc_v1')) then raise exception 'FAIL: band member cannot read pinned doc'; end if;
  if (select document_body from public.attachment_versions where id = pg_temp.v('doc_v1')) not like '%<b>escaped later</b>%' then
    raise exception 'FAIL: document text';
  end if;
end $$;
select pg_temp.as_user('riley');  -- Worship Band (drums) too
do $$ begin if not pg_temp.sees(pg_temp.v('doc_file')) then raise exception 'FAIL: band member (riley)'; end if; end $$;

-- ===================================================== revoked member ======
reset role;
update public.organization_members set status = 'inactive'
 where organization_id = pg_temp.fx('org') and user_id = pg_temp.fx('sam');
set local role authenticated;
select pg_temp.as_user('sam');
do $$ begin
  if pg_temp.sees(pg_temp.v('doc_file')) or pg_temp.sees_version(pg_temp.v('doc_v1')) then
    raise exception 'FAIL: deactivated member still reads';
  end if;
end $$;

reset role;
select 'f13-files: all checks passed' as result;
rollback;
