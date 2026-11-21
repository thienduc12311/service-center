import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  SONG_LIBRARY_PAGE_SIZE,
  parseSongLibraryFilters,
  songLibraryBpm,
  songLibraryFilterCount,
  songLibraryKeys,
  type ListSongsQuery,
  type SongLibraryFilterName,
  type SongLibraryFilterValues,
  type SongListItem,
} from '@service-center/shared';
import { useSongs } from '../hooks/queries';
import { useUrlEnum, useUrlNumber, useUrlPatch, useUrlSearch } from '../hooks/useUrlState';
import { useAuth } from '../providers/AuthProvider';
import { Badge, Button, EmptyState, ErrorNotice, ListErrorNotice, listFailed, PageHeader, Segmented, SkeletonList } from '../components/ui';
import { Icon } from '../components/icons';
import { SongBulkEditor } from '../components/song/SongBulkEditor';
import { AddSongModal } from '../components/AddSongModal';
import { useFormatters } from '../i18n';

/** A free-text song filter: the query parameter it sets and its caption. */
interface TextFilter {
  name: keyof SongLibraryFilterValues;
  label: TextFilterLabelKey;
}

/** Catalog keys for the free-text filter captions. */
type TextFilterLabelKey =
  | 'songsPage.filters.key'
  | 'songsPage.filters.theme'
  | 'songsPage.filters.songType'
  | 'songsPage.filters.style'
  | 'songsPage.filters.speed'
  | 'songsPage.filters.author';

const TEXT_FILTERS: TextFilter[] = [
  { name: 'key', label: 'songsPage.filters.key' },
  { name: 'theme', label: 'songsPage.filters.theme' },
  { name: 'song_type', label: 'songsPage.filters.songType' },
  { name: 'style', label: 'songsPage.filters.style' },
  { name: 'speed', label: 'songsPage.filters.speed' },
  { name: 'author', label: 'songsPage.filters.author' },
];

/** How the library list is ordered. */
type SongSort = 'title' | 'recent';

/** The library filters' URL parameters, in form order. */
const FILTER_PARAMS: readonly SongLibraryFilterName[] = [
  'archive', 'key', 'theme', 'song_type', 'style', 'speed', 'author', 'bpm_min', 'bpm_max', 'scheduled_from', 'scheduled_to',
];

const SORTS: readonly SongSort[] = ['title', 'recent'];

/** `songBulkPreviewSchema` accepts at most this many songs per bulk edit. */
const SONG_BULK_LIMIT = 100;

/** Reads the filters back out of the URL, exactly as the form typed them. */
const filterValuesFrom = (params: URLSearchParams): SongLibraryFilterValues => {
  const values: SongLibraryFilterValues = {};
  for (const name of FILTER_PARAMS) {
    const value = params.get(name);
    if (value) values[name] = value;
  }
  return values;
};

/** Selected songs by id, kept across pages so a bulk edit can span several. */
type SongSelection = ReadonlyMap<string, SongListItem>;

interface SongSelectionUpdate {
  next: SongSelection;
  skipped: number;
}

/** Adds songs to a selection up to the bulk limit; reports how many did not fit. */
const addToSelection = (current: SongSelection, songs: readonly SongListItem[]): SongSelectionUpdate => {
  const next = new Map(current);
  let skipped = 0;
  for (const song of songs) {
    if (next.has(song.id)) continue;
    if (next.size >= SONG_BULK_LIMIT) { skipped += 1; continue; }
    next.set(song.id, song);
  }
  return { next, skipped };
};

