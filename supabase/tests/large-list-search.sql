-- Large-list UX §5 (20261129000000_large_list_search.sql):
--   * search folds accents/case/đ ("nguyen" finds "Nguyễn", "chua" finds "Chúa"),
--     splits into words that must all match, and treats %, _ and \ literally;
--   * list_curated_songs: last_used/most_used sorts, service_type_id,
--     not_scheduled_since, plan_id -> in_plan, usage_count, total;
--   * list_media: archived filter before the cap, exact usage counts, total/truncated;
--   * people views: search_text (owner view adds contact email), listed.
-- Run against the seeded local database. Everything rolls back.
begin;

create temporary table lls_fx (k text primary key, id uuid not null) on commit drop;
grant select on lls_fx to authenticated;
insert into lls_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('sunday', 'bbbbbbbb-0000-4000-8000-000000000001'),
  ('midweek', 'bbbbbbbb-0000-4000-8000-000000000002'),
  ('chua', gen_random_uuid()), ('nguyen', gen_random_uuid()), ('percent', gen_random_uuid()),
  ('underscore', gen_random_uuid()), ('backslash', gen_random_uuid()), ('never', gen_random_uuid()),
  ('plan_old', gen_random_uuid()), ('plan_sun1', gen_random_uuid()), ('plan_sun2', gen_random_uuid()),
  ('plan_mid', gen_random_uuid()), ('plan_future', gen_random_uuid()),
  ('media_live', gen_random_uuid()), ('media_gone', gen_random_uuid()), ('media_dated', gen_random_uuid()),
  ('person', gen_random_uuid());
create or replace function pg_temp.fx(p text) returns uuid language sql stable as $$ select id from lls_fx where k = p $$;

-- Titles carry a marker ("LLS") so assertions ignore seed songs.
insert into public.songs (id, organization_id, title, author, ccli_number) values
  (pg_temp.fx('chua'), pg_temp.fx('org'), 'LLS Chúa Là Tình Yêu', 'Đặng Văn An', '7001'),
  (pg_temp.fx('nguyen'), pg_temp.fx('org'), 'LLS Ơn Trời', 'Nguyễn Thị Bích', '7002'),
  (pg_temp.fx('percent'), pg_temp.fx('org'), 'LLS 100% Grace', null, null),
  (pg_temp.fx('underscore'), pg_temp.fx('org'), 'LLS a_b Song', null, null),
  (pg_temp.fx('backslash'), pg_temp.fx('org'), 'LLS back\slash', null, null),
  (pg_temp.fx('never'), pg_temp.fx('org'), 'LLS Never Played', null, null);

insert into public.plans (id, organization_id, service_type_id, title, service_date, status) values
  (pg_temp.fx('plan_old'), pg_temp.fx('org'), pg_temp.fx('sunday'), 'LLS Old', now() - interval '20 weeks', 'draft'),
  (pg_temp.fx('plan_sun1'), pg_temp.fx('org'), pg_temp.fx('sunday'), 'LLS Sunday 1', now() - interval '3 weeks', 'draft'),
  (pg_temp.fx('plan_sun2'), pg_temp.fx('org'), pg_temp.fx('sunday'), 'LLS Sunday 2', now() - interval '1 week', 'draft'),
  (pg_temp.fx('plan_mid'), pg_temp.fx('org'), pg_temp.fx('midweek'), 'LLS Thứ Tư', now() - interval '2 weeks', 'draft'),
  (pg_temp.fx('plan_future'), pg_temp.fx('org'), pg_temp.fx('sunday'), 'LLS Future', now() + interval '2 weeks', 'draft');

-- chua: sun1, sun2 (twice in sun2), mid -> 3 distinct plans in 12 weeks (2 Sunday), last = future.
-- nguyen: old, mid -> 1 plan in 12 weeks (0 Sunday), last = mid.
-- percent: old only -> 0 in 12 weeks.
insert into public.plan_items (plan_id, item_type, title, sort_order, song_id) values
  (pg_temp.fx('plan_sun1'), 'song', 'x', 1, pg_temp.fx('chua')),
  (pg_temp.fx('plan_sun2'), 'song', 'x', 1, pg_temp.fx('chua')),
  (pg_temp.fx('plan_sun2'), 'song', 'x', 2, pg_temp.fx('chua')),
  (pg_temp.fx('plan_mid'), 'song', 'x', 1, pg_temp.fx('chua')),
  (pg_temp.fx('plan_future'), 'song', 'x', 1, pg_temp.fx('chua')),
  (pg_temp.fx('plan_old'), 'song', 'x', 1, pg_temp.fx('nguyen')),
  (pg_temp.fx('plan_mid'), 'song', 'x', 2, pg_temp.fx('nguyen')),
  (pg_temp.fx('plan_old'), 'song', 'x', 2, pg_temp.fx('percent'));

