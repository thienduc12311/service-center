-- Richer plan items (20261201020000): item ↔ service-time limits, long
-- details, notes carried from a song's last use, copy and Live behaviour.
-- Seeded Riverside: owner 1111…, scheduler (plan editor) 2222…, member 3333….
-- Run against the seeded local database. Everything rolls back.
begin;

create temporary table pid_fx (k text primary key, id uuid) on commit drop;
grant select on pid_fx to authenticated, service_role;
insert into pid_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('st', gen_random_uuid()), ('st_other', gen_random_uuid()),
  ('song', gen_random_uuid()), ('team', gen_random_uuid()), ('cat', gen_random_uuid()), ('cat_old', gen_random_uuid()),
  ('outsider', '0e000000-0000-4000-8000-0000000000aa'),
  -- Plans of the main service type, oldest first. mid_hi and mid_lo share a
  -- date: the higher plan id wins the tie.
  ('p_old', gen_random_uuid()),
  ('p_mid_lo', '0e000000-0000-4000-8000-000000000001'),
  ('p_mid_hi', '0e000000-0000-4000-8000-000000000002'),
  ('p_cur', gen_random_uuid()), ('p_future', gen_random_uuid()),
  ('p_other_st', gen_random_uuid()), ('p_other_plan', gen_random_uuid()),
  ('i_old', gen_random_uuid()), ('i_lo', gen_random_uuid()), ('i_hi', gen_random_uuid()), ('i_hi_second', gen_random_uuid()),
  ('i_future', gen_random_uuid()), ('i_other_st', gen_random_uuid()),
  ('i_welcome', gen_random_uuid()), ('i_sermon', gen_random_uuid()),
  ('s1', gen_random_uuid()), ('s2', gen_random_uuid()), ('reh', gen_random_uuid()), ('other_time', gen_random_uuid());
create or replace function pg_temp.fx(p text) returns uuid language sql stable as $$ select id from pid_fx where k = p $$;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', pg_temp.fx('outsider'), 'authenticated', 'authenticated',
  'pid.outsider@example.com', '', now(), '', '', '', '', '{}'::jsonb, '{"full_name":"Out Sider"}'::jsonb, now(), now());

insert into public.service_types (id, organization_id, name) values
  (pg_temp.fx('st'), pg_temp.fx('org'), 'PID Main'),
  (pg_temp.fx('st_other'), pg_temp.fx('org'), 'PID Other');
insert into public.songs (id, organization_id, title) values (pg_temp.fx('song'), pg_temp.fx('org'), 'PID Song');
insert into public.teams (id, organization_id, name) values (pg_temp.fx('team'), pg_temp.fx('org'), 'PID Team');
insert into public.note_categories (id, organization_id, service_type_id, name) values
  (pg_temp.fx('cat'), pg_temp.fx('org'), pg_temp.fx('st'), 'PID Vocals'),
  (pg_temp.fx('cat_old'), pg_temp.fx('org'), pg_temp.fx('st'), 'PID Retired');

insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by) values
  (pg_temp.fx('p_old'),        pg_temp.fx('org'), pg_temp.fx('st'),       'PID Old',    '2031-01-05 15:00+00', 'draft', '22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('p_mid_lo'),     pg_temp.fx('org'), pg_temp.fx('st'),       'PID Mid lo', '2031-01-12 15:00+00', 'draft', '22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('p_mid_hi'),     pg_temp.fx('org'), pg_temp.fx('st'),       'PID Mid hi', '2031-01-12 15:00+00', 'draft', '22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('p_other_st'),   pg_temp.fx('org'), pg_temp.fx('st_other'), 'PID Other',  '2031-01-19 15:00+00', 'draft', '22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('p_cur'),        pg_temp.fx('org'), pg_temp.fx('st'),       'PID Cur',    '2031-01-26 15:00+00', 'draft', '22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('p_future'),     pg_temp.fx('org'), pg_temp.fx('st'),       'PID Future', '2031-02-09 15:00+00', 'draft', '22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('p_other_plan'), pg_temp.fx('org'), pg_temp.fx('st'),       'PID Elsewhere', '2031-03-02 15:00+00', 'draft', '22222222-2222-4222-8222-222222222222');