export const SongsPage = () => {
  const { t } = useTranslation(['songs', 'common']);
  const formatters = useFormatters();
  const { canAnywhere } = useAuth();
  // The song library is organization-wide; leading a team never implies it.
  const canManage = canAnywhere('songs.manage');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const patchUrl = useUrlPatch();
  const search = useUrlSearch('q', { page: null });
  const [sort, setSort] = useUrlEnum<SongSort>('sort', SORTS, 'title');
  const [page, setPage] = useUrlNumber('page', 1, { min: 1 });
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<SongSelection>(() => new Map());
  const [overLimit, setOverLimit] = useState(false);
  const [editing, setEditing] = useState(false);
  const [formError, setFormError] = useState<Error | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const filterValues = filterValuesFrom(params);
  // The URL can be hand-edited or stale: an unreadable filter set is reported and ignored.
  const parsedFilters = parseSongLibraryFilters(filterValues);
  const filters: Partial<ListSongsQuery> = parsedFilters.ok ? parsedFilters.query : {};
  const filterError = formError ?? (parsedFilters.ok ? null : parsedFilters.error);
  // Parsing fills in the library scope, sort and paging, so those never count as a filter.
  const activeFilterCount = songLibraryFilterCount(filters);
  const songs = useSongs({ ...filters, q: search.query || undefined, sort, page, per_page: SONG_LIBRARY_PAGE_SIZE });
  const total = songs.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / SONG_LIBRARY_PAGE_SIZE));
  // A stale link past the last page lands on the last page instead of an empty one.
  useEffect(() => {
    if (songs.data && !songs.isPlaceholderData && page > pageCount) patchUrl({ page: pageCount > 1 ? pageCount : null }, { replace: true });
  }, [songs.data, songs.isPlaceholderData, page, pageCount, patchUrl]);

  const applyFilters = (values: SongLibraryFilterValues) => {
    const patch: Record<string, string | null> = { page: null };
    for (const name of FILTER_PARAMS) patch[name] = values[name]?.trim() || null;
    patchUrl(patch);
  };
  const select = (songsToAdd: readonly SongListItem[]) => {
    const { next, skipped } = addToSelection(selected, songsToAdd);
    setSelected(next);
    setOverLimit(skipped > 0);
  };
  const unselect = (ids: readonly string[]) => {
    const next = new Map(selected);
    for (const id of ids) next.delete(id);
    setSelected(next);
    setOverLimit(false);
  };
  const clearSelection = () => { setSelected(new Map()); setOverLimit(false); };

  const rows = songs.data?.data ?? [];
  const pageSelected = rows.filter((row) => selected.has(row.id)).length;
  const offPage = selected.size - pageSelected;

  return (
    <div>
      <PageHeader
        title={t('common:nav.songs')}
        subtitle={t('songsPage.subtitle')}
        actions={
          canManage && (
            <>
              <Link
                to="/imports?kind=songs"
                className="button inline-flex h-9 items-center gap-2 bg-white px-3.5 text-sm font-medium text-slate-700 shadow-sm shadow-slate-900/5 ring-1 ring-inset ring-slate-300 transition hover:bg-slate-50 hover:text-slate-900 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800"
              >
                <Icon name="upload" className="size-4" />
                {t('songsPage.importCsv')}
              </Link>
              <Button icon="plus" onClick={() => setAdding(true)}>{t('songsPage.addSong')}</Button>
            </>
          )
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            className="input pl-9"
            value={search.text}
            onChange={(event) => search.setText(event.target.value)}
            placeholder={t('songsPage.searchPlaceholder')}
            aria-label={t('songsPage.searchLabel')}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<SongSort>
            label={t('songsPage.sortLabel')}
            value={sort}
            onChange={(value) => setSort(value, { page: null })}
            items={[
              { value: 'title', label: t('songsPage.sortTitle') },
              { value: 'recent', label: t('songsPage.sortRecent') },
            ]}
          />
          <Button
            variant={activeFilterCount ? 'primary' : 'secondary'}
            icon="grid"
            aria-expanded={showFilters}
            onClick={() => setShowFilters((open) => !open)}
          >
            {activeFilterCount
              ? t(showFilters ? 'songsPage.hideFiltersCount' : 'songsPage.filtersCount', { count: activeFilterCount })
              : t(showFilters ? 'songsPage.hideFilters' : 'songsPage.filters.toggle')}
          </Button>
        </div>
        {songs.data && (
          <span className="text-sm text-slate-500 tabular-nums sm:ml-auto dark:text-slate-400">
            {t('common:count.songs', { count: songs.data.total })}
          </span>
        )}
      </div>

      {/* Hidden rather than unmounted, so reopening shows the filters still applied. */}
      <form key={FILTER_PARAMS.map((name) => filterValues[name] ?? '').join('|')} hidden={!showFilters} className="card animate-fade-in mb-4 p-4 sm:p-5" onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const input: SongLibraryFilterValues = Object.fromEntries(
          [...form.entries()].flatMap(([name, value]) => (typeof value === 'string' ? [[name, value]] : [])),
        );
        // The same rules as the app: blanks dropped, dates as UTC day starts.
        const parsed = parseSongLibraryFilters(input);
        if (!parsed.ok) { setFormError(parsed.error); return; }
        // `active` is the library's default scope; leave it out of the URL.
        setFormError(null); applyFilters({ ...input, archive: input.archive === 'active' ? '' : input.archive });
      }} onReset={() => { setFormError(null); applyFilters({}); }}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="field">{t('songsPage.filters.library')}<select name="archive" className="input" defaultValue={filterValues.archive ?? 'active'}><option value="active">{t('songsPage.filters.activeSongs')}</option><option value="archived">{t('songsPage.filters.archivedSongs')}</option><option value="all">{t('songsPage.filters.allSongs')}</option></select></label>
          {TEXT_FILTERS.map((filter) => <label key={filter.name} className="field">{t(filter.label)}<input className="input" name={filter.name} defaultValue={filterValues[filter.name] ?? ''} /></label>)}
          <label className="field">{t('songsPage.filters.bpmMin')}<input className="input" name="bpm_min" type="number" min="20" max="300" defaultValue={filterValues.bpm_min ?? ''} /></label>
          <label className="field">{t('songsPage.filters.bpmMax')}<input className="input" name="bpm_max" type="number" min="20" max="300" defaultValue={filterValues.bpm_max ?? ''} /></label>
          <label className="field">{t('songsPage.filters.scheduledFrom')}<input className="input" name="scheduled_from" type="date" defaultValue={filterValues.scheduled_from ?? ''} /></label>
          <label className="field">{t('songsPage.filters.scheduledTo')}<input className="input" name="scheduled_to" type="date" defaultValue={filterValues.scheduled_to ?? ''} /></label>
        </div>
        <div className="mt-5 flex justify-end gap-2 border-t border-app-border pt-4">
          <Button type="reset" variant="ghost">{t('common:actions.clear')}</Button>
          <Button type="submit" icon="check">{t('songsPage.applyFilters')}</Button>
        </div>
      </form>
      <div className="space-y-3">
        <ErrorNotice error={filterError ?? (listFailed(songs) ? null : songs.error)} />
        {canManage && selected.size > 0 && !editing && (
          <div className="surface-inset flex flex-wrap items-center justify-between gap-3 px-4 py-2.5" role="region" aria-label={t('songsPage.selection.label')}>
            <div className="min-w-0 text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-200">
                {t('common:count.selected', { count: selected.size })}
              </span>
              {offPage > 0 && (
                <span className="ml-2 text-slate-500 dark:text-slate-400">{t('songsPage.selection.offPage', { count: offPage })}</span>
              )}
              {overLimit && (
                <p role="status" className="mt-0.5 text-xs text-amber-700 dark:text-amber-300">{t('songsPage.selection.limit', { max: SONG_BULK_LIMIT })}</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ghost" onClick={clearSelection}>{t('songsPage.selection.clear')}</Button>
              <Button size="sm" icon="pencil" onClick={() => setEditing(true)}>
                {t('songsPage.editSelected', { count: selected.size })}
              </Button>
            </div>
          </div>
        )}
        {canManage && editing && <SongBulkEditor songs={[...selected.values()]} onDone={() => { setEditing(false); clearSelection(); }} />}
      </div>

      <div className="mt-3">
        {songs.isLoading ? (
          <SkeletonList rows={6} />
        ) : listFailed(songs) ? (
          <ListErrorNotice query={songs} />
        ) : rows.length ? (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="border-b border-app-border bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
                    {canManage && (
                      <th scope="col" className="w-10 px-4 py-2.5">
                        <input
                          ref={(input) => { if (input) input.indeterminate = pageSelected > 0 && pageSelected < rows.length; }}
                          type="checkbox"
                          className="size-4 rounded border-slate-300 accent-brand-600"
                          aria-label={t('songsPage.selection.selectPage')}
                          checked={rows.length > 0 && pageSelected === rows.length}
                          disabled={editing}
                          onChange={(event) => (event.target.checked ? select(rows) : unselect(rows.map((row) => row.id)))}
                        />
                      </th>
                    )}
                    <th scope="col" className="px-4 py-2.5 font-semibold">{t('songsPage.columns.title')}</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">{t('songsPage.columns.bpm')}</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">{t('songsPage.columns.keys')}</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">{t('songsPage.columns.lastScheduled')}</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">{t('songsPage.columns.created')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {rows.map((song) => {
                    const checked = selected.has(song.id);
                    const keys = songLibraryKeys(song);
                    return (
                      <tr
                        key={song.id}
                        className={`group transition ${checked ? 'bg-brand-50/60 dark:bg-brand-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'}`}
                      >
                        {canManage && (
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              className="size-4 rounded border-slate-300 accent-brand-600"
                              aria-label={t('songsPage.selectSong', { title: song.title })}
                              checked={checked}
                              disabled={editing}
                              onChange={(event) => (event.target.checked ? select([song]) : unselect([song.id]))}
                            />
                          </td>
                        )}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-100 dark:bg-brand-500/10 dark:text-brand-200 dark:ring-brand-500/20">
                              <Icon name="music" className="size-4" />
                            </span>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <Link
                                  to={`/songs/${song.id}`}
                                  className="font-medium text-slate-900 hover:text-brand-700 dark:text-white dark:hover:text-brand-200"
                                >
                                  {song.title}
                                </Link>
                                {song.archived_at && (
                                  <Badge tone="bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600/40">
                                    {t('songsPage.archivedBadge')}
                                  </Badge>
                                )}
                              </div>
                              {song.author && <p className="truncate text-xs text-slate-500 dark:text-slate-400">{song.author}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 tabular-nums text-slate-600 dark:text-slate-300">{songLibraryBpm(song) ?? ''}</td>
                        <td className="px-4 py-3">
                          {keys && (
                            <span className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">{keys}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-slate-600 dark:text-slate-300">
                          {song.last_scheduled_at ? formatters.date(song.last_scheduled_at, 'medium') : ''}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-slate-500 dark:text-slate-400">{formatters.date(song.created_at, 'medium')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <EmptyState
            icon="music"
            title={search.query || activeFilterCount ? t('songsPage.emptySearch') : t('songsPage.empty')}
            description={t('songsPage.emptyDescription')}
            action={canManage ? <Button icon="plus" onClick={() => setAdding(true)}>{t('songsPage.addSong')}</Button> : undefined}
          />
        )}
      </div>

      <div className="my-5 flex items-center justify-end gap-2">
        <Button size="sm" variant="secondary" icon="chevronLeft" disabled={page <= 1 || songs.isFetching || editing} onClick={() => setPage(page - 1)}>{t('songsPage.previousPage')}</Button>
        <span className="px-2 text-sm text-slate-500 tabular-nums dark:text-slate-400">{t('songsPage.pageOf', { page, pages: pageCount })}</span>
        <Button size="sm" variant="secondary" disabled={!songs.data || page >= pageCount || songs.isFetching || editing} onClick={() => setPage(page + 1)}>
          {t('common:actions.next')}
          <Icon name="chevronRight" className="size-3.5" />
        </Button>
      </div>
      <AddSongModal
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={(song) => navigate(`/songs/${song.id}`)}
      />
    </div>
  );
};
