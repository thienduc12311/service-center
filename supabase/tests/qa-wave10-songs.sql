-- W10-FGH-D4 regression suite (20261201000400_songbook_song_delete_guard).
-- Fails on the schema before that migration:
--   A. deleting a song a songbook lists is refused with 23503 (the API's
--      409 song_in_use) and the songbook keeps the song.
--   B. once the song leaves the songbook (or the songbook is deleted) it can
--      be deleted; deleting an arrangement still leaves the song in the book.
--   C. deleting the whole organization still cascades through songs and
--      songbooks.
-- Self-contained fixtures; everything rolls back.
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/qa-wave10-songs.sql
begin;

create temporary table w10s_fx (k text primary key, id uuid) on commit drop;
insert into w10s_fx values
  ('org', gen_random_uuid()), ('song', gen_random_uuid()), ('song2', gen_random_uuid()),
  ('arr', gen_random_uuid()), ('book', gen_random_uuid()), ('book2', gen_random_uuid());
create or replace function pg_temp.fx(p text) returns uuid language sql stable as $$ select id from w10s_fx where k = p $$;

insert into public.organizations (id, name, slug, timezone) values
  (pg_temp.fx('org'), 'W10 Songs', 'w10-songs-' || left(pg_temp.fx('org')::text, 8), 'America/Toronto');
insert into public.songs (id, organization_id, title) values
  (pg_temp.fx('song'), pg_temp.fx('org'), 'W10 In a book'),
  (pg_temp.fx('song2'), pg_temp.fx('org'), 'W10 Second');
insert into public.arrangements (id, song_id, name) values (pg_temp.fx('arr'), pg_temp.fx('song'), 'W10 Arr');
insert into public.songbooks (id, organization_id, title) values
  (pg_temp.fx('book'), pg_temp.fx('org'), 'W10 Book'),
  (pg_temp.fx('book2'), pg_temp.fx('org'), 'W10 Book 2');
insert into public.songbook_items (songbook_id, song_id, arrangement_id, sort_order) values
  (pg_temp.fx('book'), pg_temp.fx('song'), pg_temp.fx('arr'), 0),
  (pg_temp.fx('book2'), pg_temp.fx('song2'), null, 0);

-- ============================================ A. refused while listed
do $$ begin
  begin
    delete from public.songs where id = pg_temp.fx('song');
    raise exception 'A1 a song in a songbook was deleted';
  exception when foreign_key_violation then null; end;
  if not exists (select 1 from public.songbook_items where song_id = pg_temp.fx('song')) then
    raise exception 'A2 the songbook lost the song';
  end if;
end $$;

-- ============================================ B. allowed once unlisted
delete from public.arrangements where id = pg_temp.fx('arr');
do $$ begin
  if not exists (select 1 from public.songbook_items where song_id = pg_temp.fx('song') and arrangement_id is null) then
    raise exception 'B1 deleting the arrangement removed the song from the book';
  end if;
end $$;
delete from public.songbook_items where song_id = pg_temp.fx('song');
delete from public.songs where id = pg_temp.fx('song');
delete from public.songbooks where id = pg_temp.fx('book2');
delete from public.songs where id = pg_temp.fx('song2');
do $$ begin
  if exists (select 1 from public.songs where id in (pg_temp.fx('song'), pg_temp.fx('song2'))) then
    raise exception 'B2 an unlisted song could not be deleted';
  end if;
end $$;

-- ============================================ C. organization delete cascades
insert into public.songs (id, organization_id, title) values (pg_temp.fx('song'), pg_temp.fx('org'), 'W10 Again');
insert into public.songbooks (id, organization_id, title) values (pg_temp.fx('book'), pg_temp.fx('org'), 'W10 Book again')
  on conflict (id) do nothing;
insert into public.songbook_items (songbook_id, song_id, sort_order) values (pg_temp.fx('book'), pg_temp.fx('song'), 0);
delete from public.organizations where id = pg_temp.fx('org');
do $$ begin
  if exists (select 1 from public.songbook_items where song_id = pg_temp.fx('song'))
     or exists (select 1 from public.songs where id = pg_temp.fx('song')) then
    raise exception 'C1 deleting the organization left its songs or songbook items';
  end if;
end $$;

select 'qa-wave10-songs: all sections passed' as result;
rollback;
