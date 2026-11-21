-- QA wave 8 review fixes (20261127000800_w8_review_fixes). Everything rolls back.
--   A. A person-level loss (archive, unlink, child, delete) rotates the conversations the account
--      reached ONLY through capabilities (team manager grant, plan leader grant), leaves the
--      conversations it never reached alone, and does not rotate the organization key.
--   B. Moving a team membership (UPDATE of team_id / person_id) rotates the old team's
--      conversation when the old person lost it, and not when they still reach it.
--   C. team_roster_people leaves out archived people, hides children's email / phone /
--      birthdate, and returns one row per (team_id, person_id) in that order.
--   D. Song checks count UTF-16 code units and trim like JavaScript (emoji over the limit and
--      whitespace-only titles are refused); themes, song_types and default_key are checked.
--   E. private.claim_plan_copy_key has its original ACL again.
--   F. update_plan_with_times assigns only the sent columns (a title-only call fires no
--      `UPDATE OF` trigger on other columns).
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/qa-wave8-review-fixes.sql
begin;

create temporary table rf_fx (k text primary key, id uuid) on commit drop;
grant select on rf_fx to authenticated, anon;
insert into rf_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('sunday', 'bbbbbbbb-0000-4000-8000-000000000001'),
  ('midweek', 'bbbbbbbb-0000-4000-8000-000000000002'),
  ('band', 'cccccccc-0000-4000-8000-000000000001'),
  ('prod', 'cccccccc-0000-4000-8000-000000000002'),
  ('hospitality', 'cccccccc-0000-4000-8000-000000000003'),
  ('owner', '11111111-1111-4111-8111-111111111111'),
  ('jordan', '22222222-2222-4222-8222-222222222222'),
  ('sam', '33333333-3333-4333-8333-333333333333'),
  ('riley', '44444444-4444-4444-8444-444444444444'),
  ('morgan', '55555555-5555-4555-8555-555555555555'),
  ('band_chat', gen_random_uuid()), ('prod_chat', gen_random_uuid()),
  ('lead_plan', gen_random_uuid()), ('control_plan', gen_random_uuid()),
  ('morgan_q', gen_random_uuid()),
  ('roster_archived', gen_random_uuid()), ('roster_child', gen_random_uuid()), ('roster_adult', gen_random_uuid()),
  ('song', gen_random_uuid());

create function pg_temp.id_for(p text) returns uuid language sql stable as $$ select id from rf_fx where k = p $$;
grant execute on function pg_temp.id_for(text) to authenticated;
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'W8 review fix check failed: %', label; end if;
end $$;
grant execute on function pg_temp.check(boolean, text) to authenticated;
create function pg_temp.person_of(p_user uuid) returns uuid language sql stable as $$
  select id from public.people where organization_id = pg_temp.id_for('org') and profile_id = p_user $$;
create function pg_temp.org_key() returns text language sql stable security definer as $$
  select key from private.org_realtime_keys where organization_id = pg_temp.id_for('org') $$;
create function pg_temp.conv_key(p_conv uuid) returns text language sql stable security definer as $$
  select key from private.conversation_realtime_keys where conversation_id = p_conv $$;
-- The topic the API would hand this user (null when they hold no access).
create function pg_temp.topic_for(p_user uuid, p_id uuid) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  select t.topic into v from public.realtime_resource_topics(pg_temp.id_for('org'), 'conversation', array[p_id]) t;
  perform set_config('request.jwt.claim.sub', '', true);
  return v;
end $$;
-- Production rotates at most once per transaction; let the test rotate repeatedly.
create function pg_temp.reset_rotation() returns void language sql security definer as $$
  update private.conversation_realtime_keys set rotated_at = rotated_at - interval '1 minute';
  update private.org_realtime_keys set rotated_at = rotated_at - interval '1 minute' $$;

-- ---------------------------------------------------------------- fixtures ---
delete from public.conversations where team_id in (pg_temp.id_for('band'), pg_temp.id_for('prod'));
insert into public.conversations (id, organization_id, kind, team_id) values
  (pg_temp.id_for('band_chat'), pg_temp.id_for('org'), 'team', pg_temp.id_for('band')),
  (pg_temp.id_for('prod_chat'), pg_temp.id_for('org'), 'team', pg_temp.id_for('prod'));