insert into public.plan_times (id, plan_id, kind, name, starts_at, ends_at) values
  (pg_temp.fx('s1'),  pg_temp.fx('p_cur'), 'service', '9am',  '2031-01-26 14:00+00', '2031-01-26 15:00+00'),
  (pg_temp.fx('s2'),  pg_temp.fx('p_cur'), 'service', '11am', '2031-01-26 16:00+00', '2031-01-26 17:00+00'),
  (pg_temp.fx('reh'), pg_temp.fx('p_cur'), 'rehearsal', 'Run-through', '2031-01-25 18:00+00', '2031-01-25 20:00+00'),
  (pg_temp.fx('other_time'), pg_temp.fx('p_other_plan'), 'service', '9am', '2031-03-02 14:00+00', '2031-03-02 15:00+00');

insert into public.plan_items (id, plan_id, item_type, title, song_id, length_seconds, sort_order) values
  (pg_temp.fx('i_old'),       pg_temp.fx('p_old'),      'song', 'PID Song', pg_temp.fx('song'), 240, 0),
  (pg_temp.fx('i_lo'),        pg_temp.fx('p_mid_lo'),   'song', 'PID Song', pg_temp.fx('song'), 240, 0),
  (pg_temp.fx('i_hi'),        pg_temp.fx('p_mid_hi'),   'song', 'PID Song', pg_temp.fx('song'), 240, 0),
  (pg_temp.fx('i_hi_second'), pg_temp.fx('p_mid_hi'),   'song', 'PID Song again', pg_temp.fx('song'), 240, 1),
  (pg_temp.fx('i_other_st'),  pg_temp.fx('p_other_st'), 'song', 'PID Song', pg_temp.fx('song'), 240, 0),
  (pg_temp.fx('i_future'),    pg_temp.fx('p_future'),   'song', 'PID Song', pg_temp.fx('song'), 240, 0),
  (pg_temp.fx('i_welcome'),   pg_temp.fx('p_cur'),      'item', 'Welcome', null, 120, 0),
  (pg_temp.fx('i_sermon'),    pg_temp.fx('p_cur'),      'item', 'Sermon', null, 1800, 1);

-- Notes on each use. Only p_mid_hi's first item may be carried.
insert into public.plan_notes (organization_id, plan_id, plan_item_id, category_id, audience, body) values
  (pg_temp.fx('org'), pg_temp.fx('p_old'),      pg_temp.fx('i_old'),       null, 'organization', 'OLD note'),
  (pg_temp.fx('org'), pg_temp.fx('p_mid_lo'),   pg_temp.fx('i_lo'),        null, 'organization', 'TIE LOSER note'),
  (pg_temp.fx('org'), pg_temp.fx('p_mid_hi'),   pg_temp.fx('i_hi_second'), null, 'organization', 'SECOND ITEM note'),
  (pg_temp.fx('org'), pg_temp.fx('p_other_st'), pg_temp.fx('i_other_st'),  null, 'organization', 'OTHER TYPE note'),
  (pg_temp.fx('org'), pg_temp.fx('p_future'),   pg_temp.fx('i_future'),    null, 'organization', 'FUTURE note');
insert into public.plan_notes (organization_id, plan_id, plan_item_id, category_id, audience, body, created_at) values
  (pg_temp.fx('org'), pg_temp.fx('p_mid_hi'), pg_temp.fx('i_hi'), pg_temp.fx('cat'), 'organization', 'Start soft, build on the bridge', now() - interval '3 min'),
  (pg_temp.fx('org'), pg_temp.fx('p_mid_hi'), pg_temp.fx('i_hi'), null, 'leaders', 'Leaders only: watch the tempo', now() - interval '2 min'),
  (pg_temp.fx('org'), pg_temp.fx('p_mid_hi'), pg_temp.fx('i_hi'), pg_temp.fx('cat_old'), 'teams', 'Team: capo 2', now() - interval '1 min');
insert into public.plan_note_teams (note_id, organization_id, team_id)
select n.id, n.organization_id, pg_temp.fx('team') from public.plan_notes n where n.body = 'Team: capo 2';
-- Archived after the note was filed: a carried copy drops the category.
update public.note_categories set archived_at = now() where id = pg_temp.fx('cat_old');

