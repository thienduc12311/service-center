-- Media as its own order item type (20261201030000 / 20261201030100):
-- a media item requires its bundle, who may create one (RLS), changing and
-- clearing its media, template save/apply, plan copy and LIVE snapshots.
-- Run as each caller (role + JWT) against the seeded local database.
-- Everything rolls back.
--
-- Seeded people: Jordan (scheduler, legacy = every capability) edits plans;
-- Riley is a member without plans.edit.
begin;

create temporary table mit_fx (k text primary key, id uuid) on commit drop;
grant select, insert on mit_fx to authenticated, service_role;
insert into mit_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('st', 'bbbbbbbb-0000-4000-8000-000000000001'),
  ('jordan', '22222222-2222-4222-8222-222222222222'),
  ('riley', '44444444-4444-4444-8444-444444444444'),
  ('plan', gen_random_uuid()), ('dest', gen_random_uuid()), ('time', gen_random_uuid()),
  ('media', gen_random_uuid()), ('media2', gen_random_uuid()), ('archived', gen_random_uuid()),
  ('other_org', gen_random_uuid()), ('other_media', gen_random_uuid()),
  ('song_item', gen_random_uuid()), ('header', gen_random_uuid());
create or replace function pg_temp.fx(p text) returns uuid language sql stable as $$ select id from mit_fx where k = p $$;
create or replace function pg_temp.as_user(p text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', (select id::text from mit_fx where k = p), true);
  select set_config('request.jwt.claims', json_build_object('sub', (select id::text from mit_fx where k = p), 'role', 'authenticated')::text, true);
$$;

insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by) values
  (pg_temp.fx('plan'), pg_temp.fx('org'), pg_temp.fx('st'), 'Media item plan', '2027-08-01 14:00+00', 'published', pg_temp.fx('jordan')),
  (pg_temp.fx('dest'), pg_temp.fx('org'), pg_temp.fx('st'), 'Media item destination', '2027-08-08 14:00+00', 'draft', pg_temp.fx('jordan'));
insert into public.plan_times (id, plan_id, kind, starts_at, ends_at) values
  (pg_temp.fx('time'), pg_temp.fx('plan'), 'service', '2027-08-01 14:00+00', '2027-08-01 15:30+00');
insert into public.plan_items (id, plan_id, item_type, title, sort_order) values
  (pg_temp.fx('header'), pg_temp.fx('plan'), 'header', 'Welcome', 0);
insert into public.media (id, organization_id, title, duration_seconds) values
  (pg_temp.fx('media'), pg_temp.fx('org'), 'Countdown video', 300),
  (pg_temp.fx('media2'), pg_temp.fx('org'), 'Announcement loop', 120),
  (pg_temp.fx('archived'), pg_temp.fx('org'), 'Old bumper', 30);
update public.media set archived_at = now() where id = pg_temp.fx('archived');
insert into public.organizations (id, name, slug) values (pg_temp.fx('other_org'), 'Media item other', 'mit-other-' || substr(md5(random()::text), 1, 6));
insert into public.media (id, organization_id, title) values (pg_temp.fx('other_media'), pg_temp.fx('other_org'), 'Elsewhere');

-- =========================================== the enum and the constraint ==
do $$ begin
  if not ('media' = any(enum_range(null::public.plan_item_type)::text[])) then
    raise exception 'FAIL: plan_item_type has no media value';
  end if;
  begin
    insert into public.plan_items (plan_id, item_type, title, sort_order)
    values (pg_temp.fx('plan'), 'media', 'No bundle', 9);
    raise exception 'FAIL: a media item without media_id was stored';
  exception when check_violation then null; end;
end $$;

set local role authenticated;