insert into public.plans (id, organization_id, service_type_id, title, service_date, status) values
  (pg_temp.id_for('lead_plan'), pg_temp.id_for('org'), pg_temp.id_for('sunday'), 'Review lead plan', now(), 'published'),
  (pg_temp.id_for('control_plan'), pg_temp.id_for('org'), pg_temp.id_for('midweek'), 'Review control plan', now(), 'published');
insert into public.conversations (organization_id, kind, plan_id)
  select pg_temp.id_for('org'), 'plan', p from unnest(array[pg_temp.id_for('lead_plan'), pg_temp.id_for('control_plan')]) p
  on conflict do nothing;
create temporary table rf_chat on commit drop as
  select 'band_chat' as k, pg_temp.id_for('band_chat') as id
  union all select 'prod_chat', pg_temp.id_for('prod_chat')
  union all select 'lead_chat', c.id from public.conversations c where c.plan_id = pg_temp.id_for('lead_plan')
  union all select 'control_chat', c.id from public.conversations c where c.plan_id = pg_temp.id_for('control_plan');
create function pg_temp.chat(p text) returns uuid language sql stable as $$ select id from rf_chat where k = p $$;
create temporary table rf_keys (k text primary key, key text) on commit drop;
-- Remember the current key of every fixture conversation.
create function pg_temp.snapshot() returns void language sql as $$
  delete from rf_keys;
  insert into rf_keys
  select c, pg_temp.conv_key(pg_temp.chat(c)) from unnest(array['band_chat', 'prod_chat', 'lead_chat', 'control_chat']) c
  union all select 'org', pg_temp.org_key() $$;
create function pg_temp.rotated(p text) returns boolean language sql stable as $$
  select (select key from rf_keys where k = p) is distinct from
         case when p = 'org' then pg_temp.org_key() else pg_temp.conv_key(pg_temp.chat(p)) end $$;

-- Morgan (a plain member) reaches the band chat only as its team manager, and the Sunday plan chat
-- only as a Sunday plan leader: no roster row, no assignment.
delete from public.team_memberships where person_id = pg_temp.person_of(pg_temp.id_for('morgan'));
insert into public.access_grants (organization_id, user_id, capability, scope_type, team_id, service_type_id, created_by) values
  (pg_temp.id_for('org'), pg_temp.id_for('morgan'), 'teams.manage', 'team', pg_temp.id_for('band'), null, pg_temp.id_for('owner')),
  (pg_temp.id_for('org'), pg_temp.id_for('morgan'), 'plans.edit', 'service_type', null, pg_temp.id_for('sunday'), pg_temp.id_for('owner'));

-- Every fixture conversation has a key row (issued through the API path to someone who may use it).
select pg_temp.check(pg_temp.topic_for(pg_temp.id_for('riley'), pg_temp.chat('prod_chat')) is not null, 'riley is issued the production chat');
select pg_temp.check(pg_temp.topic_for(pg_temp.id_for('jordan'), pg_temp.chat('control_chat')) is not null, 'the scheduler is issued the control plan chat');
select pg_temp.check(pg_temp.topic_for(pg_temp.id_for('morgan'), pg_temp.chat('prod_chat')) is null, 'morgan does not reach production');
select pg_temp.check(pg_temp.topic_for(pg_temp.id_for('morgan'), pg_temp.chat('control_chat')) is null, 'morgan does not lead midweek plans');

-- Issue morgan's two capability-only topics, then make the next loss rotate.
create function pg_temp.issue_morgan() returns void language plpgsql as $$
begin
  perform pg_temp.check(pg_temp.topic_for(pg_temp.id_for('morgan'), pg_temp.chat('band_chat')) is not null, 'team manager is issued the team chat');
  perform pg_temp.check(pg_temp.topic_for(pg_temp.id_for('morgan'), pg_temp.chat('lead_chat')) is not null, 'plan leader is issued the plan chat');
  perform pg_temp.reset_rotation();
  perform pg_temp.snapshot();
