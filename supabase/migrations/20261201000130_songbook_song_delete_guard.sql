-- W10-FGH-D4: deleting a song that a songbook lists silently removed it from
-- the songbook (`songbook_items.song_id ... on delete cascade`, 20260905000100)
-- and answered 204. A song in use is now refused like one a plan uses: the
-- library delete guard (`private.guard_library_delete`, F15) raises 23503 for
-- a songbook reference too, which the API answers as 409 `song_in_use`;
-- nothing is deleted.
--
-- Why the guard and not a NO ACTION / RESTRICT foreign key: deleting a whole
-- organization cascades to its songs and its songbooks as separate cascaded
-- deletes, and the songs cascade can run first, so a non-cascading FK would
-- make the organization undeletable. The guard only refuses while the song's
-- organization still exists; the FK keeps ON DELETE CASCADE for that path.
-- Removing the song from the songbook, or deleting the songbook, first still
-- works. `songbook_items_song_id_idx` indexes the lookup.

create or replace function private.guard_library_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (tg_table_name = 'songs' and exists (select 1 from public.plan_items where song_id = old.id))
    or (tg_table_name = 'arrangements' and exists (select 1 from public.plan_items where arrangement_id = old.id)) then
    raise exception 'Referenced library records must be archived' using errcode = '23503';
  end if;
  -- Nested: `old` of an arrangement has no organization_id.
  if tg_table_name = 'songs' then
    if exists (select 1 from public.songbook_items where song_id = old.id)
       and exists (select 1 from public.organizations where id = old.organization_id) then
      raise exception 'Remove the song from its songbooks before deleting it' using errcode = '23503';
    end if;
  end if;
  return old;
end $$;
