-- arrangements.chart_font is a closed set (20261130000100_arrangement_chart_font_check):
-- null or one of the fonts the Formatting dialog offers (CHART_FONT_OPTIONS).
-- The value is printed into the chart's stylesheet, so free text was a stored
-- XSS vector. Exercised as the seeded owner through RLS, the way a direct
-- PostgREST write would arrive, as well as by the superuser.
--
-- Run against a seeded local database:
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/arrangement-chart-font.sql
-- Everything runs inside one transaction and is rolled back.
begin;

create temporary table cf_fx (k text primary key, id uuid) on commit drop;
grant select on cf_fx to authenticated;
insert into cf_fx values
  ('org',  'aaaaaaaa-0000-4000-8000-000000000001'),
  ('song', gen_random_uuid()),
  ('arr',  gen_random_uuid());
create or replace function pg_temp.fx(p text) returns uuid language sql stable as $$ select id from cf_fx where k = p $$;

insert into public.songs (id, organization_id, title)
values (pg_temp.fx('song'), pg_temp.fx('org'), 'Chart Font Song');
insert into public.arrangements (id, song_id, name, is_default)
values (pg_temp.fx('arr'), pg_temp.fx('song'), 'Chart Font Arrangement', false);

-- ---------------------------------------------------- the constraint exists ----
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'arrangements_chart_font_valid'
      and conrelid = 'public.arrangements'::regclass
      and contype = 'c'
      and convalidated
  ) then
    raise exception 'arrangements_chart_font_valid is missing or not validated';
  end if;
end $$;

-- ------------------------------------------------- as the owner, through RLS ----
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

do $$
declare
  bad text;
  good text;
begin
  foreach bad in array array[
    'x;}</style><script>alert(document.domain)</script>',
    'Comic Sans MS',
    'arial, helvetica, sans-serif',
    ' Arial, Helvetica, sans-serif',
    ''
  ] loop
    begin
      update public.arrangements set chart_font = bad where id = pg_temp.fx('arr');
      raise exception 'update accepted chart_font %', quote_literal(bad);
    exception when check_violation then null;
    end;

    begin
      insert into public.arrangements (song_id, name, is_default, chart_font)
      values (pg_temp.fx('song'), 'Bad font', false, bad);
      raise exception 'insert accepted chart_font %', quote_literal(bad);
    exception when check_violation then null;
    end;
  end loop;

  foreach good in array array[
    '''Courier New'', Courier, monospace',
    'Menlo, Consolas, ''Liberation Mono'', monospace',
    'Arial, Helvetica, sans-serif',
    'Georgia, ''Times New Roman'', serif'
  ] loop
    update public.arrangements set chart_font = good where id = pg_temp.fx('arr');
    if (select chart_font from public.arrangements where id = pg_temp.fx('arr')) is distinct from good then
      raise exception 'allowed chart_font % was not stored', quote_literal(good);
    end if;

    insert into public.arrangements (song_id, name, is_default, chart_font)
    values (pg_temp.fx('song'), 'Good font', false, good);
  end loop;

  update public.arrangements set chart_font = null where id = pg_temp.fx('arr');
  if (select chart_font from public.arrangements where id = pg_temp.fx('arr')) is not null then
    raise exception 'null chart_font was not stored';
  end if;

  insert into public.arrangements (song_id, name, is_default, chart_font)
  values (pg_temp.fx('song'), 'Default font', false, null);
end $$;

-- ------------------------------------- not even the superuser can bypass it ----
reset role;

do $$
begin
  begin
    update public.arrangements set chart_font = 'x;}</style><script>' where id = pg_temp.fx('arr');
    raise exception 'superuser update accepted an unlisted chart_font';
  exception when check_violation then null;
  end;
end $$;

rollback;
