-- ============================================================================
-- The publisher/administrator a song's copyright is licensed through, captured
-- by the Song Information dialog next to Copyright and CCLI#.
--
-- Free text rather than a lookup table: it is reporting metadata copied off a
-- chart ("Capitol CMG Publishing"), never joined on or filtered by.
-- ============================================================================

-- Nullable with no default, so the ALTER is metadata-only and takes no
-- rewrite lock on an existing library.
alter table public.songs
  add column if not exists administration text;

-- No index: the column is displayed, never searched or filtered.
--
-- RLS is unchanged — this is a column on a table that already carries
-- organization-scoped policies (songs_select / songs_write in
-- 20260101000100_rls.sql) and no column-level grants are used, so it inherits
-- exactly the same access as the rest of the row.
