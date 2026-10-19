-- F14: playback rights, media bundles (and their F13 files), item media links,
-- copy behaviour and stage layouts — exercised as each caller (role +
-- JWT), against the seeded local database. Everything rolls back.
--
-- Seeded people: Jordan (scheduler, legacy = every capability), Sam and Riley
-- (members). Sam is given scheduling.manage on the service type below, which
-- makes Sam a plan *leader* (reads layouts) without plans.edit (cannot write).
begin;

create temporary table f14_fx (k text primary key, id uuid) on commit drop;
grant select, insert on f14_fx to authenticated, service_role;
insert into f14_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('st', 'bbbbbbbb-0000-4000-8000-000000000001'),
  ('band', 'cccccccc-0000-4000-8000-000000000001'),
  ('jordan', '22222222-2222-4222-8222-222222222222'),
  ('sam', '33333333-3333-4333-8333-333333333333'),
  ('riley', '44444444-4444-4444-8444-444444444444'),
  ('plan', gen_random_uuid()), ('plan2', gen_random_uuid()),
  ('item', gen_random_uuid()), ('header', gen_random_uuid()), ('item_b', gen_random_uuid()),
  ('other_org', gen_random_uuid()), ('other_media', gen_random_uuid()), ('other_person', gen_random_uuid());
