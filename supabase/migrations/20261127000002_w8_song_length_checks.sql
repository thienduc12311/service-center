-- W8-PERF-D1: a song written straight through PostgREST with a title > 200
-- chars made the library list 500 (the API parses rows with the shared Zod
-- schema). Mirror the max lengths of packages/shared/src/schemas/song.ts as
-- CHECKs. Added NOT VALID (no long lock, never blocks on legacy rows) and then
-- validated; if legacy rows violate, the constraint stays NOT VALID (still
-- enforced for new writes) and a warning is raised.
alter table public.songs
  add constraint songs_title_len     check (length(btrim(title)) <= 200)            not valid,
  add constraint songs_author_len    check (author is null or length(btrim(author)) <= 200) not valid,
  add constraint songs_ccli_len      check (ccli_number is null or length(btrim(ccli_number)) <= 40) not valid,
  add constraint songs_copyright_len check (copyright is null or length(btrim(copyright)) <= 300) not valid,
  add constraint songs_admin_len     check (administration is null or length(btrim(administration)) <= 300) not valid,
  add constraint songs_meter_len     check (meter is null or length(btrim(meter)) <= 20) not valid,
  add constraint songs_style_len     check (style is null or length(btrim(style)) <= 40) not valid,
  add constraint songs_speed_len     check (speed is null or length(btrim(speed)) <= 40) not valid,
  add constraint songs_notes_len     check (notes is null or length(btrim(notes)) <= 4000) not valid;

do $$
declare
  c text;
begin
  foreach c in array array['songs_title_len','songs_author_len','songs_ccli_len','songs_copyright_len',
                           'songs_admin_len','songs_meter_len','songs_style_len','songs_speed_len','songs_notes_len']
  loop
    begin
      execute format('alter table public.songs validate constraint %I', c);
    exception when check_violation then
      raise warning 'constraint % left NOT VALID: legacy rows exceed the limit', c;
    end;
  end loop;
end $$;
