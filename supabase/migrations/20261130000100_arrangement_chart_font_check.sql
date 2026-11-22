-- ============================================================================
-- arrangements.chart_font: only the fonts the Formatting dialog offers.
--
-- The value is printed into the chart template's <style> block, and the chart
-- is opened on the app's own origin (a blob: tab, the PDF writer's frame). A
-- free-text font was therefore a stored-XSS vector: anyone allowed to edit an
-- arrangement could store `x;}</style><script>…` and run script in the session
-- of every member who opened the chart. The API now validates the value
-- (`chartFontSchema` in packages/shared/src/schemas/song.ts) and the renderer
-- prints only known fonts, but RLS lets a manager write the row directly, so
-- the database enforces the same closed set.
--
-- The allowed values are `CHART_FONT_VALUES` (CHART_FONT_OPTIONS in
-- packages/shared/src/lib/constants.ts), verbatim. A check constraint rather
-- than a lookup table, like the sibling chart_columns / chart_font_size /
-- chart_chord_color checks (20260913000400): a short, code-owned list that only
-- changes together with the UI that offers it. Changing it means a new
-- migration that drops and re-adds this constraint.
--
-- Data: any stored value outside the list is reset to null first, which renders
-- in the default font (Courier). The UI only ever offered these four values, so
-- this touches only rows written around the UI. The update fires the usual
-- arrangement triggers (revision bump, updated_at, history), so the change is
-- audited like any other edit.
--
-- RLS is unchanged: a column constraint, enforced for every writer.
-- No index: the column is never filtered or sorted on.
-- ============================================================================

update public.arrangements
set chart_font = null
where chart_font is not null
  and chart_font not in (
    '''Courier New'', Courier, monospace',
    'Menlo, Consolas, ''Liberation Mono'', monospace',
    'Arial, Helvetica, sans-serif',
    'Georgia, ''Times New Roman'', serif'
  );

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'arrangements_chart_font_valid'
      and conrelid = 'public.arrangements'::regclass
  ) then
    alter table public.arrangements
      add constraint arrangements_chart_font_valid
      check (
        chart_font is null
        or chart_font in (
          '''Courier New'', Courier, monospace',
          'Menlo, Consolas, ''Liberation Mono'', monospace',
          'Arial, Helvetica, sans-serif',
          'Georgia, ''Times New Roman'', serif'
        )
      );
  end if;
end $$;
