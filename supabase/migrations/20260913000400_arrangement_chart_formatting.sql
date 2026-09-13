-- ============================================================================
-- How an arrangement's chord chart is laid out when it is rendered to HTML or
-- printed to PDF.
--
-- These are presentation settings, not musical ones, so they live beside the
-- chart they format rather than on the song: two arrangements of the same song
-- are commonly printed differently (a lead sheet in one column, a band chart
-- in two). Every column is nullable except the column count, and null means
-- "use the template default" — so a chart that has never been formatted keeps
-- rendering exactly as it does today.
-- ============================================================================

alter table public.arrangements
  add column if not exists chart_columns     int  not null default 1,
  add column if not exists chart_font        text,
  add column if not exists chart_font_size   int,
  add column if not exists chart_chord_color text;

-- Only the one- and two-column layouts the formatting dialog offers are valid;
-- anything else would render as an unreadable chart.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'arrangements_chart_columns_valid'
      and conrelid = 'public.arrangements'::regclass
  ) then
    alter table public.arrangements
      add constraint arrangements_chart_columns_valid check (chart_columns in (1, 2));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'arrangements_chart_font_size_valid'
      and conrelid = 'public.arrangements'::regclass
  ) then
    alter table public.arrangements
      add constraint arrangements_chart_font_size_valid
      check (chart_font_size is null or chart_font_size between 6 and 48);
  end if;

  -- Stored as a CSS hex colour so the same value can be dropped straight into
  -- the print template without a lookup table.
  if not exists (
    select 1 from pg_constraint
    where conname = 'arrangements_chart_chord_color_valid'
      and conrelid = 'public.arrangements'::regclass
  ) then
    alter table public.arrangements
      add constraint arrangements_chart_chord_color_valid
      check (chart_chord_color is null or chart_chord_color ~ '^#[0-9A-Fa-f]{6}$');
  end if;
end $$;

-- No new index: these columns are only ever read alongside the row they format,
-- never filtered or sorted on.
--
-- RLS is unchanged. These are columns on a table that already carries
-- organization-scoped policies (arrangements_select / arrangements_write in
-- 20260101000100_rls.sql, both routed through public.org_of_arrangement), and
-- column-level grants are not used, so they inherit exactly the same access as
-- the rest of the row: readable by any active member of the owning
-- organization, writable only by a manager.