-- ============================================== constraints (as owner) ====
do $$ begin
  begin
    insert into public.plan_item_times (plan_id, plan_item_id, plan_time_id)
    values (pg_temp.fx('p_cur'), pg_temp.fx('i_welcome'), pg_temp.fx('other_time'));
    raise exception 'FAIL: another plan''s time accepted';
  exception when sqlstate '22023' then null; end;
  begin
    insert into public.plan_item_times (plan_id, plan_item_id, plan_time_id)
    values (pg_temp.fx('p_cur'), pg_temp.fx('i_welcome'), pg_temp.fx('reh'));
    raise exception 'FAIL: rehearsal time accepted';
  exception when sqlstate '22023' then null; end;
  begin
    -- Claiming the other plan for the row: the item no longer matches.
    insert into public.plan_item_times (plan_id, plan_item_id, plan_time_id)
    values (pg_temp.fx('p_other_plan'), pg_temp.fx('i_welcome'), pg_temp.fx('other_time'));
    raise exception 'FAIL: an item of another plan accepted';
  exception when foreign_key_violation then null; end;
end $$;

-- The composite keys hold even without the trigger.
alter table public.plan_item_times disable trigger plan_item_times_validate;
do $$ begin
  begin
    insert into public.plan_item_times (plan_id, plan_item_id, plan_time_id)
    values (pg_temp.fx('p_cur'), pg_temp.fx('i_welcome'), pg_temp.fx('other_time'));
    raise exception 'FAIL: composite key let another plan''s time in';
  exception when foreign_key_violation then null; end;
end $$;
alter table public.plan_item_times enable trigger plan_item_times_validate;

do $$ begin
  begin
    update public.plan_items set details = repeat('x', 20001) where id = pg_temp.fx('i_welcome');
    raise exception 'FAIL: details over 20,000 characters accepted';
  exception when check_violation then null; end;
  update public.plan_items set details = repeat('x', 20000) where id = pg_temp.fx('i_welcome');
  update public.plan_items set details = null where id = pg_temp.fx('i_welcome');
end $$;

-- ================================================== RLS: writes and reads ====
set local role authenticated;

-- A member reads the plan order but cannot change limits or details.
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$ begin
  begin
    perform public.update_plan_item_with_details(pg_temp.fx('p_cur'), pg_temp.fx('i_welcome'),
      jsonb_build_object('time_ids', jsonb_build_array(pg_temp.fx('s1'))), null);
    raise exception 'FAIL: member limited an item';
  exception when sqlstate 'P0002' then null; end;
  begin
    insert into public.plan_item_times (plan_id, plan_item_id, plan_time_id)
    values (pg_temp.fx('p_cur'), pg_temp.fx('i_welcome'), pg_temp.fx('s1'));
    raise exception 'FAIL: member inserted a limit directly';
  exception when insufficient_privilege then null; end;
end $$;

-- The plan editor sets details and limits in one save.
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
declare
  v_rev bigint := (select content_revision from public.plans where id = pg_temp.fx('p_cur'));
  v_out jsonb;
