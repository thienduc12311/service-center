-- F10: saved templates, safe apply, sections and bounded DST-safe generation.
-- Run against the seeded local database. Everything rolls back.
begin;

create temporary table f10_fx (k text primary key, id uuid) on commit drop;
grant select, insert, update, delete on f10_fx to authenticated, service_role;
insert into f10_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('st', 'bbbbbbbb-0000-4000-8000-000000000001'),
  ('band', 'cccccccc-0000-4000-8000-000000000001'),
  ('leader', 'dddddddd-0000-4000-8000-000000000001'),
  ('keys', 'dddddddd-0000-4000-8000-000000000006'),
  ('song', 'eeeeeeee-0000-4000-8000-000000000001'),
  ('sam', (select id from public.people where profile_id = '33333333-3333-4333-8333-333333333333')),
  ('riley', (select id from public.people where profile_id = '44444444-4444-4444-8444-444444444444')),
  ('morgan', (select id from public.people where profile_id = '55555555-5555-4555-8555-555555555555')),
  ('source', gen_random_uuid()), ('dest', gen_random_uuid()), ('busy', gen_random_uuid()),
  ('other_org', gen_random_uuid()), ('other_song', gen_random_uuid());
create or replace function pg_temp.fx(p text) returns uuid language sql stable as
  $$ select id from f10_fx where k = p $$;
-- A wall-clock time in the organization's zone, as the API resolves it.
create or replace function pg_temp.at_local(d date, t text) returns timestamptz language sql stable as
  $$ select (d + t::time) at time zone 'America/Toronto' $$;

insert into public.organizations (id, name, slug) values (pg_temp.fx('other_org'), 'F10 other', 'f10-other-' || left(gen_random_uuid()::text, 8));
insert into public.songs (id, organization_id, title) values (pg_temp.fx('other_song'), pg_temp.fx('other_org'), 'Foreign song');

-- Source plan: two times (rehearsal the evening before), order, needs and a
-- team with one declined request that must not become part of a pattern.
insert into public.plans (id, organization_id, service_type_id, title, service_date, status, notes, created_by) values
  (pg_temp.fx('source'), pg_temp.fx('org'), pg_temp.fx('st'), 'F10 source', pg_temp.at_local('2027-03-07', '10:00'), 'published', 'Bring water', '22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('dest'), pg_temp.fx('org'), pg_temp.fx('st'), 'F10 dest', pg_temp.at_local('2027-04-04', '10:00'), 'draft', null, '22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('busy'), pg_temp.fx('org'), pg_temp.fx('st'), 'F10 busy', pg_temp.at_local('2027-04-04', '10:00'), 'draft', null, '22222222-2222-4222-8222-222222222222');
insert into public.plan_times (plan_id, kind, name, starts_at, ends_at, sort_order) values
  (pg_temp.fx('source'), 'rehearsal', 'Run-through', pg_temp.at_local('2027-03-06', '19:00'), pg_temp.at_local('2027-03-06', '20:30'), 0),
  (pg_temp.fx('source'), 'service', 'Service', pg_temp.at_local('2027-03-07', '10:00'), pg_temp.at_local('2027-03-07', '11:15'), 1),
  (pg_temp.fx('dest'), 'service', 'Service', pg_temp.at_local('2027-04-04', '10:00'), pg_temp.at_local('2027-04-04', '11:15'), 0),
  (pg_temp.fx('busy'), 'service', 'Service', pg_temp.at_local('2027-04-04', '10:00'), pg_temp.at_local('2027-04-04', '11:00'), 0);
insert into public.plan_items (plan_id, item_type, title, song_id, length_seconds, sort_order) values
  (pg_temp.fx('source'), 'header', 'Welcome', null, 0, 0),
  (pg_temp.fx('source'), 'song', 'Amazing Grace', pg_temp.fx('song'), 300, 1),
  (pg_temp.fx('dest'), 'item', 'Existing announcement', null, 120, 0);
insert into public.plan_position_needs (plan_id, position_id, needed) values
  (pg_temp.fx('source'), pg_temp.fx('keys'), 1),
  (pg_temp.fx('source'), pg_temp.fx('leader'), 1);