insert into public.media (id, organization_id, title, archived_at, archive_on) values
  (pg_temp.fx('media_live'), pg_temp.fx('org'), 'LLS Phim Giáng Sinh', null, null),
  (pg_temp.fx('media_gone'), pg_temp.fx('org'), 'LLS Archived Clip', now(), null),
  (pg_temp.fx('media_dated'), pg_temp.fx('org'), 'LLS Dated Clip', null, current_date - 1);
insert into public.plan_items (plan_id, item_type, title, sort_order, media_id) values
  (pg_temp.fx('plan_sun1'), 'item', 'm', 5, pg_temp.fx('media_live')),
  (pg_temp.fx('plan_sun2'), 'item', 'm', 5, pg_temp.fx('media_live')),
  (pg_temp.fx('plan_sun2'), 'item', 'm', 6, pg_temp.fx('media_live'));
-- 210 more active bundles so the 200 cap is exceeded.
insert into public.media (organization_id, title)
select pg_temp.fx('org'), 'LLS Bulk ' || lpad(g::text, 3, '0') from generate_series(1, 210) g;

insert into public.people (id, organization_id, first_name, last_name, campus, email)
values (pg_temp.fx('person'), pg_temp.fx('org'), 'Trần', 'Nguyễn Đức', 'Hà Nội', 'duc.LLS@example.test');