begin
  v_out := public.update_plan_item_with_details(pg_temp.fx('p_cur'), pg_temp.fx('i_sermon'),
    jsonb_build_object('title', 'Sermon: Hope', 'details', E'## Outline\n- **Hope** in [Romans](https://example.com)',
                       'time_ids', jsonb_build_array(pg_temp.fx('s1'), pg_temp.fx('s1'))), v_rev);
  if v_out -> 'item' ->> 'title' <> 'Sermon: Hope' or v_out -> 'item' ->> 'details' not like '## Outline%' then
    raise exception 'FAIL: fields or details not saved: %', v_out;
  end if;
  if jsonb_array_length(v_out -> 'item' -> 'item_times') <> 1
     or v_out -> 'item' -> 'item_times' -> 0 ->> 'plan_time_id' <> pg_temp.fx('s1')::text then
    raise exception 'FAIL: limits not saved once: %', v_out;
  end if;
  if (v_out ->> 'content_revision')::bigint <= v_rev then
    raise exception 'FAIL: revision did not move';
  end if;
  -- The old revision is now stale: nothing applies.
  begin
    perform public.update_plan_item_with_details(pg_temp.fx('p_cur'), pg_temp.fx('i_sermon'),
      jsonb_build_object('time_ids', '[]'::jsonb), v_rev);
    raise exception 'FAIL: stale revision accepted';
  exception when sqlstate 'PT409' then null; end;
  if (select count(*) from public.plan_item_times where plan_item_id = pg_temp.fx('i_sermon')) <> 1 then
    raise exception 'FAIL: a refused save changed the limits';
  end if;
  -- Rehearsal and another plan's time are refused through the API path too.
  begin
    perform public.update_plan_item_with_details(pg_temp.fx('p_cur'), pg_temp.fx('i_welcome'),
      jsonb_build_object('title', 'Welcome!', 'time_ids', jsonb_build_array(pg_temp.fx('reh'))), null);
    raise exception 'FAIL: rehearsal time accepted through the save';
  exception when sqlstate '22023' then null; end;
  if (select title from public.plan_items where id = pg_temp.fx('i_welcome')) <> 'Welcome' then
    raise exception 'FAIL: a refused save kept its title change (not atomic)';
  end if;
  begin
    perform public.update_plan_item_with_details(pg_temp.fx('p_cur'), pg_temp.fx('i_welcome'),
      jsonb_build_object('time_ids', jsonb_build_array(pg_temp.fx('other_time'))), null);
    raise exception 'FAIL: another plan''s time accepted through the save';
  exception when sqlstate '22023' then null; end;
  -- Blank details clear; an absent key keeps them.
  perform public.update_plan_item_with_details(pg_temp.fx('p_cur'), pg_temp.fx('i_welcome'),
    jsonb_build_object('details', 'Greeting'), null);
  perform public.update_plan_item_with_details(pg_temp.fx('p_cur'), pg_temp.fx('i_welcome'),
    jsonb_build_object('title', 'Welcome'), null);
  if (select details from public.plan_items where id = pg_temp.fx('i_welcome')) <> 'Greeting' then
    raise exception 'FAIL: an absent details key changed details';
  end if;
  perform public.update_plan_item_with_details(pg_temp.fx('p_cur'), pg_temp.fx('i_welcome'),
    jsonb_build_object('details', '   '), null);
  if (select details from public.plan_items where id = pg_temp.fx('i_welcome')) is not null then
    raise exception 'FAIL: blank details not cleared';
  end if;
  -- An empty list is "every time".
  perform public.update_plan_item_with_details(pg_temp.fx('p_cur'), pg_temp.fx('i_welcome'),
    jsonb_build_object('time_ids', jsonb_build_array(pg_temp.fx('s1'), pg_temp.fx('s2'))), null);
  perform public.update_plan_item_with_details(pg_temp.fx('p_cur'), pg_temp.fx('i_welcome'),
    jsonb_build_object('time_ids', '[]'::jsonb), null);
  if exists (select 1 from public.plan_item_times where plan_item_id = pg_temp.fx('i_welcome')) then
    raise exception 'FAIL: an empty list did not clear the limits';
  end if;
end $$;

-- Reads: a member sees the limits; someone outside the organization does not.
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$ begin
  if (select count(*) from public.plan_item_times where plan_item_id = pg_temp.fx('i_sermon')) <> 1 then
    raise exception 'FAIL: member cannot read the limits';
  end if;
  delete from public.plan_item_times where plan_item_id = pg_temp.fx('i_sermon');
end $$;
reset role;
do $$ begin
  if (select count(*) from public.plan_item_times where plan_item_id = pg_temp.fx('i_sermon')) <> 1 then
    raise exception 'FAIL: member deleted a limit';
  end if;
end $$;
set local role authenticated;
set local request.jwt.claim.sub = '0e000000-0000-4000-8000-0000000000aa';
do $$ begin
  if exists (select 1 from public.plan_item_times where plan_id = pg_temp.fx('p_cur')) then
    raise exception 'FAIL: outsider read limits';
  end if;
  if public.song_last_use(pg_temp.fx('p_cur'), pg_temp.fx('song')) is not null then
    raise exception 'FAIL: outsider found a previous use';
  end if;
end $$;
reset role;

-- ============================================================ cascades ====
do $$
declare
  v_tmp_time uuid := gen_random_uuid();
  v_tmp_item uuid := gen_random_uuid();