end $$;
create function pg_temp.expect_morgan_cut(p_label text) returns void language plpgsql as $$
begin
  perform pg_temp.check(pg_temp.rotated('band_chat'), p_label || ': team chat reached as manager rotates');
  perform pg_temp.check(pg_temp.rotated('lead_chat'), p_label || ': plan chat reached as leader rotates');
  perform pg_temp.check(not pg_temp.rotated('prod_chat'), p_label || ': a team chat never reached is not rotated');
  perform pg_temp.check(not pg_temp.rotated('control_chat'), p_label || ': a plan chat never reached is not rotated');
  perform pg_temp.check(not pg_temp.rotated('org'), p_label || ': the organization key is not rotated');
  perform pg_temp.check(pg_temp.topic_for(pg_temp.id_for('morgan'), pg_temp.chat('band_chat')) is null, p_label || ': team chat topic refused');
  perform pg_temp.check(pg_temp.topic_for(pg_temp.id_for('morgan'), pg_temp.chat('lead_chat')) is null, p_label || ': plan chat topic refused');
end $$;

-- ===================================================================== A ===
-- Archive.
select pg_temp.issue_morgan();
create temporary table rf_old_topic on commit drop as
  select 'conversation:' || pg_temp.chat('band_chat') || ':' || pg_temp.org_key() || ':' || (select key from rf_keys where k = 'band_chat') as topic;
update public.people set archived_at = now(), archived_by = pg_temp.id_for('owner')
 where id = pg_temp.person_of(pg_temp.id_for('morgan'));
select pg_temp.expect_morgan_cut('archive');
select pg_temp.check((select count(*) = 1 from realtime.messages
  where topic = (select topic from rf_old_topic) and (payload - 'id') = jsonb_build_object('event', 'rekey')),
  'archive: one rekey poke on the old team chat topic');

-- Unarchiving gains access and rotates nothing.
select pg_temp.reset_rotation();
select pg_temp.snapshot();
update public.people set archived_at = null, archived_by = null
 where organization_id = pg_temp.id_for('org') and profile_id = pg_temp.id_for('morgan');
select pg_temp.check(not pg_temp.rotated('band_chat') and not pg_temp.rotated('lead_chat'), 'unarchiving does not rotate');

-- Unlink.
select pg_temp.issue_morgan();
create temporary table rf_morgan_p on commit drop as select pg_temp.person_of(pg_temp.id_for('morgan')) as id;
update public.people set profile_id = null where id = (select id from rf_morgan_p);
select pg_temp.expect_morgan_cut('unlink');

-- Marked a child.
update public.people set profile_id = pg_temp.id_for('morgan') where id = (select id from rf_morgan_p);
select pg_temp.issue_morgan();
update public.people set person_type = 'child' where id = (select id from rf_morgan_p);
select pg_temp.expect_morgan_cut('child');

-- Deleted (a fresh linked row with no assignments, so the delete is allowed).
update public.people set person_type = 'adult', profile_id = null where id = (select id from rf_morgan_p);
insert into public.people (id, organization_id, first_name, last_name, profile_id)
  values (pg_temp.id_for('morgan_q'), pg_temp.id_for('org'), 'Morgan', 'Again', pg_temp.id_for('morgan'));
select pg_temp.issue_morgan();
delete from public.people where id = pg_temp.id_for('morgan_q');
select pg_temp.expect_morgan_cut('delete');

-- An already-archived row going away loses nothing: no rotation.
insert into public.people (id, organization_id, first_name, last_name, profile_id)
  values (pg_temp.id_for('morgan_q'), pg_temp.id_for('org'), 'Morgan', 'Again', pg_temp.id_for('morgan'));
select pg_temp.issue_morgan();
update public.people set archived_at = now(), archived_by = pg_temp.id_for('owner') where id = pg_temp.id_for('morgan_q');
select pg_temp.reset_rotation();
select pg_temp.snapshot();
delete from public.people where id = pg_temp.id_for('morgan_q');
select pg_temp.check(not pg_temp.rotated('band_chat') and not pg_temp.rotated('lead_chat'),
  'deleting an archived row (no access to lose) does not rotate');