-- ------------------------------------------------------------- folding --
do $$ begin
  if private.search_fold('Đặng NGUYỄN Chúa') <> 'dang nguyen chua' then
    raise exception 'search_fold: got %', private.search_fold('Đặng NGUYỄN Chúa'); end if;
  if private.search_like_patterns('  Chúa   tình ') <> array['%chua%', '%tinh%'] then
    raise exception 'patterns: got %', private.search_like_patterns('  Chúa   tình '); end if;
  if private.search_like_patterns('50%_\') <> array['%50\%\_\\%'] then
    raise exception 'escaped patterns: got %', private.search_like_patterns('50%_\'); end if;
  if private.search_like_patterns('   ') <> '{}'::text[] or private.search_like_patterns(null) <> '{}'::text[] then
    raise exception 'blank query must give no patterns'; end if;
end $$;

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

create or replace function pg_temp.song_titles(p jsonb) returns text[] language sql as $$
  select coalesce(array_agg(e->>'title' order by ord), '{}')
    from jsonb_array_elements(public.list_curated_songs('aaaaaaaa-0000-4000-8000-000000000001', p)->'data') with ordinality as t(e, ord)
   where e->>'title' like 'LLS %';
$$;
create or replace function pg_temp.song_row(p jsonb, id uuid) returns jsonb language sql as $$
  select e from jsonb_array_elements(public.list_curated_songs('aaaaaaaa-0000-4000-8000-000000000001', p)->'data') e
   where (e->>'id')::uuid = id;
$$;

-- ---------------------------------------------------------- song search --
do $$ begin
  if pg_temp.song_titles('{"q":"chua","per_page":200}') <> array['LLS Chúa Là Tình Yêu'] then
    raise exception '"chua" should find Chúa: %', pg_temp.song_titles('{"q":"chua","per_page":200}'); end if;
  if pg_temp.song_titles('{"q":"nguyen","per_page":200}') <> array['LLS Ơn Trời'] then
    raise exception '"nguyen" should find the song by Nguyễn (author): %', pg_temp.song_titles('{"q":"nguyen","per_page":200}'); end if;
  if pg_temp.song_titles('{"q":"dang an","per_page":200}') <> array['LLS Chúa Là Tình Yêu'] then
    raise exception '"dang an" should find the song by Đặng Văn An'; end if;
  if pg_temp.song_titles('{"q":"7002","per_page":200}') <> array['LLS Ơn Trời'] then
    raise exception 'CCLI search failed'; end if;
  -- Multi-word AND, any order.
  if pg_temp.song_titles('{"q":"yeu chua","per_page":200}') <> array['LLS Chúa Là Tình Yêu'] then
    raise exception 'words in any order must all match'; end if;
  if pg_temp.song_titles('{"q":"chua nguyen","per_page":200}') <> '{}'::text[] then
    raise exception 'every word must match (AND)'; end if;
  -- Wildcards are literal.
  if pg_temp.song_titles('{"q":"%","per_page":200}') <> array['LLS 100% Grace'] then
    raise exception '%% must be literal: %', pg_temp.song_titles('{"q":"%","per_page":200}'); end if;
  if pg_temp.song_titles('{"q":"a_b","per_page":200}') <> array['LLS a_b Song'] then
    raise exception '_ must be literal'; end if;
  if pg_temp.song_titles('{"q":"_","per_page":200}') <> array['LLS a_b Song'] then
    raise exception 'lone _ must be literal'; end if;
  if pg_temp.song_titles(jsonb_build_object('q', 'k\s', 'per_page', 200)) <> array['LLS back\slash'] then
    raise exception 'backslash must be literal'; end if;
end $$;

-- ------------------------------------------------- song usage and sorts --
do $$
declare r jsonb;
begin
  r := pg_temp.song_row('{"per_page":200}', pg_temp.fx('chua'));
  if (r->>'usage_count')::int <> 3 then raise exception 'chua usage_count: %', r->>'usage_count'; end if;
  if (r->>'in_plan')::boolean then raise exception 'in_plan must be false without plan_id'; end if;
  if (r->>'last_scheduled_at')::timestamptz < now() then raise exception 'last_scheduled_at stays org-wide (future plan)'; end if;
  if r ? 'search_text' then raise exception 'search_text must not be returned'; end if;
  if jsonb_typeof(r->'arrangements') <> 'array' then raise exception 'arrangements missing'; end if;

  r := pg_temp.song_row(jsonb_build_object('per_page', 200, 'service_type_id', pg_temp.fx('sunday')), pg_temp.fx('chua'));
  if (r->>'usage_count')::int <> 2 then raise exception 'chua Sunday usage_count: %', r->>'usage_count'; end if;
  r := pg_temp.song_row(jsonb_build_object('per_page', 200, 'service_type_id', pg_temp.fx('sunday')), pg_temp.fx('nguyen'));
  if (r->>'usage_count')::int <> 0 then raise exception 'nguyen Sunday usage_count: %', r->>'usage_count'; end if;
  if (r->>'last_scheduled_at')::timestamptz > now() - interval '13 days' then
    raise exception 'service_type_id must not scope last_scheduled_at'; end if;
  r := pg_temp.song_row('{"per_page":200}', pg_temp.fx('percent'));
  if (r->>'usage_count')::int <> 0 then raise exception 'plans older than 12 weeks must not count'; end if;

  r := pg_temp.song_row(jsonb_build_object('per_page', 200, 'plan_id', pg_temp.fx('plan_mid')), pg_temp.fx('nguyen'));
  if not (r->>'in_plan')::boolean then raise exception 'in_plan must be true for a song in that plan'; end if;
  r := pg_temp.song_row(jsonb_build_object('per_page', 200, 'plan_id', pg_temp.fx('plan_mid')), pg_temp.fx('percent'));
  if (r->>'in_plan')::boolean then raise exception 'in_plan must be false for a song not in that plan'; end if;
end $$;

do $$
declare t text[];
begin
  t := pg_temp.song_titles('{"sort":"most_used","per_page":200}');
  if t[1:2] <> array['LLS Chúa Là Tình Yêu', 'LLS Ơn Trời'] then raise exception 'most_used order: %', t; end if;
  -- Ties (0 uses) fall back to title.
  if t[3:] <> array['LLS 100% Grace', 'LLS a_b Song', 'LLS back\slash', 'LLS Never Played'] then raise exception 'most_used tie order: %', t; end if;

  t := pg_temp.song_titles('{"sort":"last_used","per_page":200}');
  if t <> array['LLS Chúa Là Tình Yêu', 'LLS Ơn Trời', 'LLS 100% Grace', 'LLS a_b Song', 'LLS back\slash', 'LLS Never Played'] then
    raise exception 'last_used order (never-scheduled last): %', t; end if;

  -- not_scheduled_since: chua (future) and nguyen (2 weeks ago) are excluded at 4 weeks ago; percent (20 weeks) and never stay.
  t := pg_temp.song_titles(jsonb_build_object('per_page', 200, 'not_scheduled_since', now() - interval '4 weeks'));
  if t <> array['LLS 100% Grace', 'LLS a_b Song', 'LLS back\slash', 'LLS Never Played'] then raise exception 'not_scheduled_since: %', t; end if;

  -- scheduled window scoped by service type: nguyen was scheduled midweek 2 weeks ago, not on Sunday.
  t := pg_temp.song_titles(jsonb_build_object('per_page', 200, 'scheduled_from', now() - interval '4 weeks', 'scheduled_to', now()));
  if t <> array['LLS Chúa Là Tình Yêu', 'LLS Ơn Trời'] then raise exception 'scheduled window: %', t; end if;
  t := pg_temp.song_titles(jsonb_build_object('per_page', 200, 'scheduled_from', now() - interval '4 weeks', 'scheduled_to', now(),
    'service_type_id', pg_temp.fx('sunday')));
  if t <> array['LLS Chúa Là Tình Yêu'] then raise exception 'scheduled window scoped to Sunday: %', t; end if;
  -- service_type_id alone filters nothing.
  if cardinality(pg_temp.song_titles(jsonb_build_object('per_page', 200, 'service_type_id', pg_temp.fx('sunday')))) <> 6 then
    raise exception 'service_type_id alone must not filter rows'; end if;

  -- Paging still reports the filtered total.
  if (public.list_curated_songs(pg_temp.fx('org'), '{"q":"lls","per_page":2}')->>'total')::int <> 6
    or jsonb_array_length(public.list_curated_songs(pg_temp.fx('org'), '{"q":"lls","per_page":2,"page":3}')->'data') <> 2 then
    raise exception 'total/paging broken'; end if;
end $$;

-- ------------------------------------------------------------ media list --
do $$
declare r jsonb; live jsonb;
begin
  r := public.list_media(pg_temp.fx('org'), jsonb_build_object('q', 'lls', 'today', current_date));
  if (r->>'total')::int <> 211 then raise exception 'media total (archived excluded before cap): %', r->>'total'; end if;
  if not (r->>'truncated')::boolean or jsonb_array_length(r->'media') <> 200 then raise exception 'media cap/truncated'; end if;
  if exists (select 1 from jsonb_array_elements(r->'media') e where (e->>'is_archived')::boolean) then
    raise exception 'archived media listed without include_archived'; end if;

  r := public.list_media(pg_temp.fx('org'), jsonb_build_object('q', 'lls', 'today', current_date, 'include_archived', true));
  if (r->>'total')::int <> 213 then raise exception 'media total with archived: %', r->>'total'; end if;

  r := public.list_media(pg_temp.fx('org'), jsonb_build_object('q', 'giang sinh', 'today', current_date));
  if (r->>'total')::int <> 1 or (r->>'truncated')::boolean then raise exception 'media accent search: %', r; end if;
  live := r->'media'->0;
  if (live->>'usage_count')::int <> 3 then raise exception 'media usage_count counts items: %', live->>'usage_count'; end if;
  if (live->>'last_used_on')::timestamptz < now() - interval '8 days' then raise exception 'media last_used_on: %', live->>'last_used_on'; end if;
  if live ? 'search_text' then raise exception 'media search_text must not be returned'; end if;

  r := public.list_media(pg_temp.fx('org'), jsonb_build_object('media_id', pg_temp.fx('media_gone'), 'include_archived', true, 'today', current_date));
  if (r->>'total')::int <> 1 or not (r->'media'->0->>'is_archived')::boolean then raise exception 'media_id lookup: %', r; end if;
  r := public.list_media(pg_temp.fx('org'), jsonb_build_object('q', '%', 'today', current_date));
  if (r->>'total')::int <> 0 then raise exception 'media %% must be literal'; end if;
end $$;

-- ------------------------------------------------------------ people / plans --
do $$ begin
  if not exists (select 1 from public.people_owner_search where id = pg_temp.fx('person')
      and search_text like '%nguyen duc%' and search_text like '%ha noi%' and search_text like '%duc.lls@example.test%' and listed) then
    raise exception 'owner search_text must fold name, campus and contact email'; end if;
  if not exists (select 1 from public.people_directory where id = pg_temp.fx('person') and search_text = 'tran nguyen duc ha noi' and listed) then
    raise exception 'directory search_text must be name + campus only'; end if;
  if (select count(*) from public.plans where organization_id = pg_temp.fx('org') and search_text ~* 'thu' and search_text ~* 'tu') < 1 then
    raise exception 'plan search_text must fold the title'; end if;
end $$;

-- A non-owner never sees email in search_text.
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
do $$ begin
  if exists (select 1 from public.people_directory where search_text like '%@%') then
    raise exception 'directory search_text leaks an email'; end if;
  if exists (select 1 from public.people_owner_search) then
    raise exception 'people_owner_search must be empty for a non-owner'; end if;
end $$;

rollback;
