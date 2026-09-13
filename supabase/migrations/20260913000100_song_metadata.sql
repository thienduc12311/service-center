-- ============================================================================
-- Song metadata captured by the Add Song form, and the capo an arrangement is
-- played with.
--
-- `song_types` is an array because a song is commonly more than one thing at
-- once ("Hymn" + "Communion"); `style` and `speed` are single-valued. All
-- three are free text rather than enums so an organization can use its own
-- vocabulary without a migration — the client offers the common values.
-- ============================================================================

alter table public.songs
  add column if not exists song_types text[] not null default '{}',
  add column if not exists style      text,
  add column if not exists speed      text;

-- Capo 0 and NULL both mean "played open"; the client only ever writes NULL.
alter table public.arrangements
  add column if not exists capo int;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'arrangements_capo_valid'
      and conrelid = 'public.arrangements'::regclass
  ) then
    alter table public.arrangements
      add constraint arrangements_capo_valid check (capo is null or capo between 0 and 11);
  end if;
end $$;

-- The library filters by these the same way it filters by `themes`, and the
-- existing themes GIN index has no counterpart for types yet.
create index if not exists songs_song_types_idx on public.songs using gin (song_types);

-- RLS is unchanged: these are columns on tables that already carry
-- organization-scoped policies (songs_select / songs_write in
-- 20260101000100_rls.sql), and column-level grants are not used here, so the
-- new columns inherit exactly the same access as the rest of the row.