-- ===================================================== a non-editor =====
select pg_temp.as_user('riley');
do $$ begin
  begin
    perform public.add_plan_item(pg_temp.fx('plan'),
      jsonb_build_object('item_type', 'media', 'media_id', pg_temp.fx('media')), null);
    raise exception 'FAIL: a member added a media item';
  exception when no_data_found or insufficient_privilege then null; end;
  begin
    insert into public.plan_items (plan_id, item_type, title, media_id, sort_order)
    values (pg_temp.fx('plan'), 'media', 'Sneaky', pg_temp.fx('media'), 9);
    raise exception 'FAIL: a member inserted a media item directly';
  exception when insufficient_privilege then null; end;
end $$;

-- ========================================================= the editor ====
select pg_temp.as_user('jordan');
do $$
declare r jsonb; r2 jsonb; v_id uuid; hint text;
begin
  -- A media item takes the bundle's title when it has none of its own.
  r := public.add_plan_item(pg_temp.fx('plan'),
    jsonb_build_object('item_type', 'media', 'media_id', pg_temp.fx('media'), 'length_seconds', 300), 'mit-add-1');
  v_id := (r -> 'item' ->> 'id')::uuid;
  insert into mit_fx values ('media_item', v_id);
  if r -> 'item' ->> 'item_type' <> 'media' or r -> 'item' ->> 'title' <> 'Countdown video'
     or (r -> 'item' ->> 'media_id')::uuid <> pg_temp.fx('media') or (r -> 'item' ->> 'length_seconds')::int <> 300 then
    raise exception 'FAIL: media item create %', r -> 'item';
  end if;
  -- The keyed replay returns the same item.
  r2 := public.add_plan_item(pg_temp.fx('plan'),
    jsonb_build_object('item_type', 'media', 'media_id', pg_temp.fx('media'), 'length_seconds', 300), 'mit-add-1');
  if (r2 -> 'item' ->> 'id')::uuid <> v_id or not (r2 ->> 'replayed')::boolean then
    raise exception 'FAIL: media item replay %', r2;
  end if;
  -- A title given is kept.
  r := public.add_plan_item(pg_temp.fx('plan'),
    jsonb_build_object('item_type', 'media', 'media_id', pg_temp.fx('media2'), 'title', 'Notices'), null);
  if r -> 'item' ->> 'title' <> 'Notices' then raise exception 'FAIL: own title replaced'; end if;
  insert into mit_fx values ('media_item2', (r -> 'item' ->> 'id')::uuid);

  begin
    perform public.add_plan_item(pg_temp.fx('plan'), jsonb_build_object('item_type', 'media', 'title', 'Nothing'), null);
    raise exception 'FAIL: media item without media';
  exception when check_violation then null; end;
  begin
    perform public.add_plan_item(pg_temp.fx('plan'),
      jsonb_build_object('item_type', 'media', 'media_id', pg_temp.fx('other_media'), 'title', 'Foreign'), null);
    raise exception 'FAIL: another organization''s media';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.add_plan_item(pg_temp.fx('plan'),
      jsonb_build_object('item_type', 'media', 'media_id', pg_temp.fx('archived')), null);
    raise exception 'FAIL: archived media added';
  exception when invalid_parameter_value then null; end;

  -- Songs and headers still never carry media.
  r := public.add_plan_item(pg_temp.fx('plan'),
    jsonb_build_object('item_type', 'header', 'title', 'Close', 'media_id', pg_temp.fx('media')), null);
  if r -> 'item' ->> 'media_id' is not null then raise exception 'FAIL: header kept media'; end if;

  -- Changing a media item's bundle; it can never be cleared.
  r := public.set_plan_item_media(pg_temp.fx('plan'), pg_temp.fx('media_item2'), pg_temp.fx('media'), null);
  if (r -> 'item' ->> 'media_id')::uuid <> pg_temp.fx('media') then raise exception 'FAIL: media change %', r; end if;
  begin
    perform public.set_plan_item_media(pg_temp.fx('plan'), pg_temp.fx('media_item2'), null, null);
    raise exception 'FAIL: media item cleared';
  exception when invalid_parameter_value then get stacked diagnostics hint = pg_exception_hint;
  end;
  if hint <> 'media_item_needs_media' then raise exception 'FAIL: expected media_item_needs_media, got %', hint; end if;
  begin
    perform public.set_plan_item_media(pg_temp.fx('plan'), pg_temp.fx('header'), pg_temp.fx('media'), null);
    raise exception 'FAIL: header linked media';
  exception when invalid_parameter_value then null; end;
  -- A media item turned into a regular item keeps its media (still valid).
  r := public.update_plan_item(pg_temp.fx('plan'), pg_temp.fx('media_item2'), '{"item_type": "item"}'::jsonb, null);
  if r -> 'item' ->> 'item_type' <> 'item' or (r -> 'item' ->> 'media_id')::uuid <> pg_temp.fx('media') then
    raise exception 'FAIL: media -> item %', r -> 'item';
  end if;
  r := public.update_plan_item(pg_temp.fx('plan'), pg_temp.fx('media_item2'), '{"item_type": "media"}'::jsonb, null);
  if r -> 'item' ->> 'item_type' <> 'media' then raise exception 'FAIL: item with media -> media'; end if;