-- ===================================================================== B ===
-- Sam holds two band positions; Riley one. Issue the band chat to both.
select pg_temp.check(pg_temp.topic_for(pg_temp.id_for('sam'), pg_temp.chat('band_chat')) is not null, 'sam is issued the band chat');
select pg_temp.reset_rotation();
select pg_temp.snapshot();
-- Moving one of Sam's two band rows to another team: Sam still reaches the band chat.
update public.team_memberships set team_id = pg_temp.id_for('prod'), position_id = null
 where person_id = pg_temp.person_of(pg_temp.id_for('sam')) and position_id = 'dddddddd-0000-4000-8000-000000000003';
select pg_temp.check(not pg_temp.rotated('band_chat'), 'moving a row while another keeps access does not rotate');
select pg_temp.check(pg_temp.topic_for(pg_temp.id_for('sam'), pg_temp.chat('band_chat')) is not null, 'sam still reaches the band chat');

-- Handing Sam's last band row to another person (person_id change): Sam loses the band chat.
select pg_temp.reset_rotation();
select pg_temp.snapshot();
update public.team_memberships set person_id = pg_temp.person_of(pg_temp.id_for('riley')), user_id = null
 where person_id = pg_temp.person_of(pg_temp.id_for('sam')) and position_id = 'dddddddd-0000-4000-8000-000000000004';
select pg_temp.check(pg_temp.rotated('band_chat'), 'reassigning a membership row to another person rotates the old team chat');
select pg_temp.check(not pg_temp.rotated('prod_chat') and not pg_temp.rotated('org'), 'only the old team chat rotates');
select pg_temp.check(pg_temp.topic_for(pg_temp.id_for('sam'), pg_temp.chat('band_chat')) is null, 'sam is refused the band chat');

-- Moving all of Riley's band rows to another team (team_id change): Riley loses the band chat.
select pg_temp.check(pg_temp.topic_for(pg_temp.id_for('riley'), pg_temp.chat('band_chat')) is not null, 'riley is issued the band chat');
select pg_temp.reset_rotation();
select pg_temp.snapshot();
update public.team_memberships set team_id = pg_temp.id_for('hospitality'), position_id = null
 where person_id = pg_temp.person_of(pg_temp.id_for('riley')) and position_id = 'dddddddd-0000-4000-8000-000000000005';
select pg_temp.check(not pg_temp.rotated('band_chat'), 'riley still holds the reassigned position row, so no rotation yet');
update public.team_memberships set team_id = pg_temp.id_for('hospitality'), position_id = 'dddddddd-0000-4000-8000-00000000000a'
 where person_id = pg_temp.person_of(pg_temp.id_for('riley')) and team_id = pg_temp.id_for('band');
select pg_temp.check(pg_temp.rotated('band_chat'), 'moving the last membership row to another team rotates the old team chat');
select pg_temp.check(pg_temp.topic_for(pg_temp.id_for('riley'), pg_temp.chat('band_chat')) is null, 'riley is refused the band chat');

-- Moving a row of someone who still reaches the team another way (the owner) does not rotate.
select pg_temp.reset_rotation();
select pg_temp.snapshot();
update public.team_memberships set team_id = pg_temp.id_for('hospitality'), position_id = null
 where person_id = pg_temp.person_of(pg_temp.id_for('owner')) and position_id = 'dddddddd-0000-4000-8000-000000000001';
select pg_temp.check(not pg_temp.rotated('band_chat'), 'a person who still manages the team keeps the key unrotated');

-- ===================================================================== C ===
insert into public.people (id, organization_id, first_name, last_name, email, phone, birthdate, person_type) values
  (pg_temp.id_for('roster_archived'), pg_temp.id_for('org'), 'Gone', 'Person', 'gone@example.test', '+1 555 0101', '1980-01-01', 'adult'),
  (pg_temp.id_for('roster_child'), pg_temp.id_for('org'), 'Little', 'One', 'kid@example.test', '+1 555 0102', '2018-06-07', 'child'),
  (pg_temp.id_for('roster_adult'), pg_temp.id_for('org'), 'Grown', 'Up', 'adult@example.test', '+1 555 0103', '1985-02-03', 'adult');