insert into public.assignments (plan_id, person_id, team_id, position_id, status, created_by) values
  (pg_temp.fx('source'), pg_temp.fx('sam'), pg_temp.fx('band'), pg_temp.fx('leader'), 'confirmed', '22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('source'), pg_temp.fx('riley'), pg_temp.fx('band'), pg_temp.fx('keys'), 'declined', '22222222-2222-4222-8222-222222222222');

set local role authenticated;

-- ------------------------------------------------ access ---------------
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$ begin
  begin
    perform public.save_plan_template(pg_temp.fx('org'), null, null, 'plan', pg_temp.fx('st'), 'Member template', null,
      '{"items":[{"item_type":"item","title":"x"}]}'::jsonb, null, null);
    raise exception 'a member saved a template';
  exception when insufficient_privilege then null;
  end;
end $$;

set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

-- ------------------------------------- save from a plan; independence ---
do $$
declare saved jsonb; content jsonb; tpl uuid;
begin
  saved := public.save_plan_template(pg_temp.fx('org'), null, null, 'plan', pg_temp.fx('st'), 'Sunday standard', 'Our usual',
    null, pg_temp.fx('source'), array['times', 'notes', 'items', 'needs', 'roster']);
  tpl := (saved ->> 'template_id')::uuid;
  insert into f10_fx values ('tpl', tpl);
  if (saved ->> 'revision')::int <> 1 then raise exception 'first revision is not 1'; end if;
  select r.content into content from public.plan_template_revisions r where r.template_id = tpl and r.revision = 1;
  insert into f10_fx values ('rev1', (select id from public.plan_template_revisions where template_id = tpl and revision = 1));
  if jsonb_array_length(content -> 'roster') <> 1 or content #>> '{roster,0,person_id}' <> pg_temp.fx('sam')::text then
    raise exception 'roster pattern must hold only the non-declined request: %', content -> 'roster';
  end if;
  if content -> 'times' <> '[{"kind":"rehearsal","name":"Run-through","day_offset":-1,"local_start":"19:00","duration_minutes":90},{"kind":"service","name":"Service","day_offset":0,"local_start":"10:00","duration_minutes":75}]'::jsonb then
    raise exception 'times were not saved as wall-clock intent: %', content -> 'times';
  end if;
  if content ->> 'notes' <> 'Bring water' or jsonb_array_length(content -> 'items') <> 2 or jsonb_array_length(content -> 'needs') <> 2 then
    raise exception 'components missing from snapshot: %', content;
  end if;
end $$;

-- A song from another organization is refused.
do $$ begin
  begin
    perform public.save_plan_template(pg_temp.fx('org'), null, null, 'plan', pg_temp.fx('st'), 'Foreign', null,
      jsonb_build_object('items', jsonb_build_array(jsonb_build_object('item_type', 'song', 'song_id', pg_temp.fx('other_song')))), null, null);
    raise exception 'a foreign song was accepted';
  exception when invalid_parameter_value then null;
  end;
  -- Unknown component keys are refused too.
  begin
    perform public.save_plan_template(pg_temp.fx('org'), null, null, 'plan', pg_temp.fx('st'), 'Odd', null,
      '{"assignments_confirmed":[]}'::jsonb, null, null);
    raise exception 'an unknown component was accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- ----------------------------------------- preview writes nothing --------
do $$
declare preview jsonb; before_items int; before_rev bigint;
begin
  select count(*) into before_items from public.plan_items where plan_id = pg_temp.fx('dest');
  select content_revision into before_rev from public.plans where id = pg_temp.fx('dest');
  preview := public.preview_plan_template_apply(pg_temp.fx('dest'), pg_temp.fx('rev1'), 'append',
    array['items', 'needs', 'roster', 'notes'], '[]'::jsonb, null);
  if (select count(*) from public.plan_items where plan_id = pg_temp.fx('dest')) <> before_items
     or (select content_revision from public.plans where id = pg_temp.fx('dest')) <> before_rev then
    raise exception 'preview wrote to the plan';
  end if;
  if jsonb_array_length(preview #> '{items,add}') <> 2 or (preview #>> '{items,insert_at}')::int <> 1
     or jsonb_array_length(preview #> '{roster,add}') <> 1 or preview #>> '{notes,action}' <> 'set' then
    raise exception 'unexpected preview: %', preview;
  end if;
  insert into f10_fx values ('hash_placeholder', null);
end $$;

-- ------------------------------ apply: stale revision / stale preview -----
do $$
declare preview jsonb; hint text; rev bigint;
begin
  preview := public.preview_plan_template_apply(pg_temp.fx('dest'), pg_temp.fx('rev1'), 'append',
    array['items', 'needs', 'roster', 'notes'], '[]'::jsonb, null);
  rev := (preview ->> 'destination_revision')::bigint;
  begin
    perform public.apply_plan_template(pg_temp.fx('dest'), pg_temp.fx('rev1'), 'append',
      array['items', 'needs', 'roster', 'notes'], preview ->> 'preview_hash', '[]'::jsonb, null, rev - 1, 'f10-stale-rev', null);
    raise exception 'stale destination revision applied';
  exception when sqlstate 'PT409' then get stacked diagnostics hint = pg_exception_hint;
  end;
  if hint <> 'plan_changed' then raise exception 'expected plan_changed, got %', hint; end if;
  begin
    perform public.apply_plan_template(pg_temp.fx('dest'), pg_temp.fx('rev1'), 'append',
      array['items', 'needs', 'roster', 'notes'], md5('not the preview'), '[]'::jsonb, null, rev, 'f10-stale-hash', null);
    raise exception 'stale preview applied';
  exception when sqlstate 'PT409' then get stacked diagnostics hint = pg_exception_hint;
  end;
  if hint <> 'template_preview_changed' then raise exception 'expected template_preview_changed, got %', hint; end if;
end $$;

-- --------------------------------------------- apply, replay, provenance --
do $$
declare preview jsonb; first_result jsonb; replay jsonb; hint text;
begin
  preview := public.preview_plan_template_apply(pg_temp.fx('dest'), pg_temp.fx('rev1'), 'append',
    array['items', 'needs', 'roster', 'notes'], '[]'::jsonb, null);
  first_result := public.apply_plan_template(pg_temp.fx('dest'), pg_temp.fx('rev1'), 'append',
    array['items', 'needs', 'roster', 'notes'], preview ->> 'preview_hash', '[]'::jsonb, null,
    (preview ->> 'destination_revision')::bigint, 'f10-apply-once', null);
  replay := public.apply_plan_template(pg_temp.fx('dest'), pg_temp.fx('rev1'), 'append',
    array['items', 'needs', 'roster', 'notes'], preview ->> 'preview_hash', '[]'::jsonb, null,
    (preview ->> 'destination_revision')::bigint, 'f10-apply-once', null);
  if not (replay ->> 'replayed')::boolean or replay ->> 'application_id' <> first_result ->> 'application_id' then
    raise exception 'replay did not return the first application';
  end if;
  if (select count(*) from public.plan_items where plan_id = pg_temp.fx('dest')) <> 3 then
    raise exception 'replay duplicated items';
  end if;
  if (select string_agg(title, '|' order by sort_order) from public.plan_items where plan_id = pg_temp.fx('dest'))
     <> 'Existing announcement|Welcome|Amazing Grace' then
    raise exception 'append order is wrong';
  end if;
  if exists (select 1 from public.assignments where plan_id = pg_temp.fx('dest')
      and (status <> 'unconfirmed' or visibility <> 'prepared' or notified_at is not null or responded_at is not null or released_at is not null)) then
    raise exception 'roster pattern inherited answer, delivery or release state';
  end if;
  if (select count(*) from public.assignments where plan_id = pg_temp.fx('dest')) <> 1 then
    raise exception 'roster pattern not applied once';
  end if;
  if (select notes from public.plans where id = pg_temp.fx('dest')) <> 'Bring water' then
    raise exception 'notes not set';
  end if;
  if (select count(*) from public.plan_template_applications where plan_id = pg_temp.fx('dest')) <> 1 then
    raise exception 'provenance not recorded once';
  end if;
  -- Same key, different request.
  begin
    perform public.apply_plan_template(pg_temp.fx('dest'), pg_temp.fx('rev1'), 'append',
      array['items'], preview ->> 'preview_hash', '[]'::jsonb, null, null, 'f10-apply-once', null);
    raise exception 'reused key accepted';
  exception when sqlstate 'PT409' then get stacked diagnostics hint = pg_exception_hint;
  end;
  if hint <> 'idempotency_key_reused' then raise exception 'expected idempotency_key_reused, got %', hint; end if;
  -- An intentional second application is allowed but flagged.
  preview := public.preview_plan_template_apply(pg_temp.fx('dest'), pg_temp.fx('rev1'), 'append', array['items'], '[]'::jsonb, null);
  if not exists (select 1 from jsonb_array_elements(preview -> 'warnings') w where w ->> 'code' = 'already_applied') then
    raise exception 'second application not flagged as duplicate intent';
  end if;
end $$;

-- ---------------------------- editing the template never changes the plan --
do $$
declare saved jsonb; hint text;
begin
  begin
    perform public.save_plan_template(pg_temp.fx('org'), pg_temp.fx('tpl'), 0, null, null, null, null,
      '{"items":[{"item_type":"item","title":"Changed"}]}'::jsonb, null, null);
    raise exception 'stale template edit accepted';
  exception when sqlstate 'PT409' then get stacked diagnostics hint = pg_exception_hint;
  end;
  if hint <> 'template_changed' then raise exception 'expected template_changed'; end if;
  saved := public.save_plan_template(pg_temp.fx('org'), pg_temp.fx('tpl'), 1, null, null, 'Sunday standard v2', null,
    '{"items":[{"item_type":"item","title":"Only this"}]}'::jsonb, null, null);
  if (saved ->> 'revision')::int <> 2 then raise exception 'edit did not create revision 2'; end if;
  if (select jsonb_array_length(content -> 'items') from public.plan_template_revisions where id = pg_temp.fx('rev1')) <> 2 then
    raise exception 'revision 1 changed';
  end if;
  if (select count(*) from public.plan_items where plan_id = pg_temp.fx('dest')) <> 3 then
    raise exception 'editing the template changed an existing plan';
  end if;
end $$;

-- Revisions are immutable even for their author.
do $$ begin
  update public.plan_template_revisions set content = '{}'::jsonb where id = pg_temp.fx('rev1');
  raise exception 'revision updated';
exception when insufficient_privilege then null;
end $$;

-- ------------------------------ replace times blocked when people scheduled
do $$
declare preview jsonb;
begin
  preview := public.preview_plan_template_apply(pg_temp.fx('dest'), pg_temp.fx('rev1'), 'replace', array['times'],
    jsonb_build_array(
      jsonb_build_object('starts_at', pg_temp.at_local('2027-04-03', '19:00'), 'ends_at', pg_temp.at_local('2027-04-03', '20:30')),
      jsonb_build_object('starts_at', pg_temp.at_local('2027-04-04', '10:00'), 'ends_at', pg_temp.at_local('2027-04-04', '11:15'))), null);
  if preview #>> '{blocking,0,code}' <> 'times_in_use' then raise exception 'replace times not blocked: %', preview; end if;
  begin
    perform public.apply_plan_template(pg_temp.fx('dest'), pg_temp.fx('rev1'), 'replace', array['times'], preview ->> 'preview_hash',
      jsonb_build_array(
        jsonb_build_object('starts_at', pg_temp.at_local('2027-04-03', '19:00'), 'ends_at', pg_temp.at_local('2027-04-03', '20:30')),
        jsonb_build_object('starts_at', pg_temp.at_local('2027-04-04', '10:00'), 'ends_at', pg_temp.at_local('2027-04-04', '11:15'))),
      null, null, null, null);
    raise exception 'blocked apply committed';
  exception when invalid_parameter_value then null;
  end;
  -- Times that are not the template's wall-clock intent are refused.
  begin
    perform public.preview_plan_template_apply(pg_temp.fx('dest'), pg_temp.fx('rev1'), 'append', array['times'],
      jsonb_build_array(
        jsonb_build_object('starts_at', pg_temp.at_local('2027-04-03', '18:00'), 'ends_at', pg_temp.at_local('2027-04-03', '19:30')),
        jsonb_build_object('starts_at', pg_temp.at_local('2027-04-04', '10:00'), 'ends_at', pg_temp.at_local('2027-04-04', '11:15'))), null);
    raise exception 'mismatched times accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- --------------------- forced rollback: a roster conflict undoes the items --
do $$
declare preview jsonb; before_items int; tpl jsonb; rev uuid;
begin
  -- Morgan is already serving on another plan at the same time.
  perform public.schedule_plan_assignments(pg_temp.fx('busy'),
    jsonb_build_array(jsonb_build_object('person_id', pg_temp.fx('morgan'), 'team_id', pg_temp.fx('band'), 'position_id', pg_temp.fx('keys'))),
    false, null, 'released', null, null);
  tpl := public.save_plan_template(pg_temp.fx('org'), null, null, 'plan', pg_temp.fx('st'), 'Conflicting', null,
    jsonb_build_object('items', '[{"item_type":"item","title":"Should roll back"}]'::jsonb,
      'roster', jsonb_build_array(jsonb_build_object('person_id', pg_temp.fx('morgan'), 'team_id', pg_temp.fx('band'), 'position_id', pg_temp.fx('leader')))),
    null, null);
  select id into rev from public.plan_template_revisions where template_id = (tpl ->> 'template_id')::uuid;
  select count(*) into before_items from public.plan_items where plan_id = pg_temp.fx('dest');
  preview := public.preview_plan_template_apply(pg_temp.fx('dest'), rev, 'append', array['items', 'roster'], '[]'::jsonb, null);
  begin
    perform public.apply_plan_template(pg_temp.fx('dest'), rev, 'append', array['items', 'roster'], preview ->> 'preview_hash',
      '[]'::jsonb, null, null, 'f10-conflict', null);
    raise exception 'conflicting roster applied';
  exception when sqlstate 'PT409' then null;
  end;
  if (select count(*) from public.plan_items where plan_id = pg_temp.fx('dest')) <> before_items then
    raise exception 'failed apply left items behind';
  end if;
  if exists (select 1 from public.plan_template_applications where idempotency_key = 'f10-conflict') then
    raise exception 'failed apply left provenance';
  end if;
end $$;

-- ------------------------------------------------ section templates --------
do $$
declare tpl jsonb; rev uuid; preview jsonb;
begin
  begin
    perform public.save_plan_template(pg_temp.fx('org'), null, null, 'section', pg_temp.fx('st'), 'Bad section', null,
      '{"items":[{"item_type":"item","title":"x"}],"notes":"no"}'::jsonb, null, null);
    raise exception 'section with notes accepted';
  exception when invalid_parameter_value then null;
  end;
  tpl := public.save_plan_template(pg_temp.fx('org'), null, null, 'section', pg_temp.fx('st'), 'Communion', null,
    '{"items":[{"item_type":"header","title":"Communion"},{"item_type":"item","title":"Prayer","length_seconds":120}]}'::jsonb, null, null);
  select id into rev from public.plan_template_revisions where template_id = (tpl ->> 'template_id')::uuid;
  begin
    perform public.preview_plan_template_apply(pg_temp.fx('dest'), rev, 'append', array['items', 'notes'], '[]'::jsonb, null);
    raise exception 'section applied notes';
  exception when invalid_parameter_value then null;
  end;
  preview := public.preview_plan_template_apply(pg_temp.fx('dest'), rev, 'append', array['items'], '[]'::jsonb, 1);
  perform public.apply_plan_template(pg_temp.fx('dest'), rev, 'append', array['items'], preview ->> 'preview_hash', '[]'::jsonb, 1, null, null, null);
  if (select string_agg(title, '|' order by sort_order) from public.plan_items where plan_id = pg_temp.fx('dest'))
     <> 'Existing announcement|Communion|Prayer|Welcome|Amazing Grace' then
    raise exception 'section not inserted at the chosen place: %',
      (select string_agg(title, '|' order by sort_order) from public.plan_items where plan_id = pg_temp.fx('dest'));
  end if;
end $$;

-- ------------------------------------- archive blocks new applications ----
do $$ begin
  perform public.set_plan_template_archived(pg_temp.fx('tpl'), true);
  begin
    perform public.preview_plan_template_apply(pg_temp.fx('dest'), pg_temp.fx('rev1'), 'append', array['items'], '[]'::jsonb, null);
    raise exception 'archived template applied';
  exception when invalid_parameter_value then null;
  end;
  perform public.set_plan_template_archived(pg_temp.fx('tpl'), false);
end $$;

-- ---------------------- generation across the 2027-11-07 DST change --------
do $$
declare
  rev uuid; plans jsonb; preview jsonb; first_result jsonb; replay jsonb; d date; bad jsonb; before int;
begin
  select id into rev from public.plan_template_revisions where template_id = pg_temp.fx('tpl') and revision = 1;
  plans := '[]'::jsonb;
  foreach d in array array['2027-10-31'::date, '2027-11-07'::date, '2027-11-14'::date] loop
    plans := plans || jsonb_build_array(jsonb_build_object(
      'local_date', d, 'title', 'Sunday ' || d, 'service_date', pg_temp.at_local(d, '10:00'),
      'times', jsonb_build_array(
        jsonb_build_object('starts_at', pg_temp.at_local(d - 1, '19:00'), 'ends_at', pg_temp.at_local(d - 1, '20:30')),
        jsonb_build_object('starts_at', pg_temp.at_local(d, '10:00'), 'ends_at', pg_temp.at_local(d, '11:15')))));
  end loop;
  -- Fixed-week arithmetic shifts the wall clock across DST and is refused.
  bad := jsonb_set(plans, '{2,times,1}', jsonb_build_object(
    'starts_at', pg_temp.at_local('2027-10-31', '10:00') + interval '14 days',
    'ends_at', pg_temp.at_local('2027-10-31', '11:15') + interval '14 days'));
  begin
    perform public.preview_plan_generation(pg_temp.fx('org'), rev, array['items', 'needs', 'roster', 'notes'], bad);
    raise exception 'fixed-offset times accepted across DST';
  exception when invalid_parameter_value then null;
  end;

  select count(*) into before from public.plans where organization_id = pg_temp.fx('org');
  preview := public.preview_plan_generation(pg_temp.fx('org'), rev, array['items', 'needs', 'roster', 'notes'], plans);
  if (select count(*) from public.plans where organization_id = pg_temp.fx('org')) <> before then
    raise exception 'generation preview created plans';
  end if;
  first_result := public.generate_plans_from_template(pg_temp.fx('org'), rev, array['items', 'needs', 'roster', 'notes'],
    plans, preview ->> 'preview_hash', 'f10-generate-batch', '{"timezone":"America/Toronto"}'::jsonb, null);
  replay := public.generate_plans_from_template(pg_temp.fx('org'), rev, array['items', 'needs', 'roster', 'notes'],
    plans, preview ->> 'preview_hash', 'f10-generate-batch', '{"timezone":"America/Toronto"}'::jsonb, null);
  if first_result -> 'plan_ids' <> replay -> 'plan_ids' or not (replay ->> 'replayed')::boolean then
    raise exception 'generation replay differs';
  end if;
  if (select count(*) from public.plans where organization_id = pg_temp.fx('org')) <> before + 3 then
    raise exception 'generation did not create exactly three plans';
  end if;
  if exists (
    select 1 from public.plan_times t
     where t.plan_id in (select (jsonb_array_elements_text(first_result -> 'plan_ids'))::uuid)
       and to_char(t.starts_at at time zone 'America/Toronto', 'HH24:MI') not in ('10:00', '19:00')
  ) then
    raise exception 'a generated time drifted across DST';
  end if;
  if (select count(*) from public.plan_template_applications
       where batch_id = (first_result ->> 'batch_id')::uuid and template_revision = 1) <> 3 then
    raise exception 'generated plans lack provenance';
  end if;
  if exists (select 1 from public.assignments a
      where a.plan_id in (select (jsonb_array_elements_text(first_result -> 'plan_ids'))::uuid)
        and (a.visibility <> 'prepared' or a.status <> 'unconfirmed')) then
    raise exception 'generated roster is not prepared';
  end if;
end $$;

rollback;