begin
  insert into public.plan_times (id, plan_id, kind, name, starts_at, ends_at)
  values (v_tmp_time, pg_temp.fx('p_cur'), 'service', 'tmp', '2031-01-26 18:00+00', '2031-01-26 19:00+00');
  insert into public.plan_items (id, plan_id, item_type, title, sort_order) values (v_tmp_item, pg_temp.fx('p_cur'), 'item', 'Tmp', 9);
  insert into public.plan_item_times (plan_id, plan_item_id, plan_time_id) values
    (pg_temp.fx('p_cur'), v_tmp_item, v_tmp_time), (pg_temp.fx('p_cur'), v_tmp_item, pg_temp.fx('s2')),
    (pg_temp.fx('p_cur'), pg_temp.fx('i_welcome'), v_tmp_time);
  delete from public.plan_times where id = v_tmp_time;
  if exists (select 1 from public.plan_item_times where plan_time_id = v_tmp_time) then
    raise exception 'FAIL: deleting a time left its limits';
  end if;
  delete from public.plan_items where id = v_tmp_item;
  if exists (select 1 from public.plan_item_times where plan_item_id = v_tmp_item) then
    raise exception 'FAIL: deleting an item left its limits';
  end if;
  -- A service time turned into a rehearsal stops limiting items.
  insert into public.plan_item_times (plan_id, plan_item_id, plan_time_id) values (pg_temp.fx('p_cur'), pg_temp.fx('i_welcome'), pg_temp.fx('s2'));
  update public.plan_times set kind = 'rehearsal' where id = pg_temp.fx('s2');
  if exists (select 1 from public.plan_item_times where plan_time_id = pg_temp.fx('s2')) then
    raise exception 'FAIL: a time that became a rehearsal still limits items';
  end if;
  update public.plan_times set kind = 'service' where id = pg_temp.fx('s2');
end $$;

-- ===================================================== carried notes ======
set local role authenticated;

-- Preview: a member counts only the notes they can read (organization only;
-- not leaders, not a team they are not on).
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$
declare v jsonb := public.song_last_use(pg_temp.fx('p_cur'), pg_temp.fx('song'));
begin
  if v ->> 'plan_id' <> pg_temp.fx('p_mid_hi')::text or v ->> 'item_id' <> pg_temp.fx('i_hi')::text then
    raise exception 'FAIL: wrong last use (latest date, then highest plan id, then first item): %', v;
  end if;
  if (v ->> 'note_count')::int <> 1 then
    raise exception 'FAIL: member preview counted notes they cannot read: %', v;
  end if;
end $$;

set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
declare
  v jsonb;
  v_item uuid;
  v_again jsonb;
