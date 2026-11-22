-- Flexible plan generation (20261201060000): the batch cap is 52, dates are
-- strictly ascending within two years, a non-editor is denied, and merged
-- songs still resolve after canonical_song_content moved to an indexed lookup.
-- Run against the seeded local database. Everything rolls back.
begin;

create temporary table fpg_fx (k text primary key, id uuid) on commit drop;
grant select, insert, update, delete on fpg_fx to authenticated, service_role;
insert into fpg_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('st', 'bbbbbbbb-0000-4000-8000-000000000001'),
  ('old_song', gen_random_uuid()), ('new_song', gen_random_uuid()),
  ('other_org', gen_random_uuid()), ('other_song', gen_random_uuid());
create or replace function pg_temp.fx(p text) returns uuid language sql stable as
  $$ select id from fpg_fx where k = p $$;
-- N weekly plans from `first`, resolved the way the API does (10:00 Toronto).
create or replace function pg_temp.weekly(n int, first date, step int default 7) returns jsonb language sql stable as $$
  select jsonb_agg(jsonb_build_object(
    'local_date', d, 'title', 'Sunday ' || d,
    'service_date', (d + time '10:00') at time zone 'America/Toronto',
    'times', jsonb_build_array(jsonb_build_object(
      'starts_at', (d + time '10:00') at time zone 'America/Toronto',
      'ends_at', (d + time '11:00') at time zone 'America/Toronto'))) order by g)
  from (select g, first + step * g as d from generate_series(0, n - 1) g) s
$$;
create or replace function pg_temp.preview(plans jsonb) returns jsonb language sql volatile as $$
  select public.preview_plan_generation(pg_temp.fx('org'), (select id from fpg_fx where k = 'rev'), array['items'], plans)
$$;

insert into public.organizations (id, name, slug) values (pg_temp.fx('other_org'), 'FPG other', 'fpg-other-' || left(gen_random_uuid()::text, 8));
insert into public.songs (id, organization_id, title) values
  (pg_temp.fx('old_song'), pg_temp.fx('org'), 'FPG old song'),
  (pg_temp.fx('new_song'), pg_temp.fx('org'), 'FPG new song'),
  (pg_temp.fx('other_song'), pg_temp.fx('other_org'), 'FPG foreign song');

set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

do $$
declare saved jsonb;
begin
  saved := public.save_plan_template(pg_temp.fx('org'), null, null, 'plan', pg_temp.fx('st'), 'FPG weekly', null,
    jsonb_build_object(
      'times', '[{"kind":"service","local_start":"10:00","duration_minutes":60}]'::jsonb,
      'items', jsonb_build_array(
        jsonb_build_object('item_type', 'song', 'title', 'Old', 'song_id', pg_temp.fx('old_song')),
        jsonb_build_object('item_type', 'item', 'title', 'Welcome'))),
    null, null);
  insert into fpg_fx select 'rev', r.id from public.plan_template_revisions r where r.template_id = (saved ->> 'template_id')::uuid;
end $$;

-- ------------------------------------------------------------- the cap ---
do $$
declare preview jsonb; result jsonb; before int;
begin
  begin
    perform pg_temp.preview(pg_temp.weekly(53, '2028-01-02'));
    raise exception '53 plans were accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform pg_temp.preview('[]'::jsonb);
    raise exception 'an empty batch was accepted';
  exception when invalid_parameter_value then null;
  end;

  select count(*) into before from public.plans where organization_id = pg_temp.fx('org');
  preview := pg_temp.preview(pg_temp.weekly(52, '2028-01-02'));
  if jsonb_array_length(preview -> 'plans') <> 52 then raise exception 'preview of 52 plans lost some'; end if;
  result := public.generate_plans_from_template(pg_temp.fx('org'), (select id from fpg_fx where k = 'rev'), array['items'],
    pg_temp.weekly(52, '2028-01-02'), preview ->> 'preview_hash', 'fpg-cap-batch', '{}'::jsonb, null);
  if jsonb_array_length(result -> 'plan_ids') <> 52
     or (select count(*) from public.plans where organization_id = pg_temp.fx('org')) <> before + 52 then
    raise exception 'a 52-plan batch did not create 52 plans';
  end if;
end $$;