end $$;

-- A non-editor cannot change a media item's bundle either.
select pg_temp.as_user('riley');
do $$ begin
  begin
    perform public.set_plan_item_media(pg_temp.fx('plan'), pg_temp.fx('media_item'), pg_temp.fx('media2'), null);
    raise exception 'FAIL: a member changed media';
  exception when no_data_found or insufficient_privilege then null; end;
end $$;
select pg_temp.as_user('jordan');

-- ====================================================== LIVE snapshot ====
do $$
declare r jsonb; v_media jsonb;
begin
  r := public.create_live_run(pg_temp.fx('plan'), pg_temp.fx('time'), 'item', 'mit-live', 'tab-a');
  select e into v_media from jsonb_array_elements(r -> 'run' -> 'snapshot') e
   where (e ->> 'id')::uuid = pg_temp.fx('media_item');
  if v_media is null or v_media ->> 'item_type' <> 'media' or (v_media ->> 'length_seconds')::int <> 300 then
    raise exception 'FAIL: media item missing from the LIVE snapshot %', r -> 'run' -> 'snapshot';
  end if;
  -- The run starts on the first runnable item, skipping the header: the media item.
  if (r -> 'run' -> 'snapshot' -> 1 ->> 'id')::uuid <> pg_temp.fx('media_item') then
    raise exception 'FAIL: unexpected order %', r -> 'run' -> 'snapshot';
  end if;
end $$;

-- ============================================== templates: save, apply ==
do $$
declare saved jsonb; content jsonb; preview jsonb; v_rev uuid; v_item public.plan_items; n int;
begin
  saved := public.save_plan_template(pg_temp.fx('org'), null, null, 'plan', pg_temp.fx('st'), 'Media template', null,
    null, pg_temp.fx('plan'), array['items']);
  select r.id, r.content into v_rev, content from public.plan_template_revisions r
   where r.template_id = (saved ->> 'template_id')::uuid and r.revision = 1;
  insert into mit_fx values ('rev', v_rev), ('tpl', (saved ->> 'template_id')::uuid);
  select count(*) into n from jsonb_array_elements(content -> 'items') e
   where e ->> 'item_type' = 'media' and (e ->> 'media_id')::uuid = pg_temp.fx('media');
  if n <> 2 then raise exception 'FAIL: template media items %', content -> 'items'; end if;
  -- Only media items carry media_id in a template.
  if exists (select 1 from jsonb_array_elements(content -> 'items') e where e ->> 'item_type' <> 'media' and e ? 'media_id') then
    raise exception 'FAIL: non-media item kept media_id %', content -> 'items';
  end if;

  preview := public.preview_plan_template_apply(pg_temp.fx('dest'), v_rev, 'append', array['items'], '[]'::jsonb, null);
  perform public.apply_plan_template(pg_temp.fx('dest'), v_rev, 'append', array['items'], preview ->> 'preview_hash',
    '[]'::jsonb, null, (preview ->> 'destination_revision')::bigint, 'mit-apply-1', null);
  select * into v_item from public.plan_items where plan_id = pg_temp.fx('dest') and title = 'Countdown video';
  if v_item.item_type <> 'media' or v_item.media_id <> pg_temp.fx('media') or v_item.length_seconds <> 300 then
    raise exception 'FAIL: applied media item %', to_jsonb(v_item);
  end if;