create or replace function pg_temp.fx(p text) returns uuid language sql stable as $$ select id from f14_fx where k = p $$;
create temporary table f14_v (k text primary key, id uuid, rev bigint) on commit drop;
grant all on f14_v to authenticated, service_role;
create or replace function pg_temp.v(p text) returns uuid language sql stable as $$ select id from f14_v where k = p $$;
create or replace function pg_temp.as_user(p text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', (select id::text from f14_fx where k = p), true);
  select set_config('request.jwt.claims', json_build_object('sub', (select id::text from f14_fx where k = p), 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.person(p text) returns uuid language sql stable as $$
  select pe.id from public.people pe where pe.organization_id = pg_temp.fx('org') and pe.profile_id = pg_temp.fx(p)
$$;

insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by) values
  (pg_temp.fx('plan'), pg_temp.fx('org'), pg_temp.fx('st'), 'F14 Plan', '2027-07-04 14:00+00', 'published', pg_temp.fx('jordan')),
  (pg_temp.fx('plan2'), pg_temp.fx('org'), pg_temp.fx('st'), 'F14 Copy target', '2027-07-11 14:00+00', 'published', pg_temp.fx('jordan'));
insert into public.plan_items (id, plan_id, item_type, title, sort_order) values
  (pg_temp.fx('item'), pg_temp.fx('plan'), 'item', 'Countdown', 0),
  (pg_temp.fx('header'), pg_temp.fx('plan'), 'header', 'Worship', 1),
  (pg_temp.fx('item_b'), pg_temp.fx('plan'), 'item', 'Announcements', 2);
-- Riley: released request on the band. Sam: leader via scheduling.manage.
insert into public.assignments (plan_id, person_id, user_id, team_id, status, visibility, created_by)
select pg_temp.fx('plan'), pg_temp.person('riley'), pg_temp.fx('riley'), pg_temp.fx('band'), 'confirmed', 'released', pg_temp.fx('jordan');
insert into public.access_grants (organization_id, user_id, capability, scope_type, service_type_id)
values (pg_temp.fx('org'), pg_temp.fx('sam'), 'scheduling.manage', 'service_type', pg_temp.fx('st'));
-- Another organization with its own media and person.
insert into public.organizations (id, name, slug) values (pg_temp.fx('other_org'), 'F14 Other', 'f14-other-' || substr(md5(random()::text), 1, 6));
insert into public.media (id, organization_id, title) values (pg_temp.fx('other_media'), pg_temp.fx('other_org'), 'Elsewhere');
insert into public.people (id, organization_id, first_name, last_name) values (pg_temp.fx('other_person'), pg_temp.fx('other_org'), 'Other', 'Person');

set local role authenticated;

-- ===================================================== media bundles =====
select pg_temp.as_user('sam');
do $$ begin
  begin
    insert into public.media (organization_id, title) values (pg_temp.fx('org'), 'Sam media');
    raise exception 'FAIL: member created media';
  exception when insufficient_privilege then null; end;
  begin
    perform public.save_file_content('media', pg_temp.fx('other_media'), null, null, 'link', 'x', 'https://e.example/x',
      null, 'video', 'organization', '{}', '{}', 'k-sam-media');
    raise exception 'FAIL: member saved a file on media';
  exception when no_data_found or insufficient_privilege then null; end;
end $$;

select pg_temp.as_user('jordan');
do $$
declare v_id uuid; v_row public.media; r jsonb;
begin
  insert into public.media (organization_id, title, creator, themes, tags)
  values (pg_temp.fx('org'), '  Advent countdown ', ' Studio ', array['Advent', ' Advent', 'Hope'], array['video'])
  returning * into v_row;
  if v_row.title <> 'Advent countdown' or v_row.creator <> 'Studio' or v_row.themes <> array['Advent', 'Hope']
     or v_row.revision <> 1 or v_row.created_by <> pg_temp.fx('jordan') then
    raise exception 'FAIL: media normalisation %', to_jsonb(v_row);
  end if;
  insert into f14_v values ('media', v_row.id, v_row.revision);
  update public.media set notes = 'Use before service' where id = v_row.id returning * into v_row;
  if v_row.revision <> 2 or v_row.updated_by <> pg_temp.fx('jordan') then
    raise exception 'FAIL: media revision/updated_by';
  end if;

  -- Files owned by the bundle (F13 model): an org link, a leaders-only link, an upload intent.
  r := public.save_file_content('media', v_row.id, null, null, 'link', 'Promo video', 'https://video.example/promo',
    null, 'video', 'organization', '{}', '{}', 'k-media-link-1');
  insert into f14_v values ('media_link', (r -> 'attachment' ->> 'id')::uuid, null);
  if (r -> 'attachment' ->> 'media_id')::uuid <> v_row.id or r -> 'attachment' ->> 'owner_kind' <> 'media' then
    raise exception 'FAIL: media link owner %', r;
  end if;
  r := public.save_file_content('media', v_row.id, null, null, 'link', 'Leaders cue', 'https://video.example/cue',
    null, 'video', 'leaders', '{}', '{}', 'k-media-link-2');
  insert into f14_v values ('media_leaders', (r -> 'attachment' ->> 'id')::uuid, null);
  r := public.create_file_upload_intent('media', v_row.id, null, null, 'thumb.png', 'image/png', 100,
    'Thumbnail', 'image', 'organization', '{}', '{}', 'k-media-thumb');
  insert into f14_v values ('thumb', (r -> 'attachment' ->> 'id')::uuid, null);
  if (r -> 'attachment' ->> 'media_id')::uuid <> v_row.id then
    raise exception 'FAIL: media upload owner';
  end if;
  -- Replay of the same key resolves to the same media file.
  r := public.create_file_upload_intent('media', v_row.id, null, null, 'thumb.png', 'image/png', 100,
    'Thumbnail', 'image', 'organization', '{}', '{}', 'k-media-thumb');
  if not (r ->> 'replayed')::boolean then raise exception 'FAIL: media intent replay'; end if;
  begin
    perform public.save_file_content('media', v_row.id, null, null, 'link', 'Scheduled', 'https://e.example/s',
      null, 'video', 'scheduled', '{}', '{}', 'k-media-sched');
    raise exception 'FAIL: scheduled audience on media';
  exception when check_violation then null; end;
  -- Thumbnail must be a finished image of this bundle.
  begin
    update public.media set thumbnail_file_id = pg_temp.v('thumb') where id = v_row.id;
    raise exception 'FAIL: unfinished thumbnail accepted';
  exception when invalid_parameter_value then null; end;
  begin
    update public.media set thumbnail_file_id = pg_temp.v('media_link') where id = v_row.id;
    raise exception 'FAIL: non-image thumbnail accepted';
  exception when invalid_parameter_value then null; end;
  -- A media file cannot be linked onto a plan like a library file.
  begin
    perform public.link_file_to_plan(pg_temp.fx('plan'), null, pg_temp.v('media_link'), false);
    raise exception 'FAIL: media file linked as a plan file';
  exception when invalid_parameter_value then null; end;
end $$;

select pg_temp.as_user('sam');
do $$ begin
  if not exists (select 1 from public.media where id = pg_temp.v('media')) then
    raise exception 'FAIL: member cannot read media';
  end if;
  if exists (select 1 from public.media where id = pg_temp.fx('other_media')) then
    raise exception 'FAIL: other organization media visible';
  end if;
  if not exists (select 1 from public.attachments where id = pg_temp.v('media_link')) then
    raise exception 'FAIL: member cannot read an organization media file';
  end if;
  if exists (select 1 from public.attachments where id = pg_temp.v('media_leaders')) then
    raise exception 'FAIL: member reads a leaders-only media file';
  end if;
  update public.media set title = 'hijack' where id = pg_temp.v('media');
  if (select title from public.media where id = pg_temp.v('media')) = 'hijack' then
    raise exception 'FAIL: member updated media';
  end if;
  delete from public.media where id = pg_temp.v('media');
  if not exists (select 1 from public.media where id = pg_temp.v('media')) then
    raise exception 'FAIL: member deleted media';
  end if;
end $$;

-- =================================================== playback rights =====
select pg_temp.as_user('sam');
do $$ begin
  begin
    perform public.set_file_playback_rights(pg_temp.v('media_link'), 1, 'stream_only');
    raise exception 'FAIL: member changed playback rights';
  exception when insufficient_privilege then null; end;
end $$;
select pg_temp.as_user('jordan');
do $$
declare r jsonb; v_rev bigint;
begin
  begin
    perform public.set_file_playback_rights(pg_temp.v('media_link'), 1, 'stream_only');
    raise exception 'FAIL: rights on a link';
  exception when invalid_parameter_value then null; end;
  select revision into v_rev from public.attachments where id = pg_temp.v('thumb');
  begin
    perform public.set_file_playback_rights(pg_temp.v('thumb'), v_rev + 5, 'stream_only');
    raise exception 'FAIL: stale rights change';
  exception when sqlstate 'PT409' then null; end;
  r := public.set_file_playback_rights(pg_temp.v('thumb'), v_rev, 'stream_only');
  if r ->> 'playback_rights' <> 'stream_only' or (r ->> 'revision')::bigint <> v_rev + 1 then
    raise exception 'FAIL: rights not saved %', r;
  end if;
  begin
    perform public.set_file_playback_rights(pg_temp.v('thumb'), v_rev + 1, 'nope');
    raise exception 'FAIL: unknown rights';
  exception when invalid_parameter_value then null; end;
end $$;

-- ==================================================== item media links =====
select pg_temp.as_user('sam');
do $$ begin
  begin
    perform public.set_plan_item_media(pg_temp.fx('plan'), pg_temp.fx('item'), pg_temp.v('media'), null);
    raise exception 'FAIL: member linked media';
  exception when no_data_found or insufficient_privilege then null; end;
end $$;

select pg_temp.as_user('jordan');
do $$
declare r jsonb; v_rev bigint; v_rev2 bigint; v_archived uuid;
begin
  select content_revision into v_rev from public.plans where id = pg_temp.fx('plan');
  r := public.set_plan_item_media(pg_temp.fx('plan'), pg_temp.fx('item'), pg_temp.v('media'), v_rev);
  if (r -> 'item' ->> 'media_id')::uuid <> pg_temp.v('media') or (r ->> 'content_revision')::bigint <= v_rev then
    raise exception 'FAIL: link media %', r;
  end if;
  begin
    perform public.set_plan_item_media(pg_temp.fx('plan'), pg_temp.fx('item'), null, v_rev);
    raise exception 'FAIL: stale media link';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform public.set_plan_item_media(pg_temp.fx('plan'), pg_temp.fx('header'), pg_temp.v('media'), null);
    raise exception 'FAIL: media on a header';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.set_plan_item_media(pg_temp.fx('plan'), pg_temp.fx('item_b'), pg_temp.fx('other_media'), null);
    raise exception 'FAIL: other organization media linked';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.set_plan_item_media(pg_temp.fx('plan2'), pg_temp.fx('item_b'), pg_temp.v('media'), null);
    raise exception 'FAIL: item of another plan';
  exception when no_data_found then null; end;

  -- Archive: new links refused, the existing one stays.
  insert into public.media (organization_id, title, archive_on) values (pg_temp.fx('org'), 'Old video', current_date - 1)
  returning id into v_archived;
  insert into f14_v values ('archived_media', v_archived, null);
  begin
    perform public.set_plan_item_media(pg_temp.fx('plan'), pg_temp.fx('item_b'), v_archived, null);
    raise exception 'FAIL: media past its archive date linked';
  exception when invalid_parameter_value then null; end;
  update public.media set archived_at = now() where id = pg_temp.v('media');
  if (select media_id from public.plan_items where id = pg_temp.fx('item')) is distinct from pg_temp.v('media') then
    raise exception 'FAIL: archiving broke an existing reference';
  end if;
  -- An unrelated edit of the item keeps its archived media.
  perform public.update_plan_item(pg_temp.fx('plan'), pg_temp.fx('item'), '{"title": "Countdown (5 min)"}'::jsonb, null);
  if (select media_id from public.plan_items where id = pg_temp.fx('item')) is distinct from pg_temp.v('media') then
    raise exception 'FAIL: item edit dropped archived media';
  end if;
  -- Copy drops archived media; a live bundle carries over.
  perform private.copy_plan_children(pg_temp.fx('plan'), pg_temp.fx('plan2'), true, false, false, null);
  if exists (select 1 from public.plan_items where plan_id = pg_temp.fx('plan2') and media_id is not null) then
    raise exception 'FAIL: copy carried archived media';
  end if;
  update public.media set archived_at = null where id = pg_temp.v('media');
  delete from public.plan_items where plan_id = pg_temp.fx('plan2');
  perform private.copy_plan_children(pg_temp.fx('plan'), pg_temp.fx('plan2'), true, false, false, null);
  if not exists (select 1 from public.plan_items where plan_id = pg_temp.fx('plan2') and media_id = pg_temp.v('media')) then
    raise exception 'FAIL: copy dropped live media';
  end if;
  -- Deleting a used bundle is refused (archive instead).
  begin
    delete from public.media where id = pg_temp.v('media');
    raise exception 'FAIL: used media deleted';
  exception when foreign_key_violation then null; end;
  -- Changing the item to a header drops its media.
  perform public.update_plan_item(pg_temp.fx('plan2'),
    (select id from public.plan_items where plan_id = pg_temp.fx('plan2') and media_id is not null limit 1),
    '{"item_type": "header"}'::jsonb, null);
  if exists (select 1 from public.plan_items where plan_id = pg_temp.fx('plan2') and media_id is not null) then
    raise exception 'FAIL: header kept media';
  end if;
  -- An unused bundle deletes with its files.
  delete from public.media where id = v_archived;
end $$;

-- ====================================================== stage templates =====
select pg_temp.as_user('riley');
do $$ begin
  begin
    insert into public.stage_layout_templates (organization_id, name) values (pg_temp.fx('org'), 'Riley stage');
    raise exception 'FAIL: member created a template';
  exception when insufficient_privilege then null; end;
end $$;

select pg_temp.as_user('jordan');
do $$
declare v_id uuid;
begin
  insert into public.stage_layout_templates (organization_id, name, background, objects)
  values (pg_temp.fx('org'), ' Main stage ', 'thrust',
    '[{"id":"drums","kind":"gear","x":0.5,"y":0.2,"w":0.2,"h":0.15,"rotation":0,"label":"Drums","color":"#334455"}]')
  returning id into v_id;
  insert into f14_v values ('template', v_id, 1);
  if (select name from public.stage_layout_templates where id = v_id) <> 'Main stage' then
    raise exception 'FAIL: template name not trimmed';
  end if;
  begin
    insert into public.stage_layout_templates (organization_id, name, objects) values (pg_temp.fx('org'), 'People',
      jsonb_build_array(jsonb_build_object('id', 'p', 'kind', 'person', 'x', 0.5, 'y', 0.5, 'w', 0.1, 'h', 0.1,
        'rotation', 0, 'label', 'Riley', 'color', null, 'person_id', pg_temp.person('riley'))));
    raise exception 'FAIL: person on a template';
  exception when check_violation then null; end;
  begin
    insert into public.stage_layout_templates (organization_id, name, objects) values (pg_temp.fx('org'), 'Off stage',
      '[{"id":"a","kind":"gear","x":1.5,"y":0.2,"w":0.2,"h":0.15,"rotation":0,"label":"Amp","color":null}]');
    raise exception 'FAIL: coordinates outside the stage';
  exception when check_violation then null; end;
  begin
    insert into public.stage_layout_templates (organization_id, name, objects) values (pg_temp.fx('org'), 'Dupes',
      '[{"id":"a","kind":"gear","x":0.5,"y":0.2,"w":0.2,"h":0.15,"rotation":0,"label":"A","color":null},
        {"id":"a","kind":"gear","x":0.5,"y":0.2,"w":0.2,"h":0.15,"rotation":0,"label":"B","color":null}]');
    raise exception 'FAIL: duplicate object ids';
  exception when check_violation then null; end;
  begin
    insert into public.stage_layout_templates (organization_id, name, objects) values (pg_temp.fx('org'), 'Colour',
      '[{"id":"a","kind":"gear","x":0.5,"y":0.2,"w":0.2,"h":0.15,"rotation":0,"label":"A","color":"red; x"}]');
    raise exception 'FAIL: unsafe colour';
  exception when check_violation then null; end;
end $$;

select pg_temp.as_user('riley');
do $$ begin
  if not exists (select 1 from public.stage_layout_templates where id = pg_temp.v('template')) then
    raise exception 'FAIL: member cannot read templates';
  end if;
end $$;

-- ======================================================== plan layouts =====
select pg_temp.as_user('jordan');
do $$
declare v_id uuid; v_rev bigint; v_objects jsonb;
begin
  v_objects := jsonb_build_array(
    jsonb_build_object('id', 'drums', 'kind', 'gear', 'x', 0.5, 'y', 0.2, 'w', 0.2, 'h', 0.15, 'rotation', 0, 'label', 'Drums', 'color', null),
    jsonb_build_object('id', 'riley', 'kind', 'person', 'x', 0.5, 'y', 0.3, 'w', 0.08, 'h', 0.06, 'rotation', 30,
      'label', 'Riley', 'color', null, 'person_id', pg_temp.person('riley')));
  insert into public.plan_stage_layouts (organization_id, plan_id, template_id, name, background, objects)
  values (pg_temp.fx('org'), pg_temp.fx('plan'), pg_temp.v('template'), 'Sunday stage', 'thrust', v_objects)
  returning id, revision into v_id, v_rev;
  insert into f14_v values ('layout', v_id, v_rev);
  begin
    insert into public.plan_stage_layouts (organization_id, plan_id, name, objects) values (pg_temp.fx('org'), pg_temp.fx('plan'), 'Foreign',
      jsonb_build_array(jsonb_build_object('id', 'x', 'kind', 'person', 'x', 0.5, 'y', 0.5, 'w', 0.1, 'h', 0.1,
        'rotation', 0, 'label', 'Other', 'color', null, 'person_id', pg_temp.fx('other_person'))));
    raise exception 'FAIL: another organization''s person placed';
  exception when invalid_parameter_value then null; end;
  begin
    insert into public.plan_stage_layouts (organization_id, plan_id, name) values (pg_temp.fx('other_org'), pg_temp.fx('plan'), 'Wrong org');
    raise exception 'FAIL: layout with a mismatched organization';
  exception when insufficient_privilege or foreign_key_violation then null; end;
  begin
    insert into public.plan_stage_layouts (organization_id, plan_id, name, objects) values (pg_temp.fx('org'), pg_temp.fx('plan'), 'Bad',
      '[{"id":"g","kind":"gear","x":0.5,"y":0.5,"w":0.1,"h":0.1,"rotation":0,"label":"Gear","color":null,"person_id":"x"}]');
    raise exception 'FAIL: gear carrying a person id';
  exception when check_violation then null; end;
  update public.plan_stage_layouts set name = 'Sunday stage v2' where id = v_id;
  if (select revision from public.plan_stage_layouts where id = v_id) <> v_rev + 1 then
    raise exception 'FAIL: layout revision not bumped';
  end if;
  -- Staffing changes never move the snapshot.
  update public.assignments set status = 'declined' where plan_id = pg_temp.fx('plan') and person_id = pg_temp.person('riley');
  if (select objects from public.plan_stage_layouts where id = v_id) <> v_objects then
    raise exception 'FAIL: staffing change rewrote the layout';
  end if;
  -- Deleting the template keeps the plan layout's own copy.
  delete from public.stage_layout_templates where id = pg_temp.v('template');
  if (select template_id from public.plan_stage_layouts where id = v_id) is not null
     or (select objects from public.plan_stage_layouts where id = v_id) <> v_objects then
    raise exception 'FAIL: template delete changed the plan layout';
  end if;
  -- At most ten per plan.
  for i in 2..10 loop
    insert into public.plan_stage_layouts (organization_id, plan_id, name) values (pg_temp.fx('org'), pg_temp.fx('plan'), 'L' || i);
  end loop;
  begin
    insert into public.plan_stage_layouts (organization_id, plan_id, name) values (pg_temp.fx('org'), pg_temp.fx('plan'), 'L11');
    raise exception 'FAIL: eleventh layout';
  exception when invalid_parameter_value then null; end;
end $$;

-- Sam leads (scheduling.manage) but does not edit: reads, cannot write.
select pg_temp.as_user('sam');
do $$ begin
  if not exists (select 1 from public.plan_stage_layouts where id = pg_temp.v('layout')) then
    raise exception 'FAIL: leader cannot read the layout';
  end if;
  update public.plan_stage_layouts set name = 'Sam edit' where id = pg_temp.v('layout');
  if (select name from public.plan_stage_layouts where id = pg_temp.v('layout')) = 'Sam edit' then
    raise exception 'FAIL: leader edited the layout';
  end if;
  begin
    insert into public.plan_stage_layouts (organization_id, plan_id, name) values (pg_temp.fx('org'), pg_temp.fx('plan2'), 'Sam');
    raise exception 'FAIL: leader created a layout';
  exception when insufficient_privilege then null; end;
end $$;

-- Riley is scheduled but neither edits nor leads: sees no layout (names of people not yet asked could be on it).
select pg_temp.as_user('riley');
do $$ begin
  if exists (select 1 from public.plan_stage_layouts where plan_id = pg_temp.fx('plan')) then
    raise exception 'FAIL: member reads plan layouts';
  end if;
  delete from public.plan_stage_layouts where id = pg_temp.v('layout');
end $$;
reset role;
do $$ begin
  if not exists (select 1 from public.plan_stage_layouts where id = pg_temp.v('layout')) then
    raise exception 'FAIL: member deleted a layout';
  end if;
end $$;

-- Plan deletion removes its layouts.
delete from public.plans where id = pg_temp.fx('plan2');

select 'f14-rehearsal-media: all checks passed' as result;
rollback;