-- The person is rostered first and archived afterwards (an archived person cannot be added).
insert into public.team_memberships (team_id, person_id, position_id) values
  (pg_temp.id_for('hospitality'), pg_temp.id_for('roster_archived'), null),
  (pg_temp.id_for('hospitality'), pg_temp.id_for('roster_child'), null),
  (pg_temp.id_for('hospitality'), pg_temp.id_for('roster_adult'), null),
  (pg_temp.id_for('hospitality'), pg_temp.id_for('roster_adult'), 'dddddddd-0000-4000-8000-00000000000a');
update public.people set archived_at = now(), archived_by = pg_temp.id_for('owner') where id = pg_temp.id_for('roster_archived');

set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
create temporary table rf_roster on commit drop as
  select * from public.team_roster_people(pg_temp.id_for('org'))
    with ordinality as r(team_id, person_id, first_name, last_name, avatar_url, email, phone, birthdate, n);
select pg_temp.check(not exists (select 1 from rf_roster where person_id = pg_temp.id_for('roster_archived')),
  'an archived person is not on the roster');
select pg_temp.check(exists (select 1 from rf_roster where person_id = pg_temp.id_for('roster_child')
                                and first_name = 'Little' and last_name = 'One'
                                and email is null and phone is null and birthdate is null),
  'a child shows name only: no email, phone or birthdate');
select pg_temp.check(exists (select 1 from rf_roster where person_id = pg_temp.id_for('roster_adult')
                                and email = 'adult@example.test' and phone = '+1 555 0103' and birthdate = '1985-02-03'),
  'an adult teammate still shows email, phone and birthdate');
select pg_temp.check((select count(*) from rf_roster where person_id = pg_temp.id_for('roster_adult')) = 1,
  'a person with two positions on a team is one row');
select pg_temp.check((select count(*) = count(distinct (team_id, person_id)) from rf_roster), '(team_id, person_id) is unique');
select pg_temp.check(not exists (
  select 1 from (select n, row_number() over (order by team_id, person_id) as k from rf_roster) s where s.n <> s.k),
  'rows come ordered by (team_id, person_id)');
reset role;

-- ===================================================================== D ===
insert into public.songs (id, organization_id, title) values (pg_temp.id_for('song'), pg_temp.id_for('org'), 'Review song');
create function pg_temp.song_refused(p_set text) returns boolean language plpgsql as $$
begin
  execute format('update public.songs set %s where id = %L', p_set, pg_temp.id_for('song'));
  return false;
exception when check_violation then
  return true;
end $$;
-- 101 emoji: 101 code points (old check passed) but 202 UTF-16 units (Zod refuses).
select pg_temp.check(pg_temp.song_refused(format('title = %L', repeat('😀', 101))), 'emoji title over 200 UTF-16 units is refused');
select pg_temp.check(not pg_temp.song_refused(format('title = %L', repeat('😀', 100))), 'emoji title of exactly 200 units is accepted');
select pg_temp.check(pg_temp.song_refused(format('title = %L', E'\t\n')), 'a whitespace-only title is refused (Zod trims tabs too)');
select pg_temp.check(not pg_temp.song_refused(format('title = %L', E'\t' || repeat('t', 200) || E'\n')),
  'surrounding whitespace is trimmed before counting, as in Zod');
select pg_temp.check(pg_temp.song_refused(format('author = %L', repeat('😀', 101))), 'emoji author over 200 units is refused');
select pg_temp.check(pg_temp.song_refused(format('notes = %L', repeat('😀', 2001))), 'emoji notes over 4000 units are refused');
select pg_temp.check(pg_temp.song_refused(format('default_key = %L', 'C#m/G#xx')) is false, 'an 8-character key is accepted');
select pg_temp.check(pg_temp.song_refused(format('default_key = %L', 'C#m/G#xxx')), 'a 9-character key is refused');
select pg_temp.check(pg_temp.song_refused(format('themes = %L::text[]', (select array_agg('t' || i) from generate_series(1, 21) i))),
  '21 themes are refused');
select pg_temp.check(not pg_temp.song_refused(format('themes = %L::text[]', (select array_agg('t' || i) from generate_series(1, 20) i))),
  '20 themes are accepted');