end $$;

-- A template's media item needs media of this organization.
do $$ begin
  begin
    perform public.save_plan_template(pg_temp.fx('org'), null, null, 'section', null, 'No media', null,
      '{"items": [{"item_type": "media", "title": "Missing"}]}'::jsonb, null, null);
    raise exception 'FAIL: template media item without media';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.save_plan_template(pg_temp.fx('org'), null, null, 'section', null, 'Foreign media', null,
      jsonb_build_object('items', jsonb_build_array(jsonb_build_object('item_type', 'media', 'media_id', pg_temp.fx('other_media')))),
      null, null);
    raise exception 'FAIL: template with another organization''s media';
  exception when invalid_parameter_value then null; end;
end $$;

-- ================================================== plan copy ============
do $$
declare v_copy uuid; v_item public.plan_items;
begin
  v_copy := public.duplicate_plan(pg_temp.fx('plan'), '2027-08-15 14:00+00', 'Media copy', false, 'mit-dup-1');
  select * into v_item from public.plan_items where plan_id = v_copy and title = 'Countdown video';
  if v_item.item_type <> 'media' or v_item.media_id <> pg_temp.fx('media') then
    raise exception 'FAIL: copied media item %', to_jsonb(v_item);
  end if;
  if (select count(*) from public.plan_items where plan_id = v_copy and item_type = 'media')
     <> (select count(*) from public.plan_items where plan_id = pg_temp.fx('plan') and item_type = 'media') then
    raise exception 'FAIL: copy lost media items';
  end if;
end $$;

-- ================================= media archived since: degrade, never fail =
update public.media set archived_at = now() where id = pg_temp.fx('media');
do $$
declare v_copy uuid; v_item public.plan_items; preview jsonb;
begin
  -- The source plan still shows its (now archived) media.
  select * into v_item from public.plan_items where id = pg_temp.fx('media_item');
  if v_item.media_id <> pg_temp.fx('media') then raise exception 'FAIL: archiving changed the source'; end if;

  v_copy := public.duplicate_plan(pg_temp.fx('plan'), '2027-08-22 14:00+00', 'Archived copy', false, 'mit-dup-2');
  select * into v_item from public.plan_items where plan_id = v_copy and title = 'Countdown video';
  if v_item.item_type <> 'item' or v_item.media_id is not null or v_item.length_seconds <> 300 then
    raise exception 'FAIL: archived media copy %', to_jsonb(v_item);
  end if;

  delete from public.plan_items where plan_id = pg_temp.fx('dest');
  preview := public.preview_plan_template_apply(pg_temp.fx('dest'), pg_temp.fx('rev'), 'append', array['items'], '[]'::jsonb, null);
  perform public.apply_plan_template(pg_temp.fx('dest'), pg_temp.fx('rev'), 'append', array['items'], preview ->> 'preview_hash',
    '[]'::jsonb, null, (preview ->> 'destination_revision')::bigint, 'mit-apply-2', null);
  select * into v_item from public.plan_items where plan_id = pg_temp.fx('dest') and title = 'Countdown video';
  if v_item.item_type <> 'item' or v_item.media_id is not null then
    raise exception 'FAIL: archived media template apply %', to_jsonb(v_item);
  end if;
end $$;

select 'media-item-type: all assertions passed';
rollback;