begin
  if (public.song_last_use(pg_temp.fx('p_cur'), pg_temp.fx('song')) ->> 'note_count')::int <> 3 then
    raise exception 'FAIL: editor preview should count all three notes';
  end if;
  -- No earlier use: a plan before every use.
  if public.song_last_use(pg_temp.fx('p_old'), pg_temp.fx('song')) is not null then
    raise exception 'FAIL: the oldest use has no previous use';
  end if;

  v := public.add_plan_item_with_details(pg_temp.fx('p_cur'),
    jsonb_build_object('item_type', 'song', 'song_id', pg_temp.fx('song'), 'carry_notes_from_last_use', true,
                       'details', 'Key of D', 'time_ids', jsonb_build_array(pg_temp.fx('s2'))),
    'pid-carry-key-0001');
  v_item := (v -> 'item' ->> 'id')::uuid;
  if (v -> 'carried_notes' ->> 'count')::int <> 3
     or v -> 'carried_notes' ->> 'source_plan_id' <> pg_temp.fx('p_mid_hi')::text then
    raise exception 'FAIL: carry summary wrong: %', v;
  end if;
  if v -> 'item' ->> 'details' <> 'Key of D' or jsonb_array_length(v -> 'item' -> 'item_times') <> 1 then
    raise exception 'FAIL: add did not save details/limits: %', v;
  end if;
  if (select count(*) from public.plan_notes where plan_item_id = v_item) <> 3 then
    raise exception 'FAIL: three notes expected on the new item';
  end if;
  if not exists (select 1 from public.plan_notes where plan_item_id = v_item and body = 'Start soft, build on the bridge'
                  and category_id = pg_temp.fx('cat') and audience = 'organization' and plan_id = pg_temp.fx('p_cur')
                  and created_by = '22222222-2222-4222-8222-222222222222') then
    raise exception 'FAIL: category / audience / author not carried';
  end if;
  if not exists (select 1 from public.plan_notes where plan_item_id = v_item and audience = 'leaders') then
    raise exception 'FAIL: leaders note the editor can read was not carried';
  end if;
  if not exists (select 1 from public.plan_notes n join public.plan_note_teams t on t.note_id = n.id
                  where n.plan_item_id = v_item and n.audience = 'teams' and t.team_id = pg_temp.fx('team')
                    and n.category_id is null) then
    raise exception 'FAIL: team target not carried (or archived category kept)';
  end if;
  if exists (select 1 from public.plan_notes where plan_item_id = v_item
              and body in ('OLD note', 'TIE LOSER note', 'SECOND ITEM note', 'OTHER TYPE note', 'FUTURE note')) then
    raise exception 'FAIL: a note from the wrong use was carried';
  end if;
  -- Source notes are untouched.
  if (select count(*) from public.plan_notes where plan_item_id = pg_temp.fx('i_hi')) <> 3 then
    raise exception 'FAIL: source notes changed';
  end if;

  -- A replay returns the same item and copies nothing again.
  v_again := public.add_plan_item_with_details(pg_temp.fx('p_cur'),
    jsonb_build_object('item_type', 'song', 'song_id', pg_temp.fx('song'), 'carry_notes_from_last_use', true,
                       'details', 'Key of D', 'time_ids', jsonb_build_array(pg_temp.fx('s2'))),
    'pid-carry-key-0001');
  if (v_again -> 'item' ->> 'id')::uuid <> v_item or not (v_again ->> 'replayed')::boolean then
    raise exception 'FAIL: replay made another item';
  end if;
  if (select count(*) from public.plan_notes where plan_item_id = v_item) <> 3 then
    raise exception 'FAIL: replay carried notes twice';
  end if;

  -- Without the flag nothing is carried.
  v := public.add_plan_item_with_details(pg_temp.fx('p_cur'),
    jsonb_build_object('item_type', 'song', 'song_id', pg_temp.fx('song')), null);
  if v -> 'carried_notes' <> 'null'::jsonb
     or exists (select 1 from public.plan_notes where plan_item_id = (v -> 'item' ->> 'id')::uuid) then
    raise exception 'FAIL: notes carried without the flag';
  end if;
  -- A song with no earlier use: the flag is harmless.
  v := public.add_plan_item_with_details(pg_temp.fx('p_old'),
    jsonb_build_object('item_type', 'song', 'song_id', pg_temp.fx('song'), 'carry_notes_from_last_use', true), null);
  if v -> 'carried_notes' <> 'null'::jsonb then
    raise exception 'FAIL: a first use reported carried notes';
  end if;
  -- A rehearsal limit on add fails the whole add (nothing is left behind).
  begin
    perform public.add_plan_item_with_details(pg_temp.fx('p_cur'),
      jsonb_build_object('item_type', 'item', 'title', 'Bad limit', 'time_ids', jsonb_build_array(pg_temp.fx('reh'))), null);
    raise exception 'FAIL: rehearsal limit accepted on add';
  exception when sqlstate '22023' then null; end;
  if exists (select 1 from public.plan_items where plan_id = pg_temp.fx('p_cur') and title = 'Bad limit') then
    raise exception 'FAIL: a refused add left its item';
  end if;
end $$;

-- A member cannot add (and so cannot carry).
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$ begin
  begin
    perform public.add_plan_item_with_details(pg_temp.fx('p_cur'),
      jsonb_build_object('item_type', 'song', 'song_id', pg_temp.fx('song'), 'carry_notes_from_last_use', true), null);
    raise exception 'FAIL: member added an item';
  exception when sqlstate 'P0002' then null; end;
end $$;
reset role;

-- Notes the caller cannot read are never copied. Every plan editor of this
-- service type can read every audience today, so hide the leaders note with
-- a test-only restrictive policy (rolled back) and check the copy follows RLS.
create policy pid_hide_leaders on public.plan_notes as restrictive for select to authenticated
  using (audience <> 'leaders');
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
declare v jsonb;
begin
  v := public.add_plan_item_with_details(pg_temp.fx('p_cur'),
    jsonb_build_object('item_type', 'song', 'song_id', pg_temp.fx('song'), 'carry_notes_from_last_use', true), null);
  if (v -> 'carried_notes' ->> 'count')::int <> 2 then
    raise exception 'FAIL: an unreadable note was carried: %', v;
  end if;