-- ------------------------------------------- order, duplicates, range ---
do $$
declare plans jsonb := pg_temp.weekly(3, '2029-01-07');
begin
  -- The same date twice.
  begin
    perform pg_temp.preview(plans || jsonb_build_array(plans -> 2));
    raise exception 'a duplicate date was accepted';
  exception when invalid_parameter_value then null;
  end;
  -- Out of order.
  begin
    perform pg_temp.preview(jsonb_build_array(plans -> 1, plans -> 0, plans -> 2));
    raise exception 'out-of-order dates were accepted';
  exception when invalid_parameter_value then null;
  end;
  -- More than two years from the first date (731 days is the limit).
  begin
    perform pg_temp.preview(pg_temp.weekly(2, '2029-01-07', 732));
    raise exception 'a date beyond two years was accepted';
  exception when invalid_parameter_value then null;
  end;
  if jsonb_array_length(pg_temp.preview(pg_temp.weekly(2, '2029-01-07', 731)) -> 'plans') <> 2 then
    raise exception 'a date exactly two years on was refused';
  end if;
  -- Ordered monthly dates are fine.
  if jsonb_array_length(pg_temp.preview(jsonb_build_array(
      pg_temp.weekly(1, '2029-01-14') -> 0, pg_temp.weekly(1, '2029-02-11') -> 0, pg_temp.weekly(1, '2029-03-11') -> 0)) -> 'plans') <> 3 then
    raise exception 'monthly dates were refused';
  end if;
  -- A refused commit creates nothing.
  begin
    perform public.generate_plans_from_template(pg_temp.fx('org'), (select id from fpg_fx where k = 'rev'), array['items'],
      jsonb_build_array(plans -> 1, plans -> 0), md5('x'), 'fpg-out-of-order', '{}'::jsonb, null);
    raise exception 'an out-of-order commit was accepted';
  exception when invalid_parameter_value then null;
  end;
  if exists (select 1 from public.plan_generation_batches where idempotency_key = 'fpg-out-of-order') then
    raise exception 'a refused batch left a record';
  end if;
end $$;

-- --------------------------------------------- merged songs still resolve --
reset role;
update public.songs set merged_into_song_id = pg_temp.fx('new_song'), archived_at = now() where id = pg_temp.fx('old_song');
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
declare preview jsonb; resolved jsonb;
begin
  preview := pg_temp.preview(pg_temp.weekly(1, '2030-01-06'));
  if preview #>> '{plans,0,preview,items,add,0,song_id}' <> pg_temp.fx('new_song')::text then
    raise exception 'a merged song did not resolve to its replacement: %', preview #> '{plans,0,preview,items,add,0}';
  end if;
  -- Items without a song, and songs the caller cannot see, pass through unchanged, in order.
  resolved := private.canonical_song_content(jsonb_build_object('items', jsonb_build_array(
    jsonb_build_object('title', 'a', 'song_id', pg_temp.fx('other_song')),
    jsonb_build_object('title', 'b'),
    jsonb_build_object('title', 'c', 'song_id', pg_temp.fx('old_song'), 'arrangement_id', ''),
    jsonb_build_object('title', 'd', 'song_id', ''))));
  if resolved #>> '{items,0,song_id}' <> pg_temp.fx('other_song')::text
     or resolved #>> '{items,1,title}' <> 'b' or resolved #> '{items,1}' ? 'song_id'
     or resolved #>> '{items,2,song_id}' <> pg_temp.fx('new_song')::text
     or resolved #>> '{items,3,title}' <> 'd' or jsonb_array_length(resolved -> 'items') <> 4 then
    raise exception 'canonical_song_content changed unrelated items: %', resolved;
  end if;
  if private.canonical_song_content('{"notes":"x"}'::jsonb) <> '{"notes":"x"}'::jsonb
     or private.canonical_song_content('{"items":[]}'::jsonb) <> '{"items":[]}'::jsonb then
    raise exception 'content without items changed';
  end if;
end $$;

-- ------------------------------------------------------ a non-editor ----
-- Sam is a member without plans.edit: no preview, no plans.
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$
declare before int;
begin
  select count(*) into before from public.plans where organization_id = pg_temp.fx('org');
  begin
    perform public.preview_plan_generation(pg_temp.fx('org'), (select id from fpg_fx where k = 'rev'), array['items'], pg_temp.weekly(2, '2031-01-05'));
    raise exception 'a member previewed generated plans';
  exception when insufficient_privilege or no_data_found then null;
  end;
  begin
    perform public.generate_plans_from_template(pg_temp.fx('org'), (select id from fpg_fx where k = 'rev'), array['items'],
      pg_temp.weekly(2, '2031-01-05'), md5('x'), 'fpg-member-batch', '{}'::jsonb, null);
    raise exception 'a member generated plans';
  exception when insufficient_privilege or no_data_found then null;
  end;
  if (select count(*) from public.plans where organization_id = pg_temp.fx('org')) <> before then
    raise exception 'a denied member created plans';
  end if;
end $$;

rollback;