select pg_temp.check(pg_temp.song_refused(format('themes = %L::text[]', array[repeat('x', 41)])), 'a 41-character theme is refused');
select pg_temp.check(pg_temp.song_refused(format('themes = %L::text[]', array[repeat('😀', 21)])), 'a theme of 42 UTF-16 units is refused');
select pg_temp.check(pg_temp.song_refused(format('themes = %L::text[]', array['ok', ' '])), 'a blank theme is refused');
select pg_temp.check(pg_temp.song_refused('themes = array[''ok'', null]'), 'a null theme is refused');
select pg_temp.check(pg_temp.song_refused(format('song_types = %L::text[]', array[repeat('x', 41)])), 'a 41-character song type is refused');
select pg_temp.check(pg_temp.song_refused('song_types = ''{{a},{b}}''::text[]'), 'a nested song type array is refused');
select pg_temp.check((select bool_and(convalidated) from pg_constraint
                       where conrelid = 'public.songs'::regclass
                         and conname in ('songs_title_len', 'songs_author_len', 'songs_ccli_len', 'songs_copyright_len',
                                         'songs_admin_len', 'songs_default_key_len', 'songs_meter_len', 'songs_style_len',
                                         'songs_speed_len', 'songs_notes_len', 'songs_themes_valid', 'songs_song_types_valid')
                      having count(*) = 12),
  'all twelve song checks exist and are validated');
-- A client role can write songs through the checks (their helper functions are executable).
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
insert into public.songs (organization_id, title, themes, default_key)
  values (pg_temp.id_for('org'), repeat('😀', 100), array['Grace'], 'G');
reset role;

-- ===================================================================== E ===
select pg_temp.check(not has_function_privilege('anon', 'private.claim_plan_copy_key(uuid,text,text,uuid,uuid,text)', 'execute'),
  'anon cannot execute claim_plan_copy_key');
select pg_temp.check(has_function_privilege('authenticated', 'private.claim_plan_copy_key(uuid,text,text,uuid,uuid,text)', 'execute'),
  'authenticated can execute claim_plan_copy_key');
select pg_temp.check(not exists (
  select 1 from pg_proc p, aclexplode(p.proacl) a
   where p.oid = 'private.claim_plan_copy_key(uuid,text,text,uuid,uuid,text)'::regprocedure and a.grantee = 0),
  'PUBLIC holds no execute on claim_plan_copy_key');

-- ===================================================================== F ===
create temporary table rf_fired (tag text) on commit drop;
grant insert, select on rf_fired to authenticated;
create function public.rf_log_plan_columns() returns trigger language plpgsql as $$
begin
  insert into rf_fired values (tg_argv[0]);
  return null;
end $$;
create trigger rf_probe_other_columns after update of service_type_id, service_date, location, status, notes
  on public.plans for each row execute function public.rf_log_plan_columns('other');
create trigger rf_probe_location after update of location
  on public.plans for each row execute function public.rf_log_plan_columns('location');

set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
select public.update_plan_with_times(pg_temp.id_for('lead_plan'), jsonb_build_object('title', 'Review retitled'), null, null);
select pg_temp.check((select title from public.plans where id = pg_temp.id_for('lead_plan')) = 'Review retitled', 'the title is saved');
select pg_temp.check(not exists (select 1 from rf_fired), 'a title-only update fires no UPDATE OF trigger on other columns');
select public.update_plan_with_times(pg_temp.id_for('lead_plan'), jsonb_build_object('location', 'Hall C'), null, null);
select pg_temp.check((select array_agg(tag order by tag) from rf_fired) = array['location', 'other'],
  'a location update fires the location triggers');
select pg_temp.check((select service_date is not null and status = 'published' from public.plans where id = pg_temp.id_for('lead_plan')),
  'unsent columns keep their values');
-- A key present with JSON null still sets NULL; unknown keys are ignored.
select public.update_plan_with_times(pg_temp.id_for('lead_plan'), jsonb_build_object('location', null, 'bogus', 1), null, null);
select pg_temp.check((select location is null from public.plans where id = pg_temp.id_for('lead_plan')), 'location set to null');
do $$
begin
  perform public.update_plan_with_times(gen_random_uuid(), jsonb_build_object('title', 'x'), null, null);
  raise exception 'W8 review fix check failed: missing plan accepted';
exception when no_data_found then null;
end $$;
reset role;

rollback;