end $$;
reset role;
drop policy pid_hide_leaders on public.plan_notes;
do $$ begin
  -- Only the first (unrestricted) carry brought a leaders note to this plan.
  if (select count(*) from public.plan_notes where plan_id = pg_temp.fx('p_cur') and audience = 'leaders') <> 1 then
    raise exception 'FAIL: the hidden leaders note reached the new item';
  end if;
end $$;

-- ============================================================= copying ====
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
declare
  v_new uuid;
  v_new_s1 uuid;
  v_sermon uuid;
begin
  v_new := public.duplicate_plan(pg_temp.fx('p_cur'), '2031-06-01 15:00+00', 'PID Copy', false, 'pid-dup-key-0001');
  select id into v_new_s1 from public.plan_times where plan_id = v_new and name = '9am';
  select id into v_sermon from public.plan_items where plan_id = v_new and title = 'Sermon: Hope';
  if v_new_s1 is null or v_sermon is null then
    raise exception 'FAIL: copy missing its time or item';
  end if;
  if (select array_agg(plan_time_id) from public.plan_item_times where plan_item_id = v_sermon) <> array[v_new_s1] then
    raise exception 'FAIL: copied item not limited to the copied 9am time';
  end if;
  if (select details from public.plan_items where id = v_sermon) not like '## Outline%' then
    raise exception 'FAIL: details not copied';
  end if;
  if exists (select 1 from public.plan_item_times pit join public.plan_times t on t.id = pit.plan_time_id
              where pit.plan_id = v_new and t.plan_id <> v_new) then
    raise exception 'FAIL: a copied limit points at the source plan''s time';
  end if;
  if (select count(*) from public.plan_item_times where plan_id = v_new)
     <> (select count(*) from public.plan_item_times where plan_id = pg_temp.fx('p_cur')) then
    raise exception 'FAIL: limit count differs after copy';
  end if;

  -- Importing into a plan with a matching 9am time maps the limit onto it;
  -- importing into a plan with no times drops the limits cleanly.
  perform public.import_plan_contents(pg_temp.fx('p_other_plan'), pg_temp.fx('p_cur'), true, false, false, null, 'pid-import-key-0001');
  perform public.import_plan_contents(pg_temp.fx('p_future'), pg_temp.fx('p_cur'), true, false, false, null, 'pid-import-key-0002');
end $$;
reset role;
do $$ begin
  if (select array_agg(pit.plan_time_id) from public.plan_item_times pit
        join public.plan_items i on i.id = pit.plan_item_id
       where i.plan_id = pg_temp.fx('p_other_plan') and i.title = 'Sermon: Hope') <> array[pg_temp.fx('other_time')] then
    raise exception 'FAIL: import did not map the limit onto the matching time';
  end if;
  if not exists (select 1 from public.plan_items where plan_id = pg_temp.fx('p_future') and title = 'Sermon: Hope') then
    raise exception 'FAIL: import did not copy the items';
  end if;
  if exists (select 1 from public.plan_item_times where plan_id = pg_temp.fx('p_future')) then
    raise exception 'FAIL: an import kept limits with no matching time';
  end if;
end $$;

-- ================================================================ live ====
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
declare
  v_run jsonb;
  v_ids text[];
begin
  -- Sermon is limited to 9am: an 11am run leaves it out; a 9am run keeps it.
  v_run := public.create_live_run(pg_temp.fx('p_cur'), pg_temp.fx('s2'), 'item', 'pid-live-11', 'tab-pid');
  select array_agg(x ->> 'title') into v_ids from jsonb_array_elements(v_run -> 'run' -> 'snapshot') x;
  if 'Sermon: Hope' = any(v_ids) or not ('Welcome' = any(v_ids)) then
    raise exception 'FAIL: 11am snapshot wrong: %', v_ids;
  end if;
  v_run := public.create_live_run(pg_temp.fx('p_cur'), pg_temp.fx('s1'), 'item', 'pid-live-9', 'tab-pid');
  select array_agg(x ->> 'title') into v_ids from jsonb_array_elements(v_run -> 'run' -> 'snapshot') x;
  if not ('Sermon: Hope' = any(v_ids)) or not ('Welcome' = any(v_ids)) then
    raise exception 'FAIL: 9am snapshot wrong: %', v_ids;
  end if;
end $$;
reset role;

select 'plan-item-details: all assertions passed' as result;
rollback;
