import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import {
  SONG_LIBRARY_PAGE_SIZE,
  parseSongLibraryFilters,
  songLibraryBpm,
  songLibraryFilterCount,
  songLibraryKeys,
  type ListSongsQuery,
  type SongLibraryFilterValues,
} from '@service-center/shared';
import { useSongs } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Button, EmptyState, ErrorNotice, Loading, PageHeader } from '../components/ui';
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

export const SongsPage = () => {
  const { t } = useTranslation(['songs', 'common']);
  const formatters = useFormatters();
  const { canAnywhere } = useAuth();
  // The song library is organization-wide; leading a team never implies it.
  const canManage = canAnywhere('songs.manage');
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'title' | 'recent'>('title');
  const [adding, setAdding] = useState(false);
  const [filters, setFilters] = useState<Partial<ListSongsQuery>>({});
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [filterError, setFilterError] = useState<Error | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  // Parsing fills in the library scope, sort and paging, so those never count as a filter.
  const activeFilterCount = songLibraryFilterCount(filters);
  const songs = useSongs({ ...filters, q: query || undefined, sort, page, per_page: SONG_LIBRARY_PAGE_SIZE });
  const resetPage = () => { setPage(1); setSelected([]); setEditing(false); };

  const rows = songs.data?.data ?? [];

  return (
    <div>
      <PageHeader
        title={t('common:nav.songs')}
        subtitle={t('songsPage.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <select
              aria-label={t('songsPage.sortLabel')}
              className="input w-48"
              value={sort}
              onChange={(event) => { setSort(event.target.value as 'title' | 'recent'); resetPage(); }}
            >
              <option value="title">{t('songsPage.sortTitle')}</option>
              <option value="recent">{t('songsPage.sortRecent')}</option>
            </select>
            {canManage && <><Link className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300" to="/imports?kind=songs">{t('songsPage.importCsv')}</Link><Button onClick={() => setAdding(true)}>{t('songsPage.addSong')}</Button></>}
          </div>
        }
      />

      <div className="card mb-4 flex flex-wrap items-center gap-3 px-4 py-3">
        <input
          className="input min-w-48 max-w-sm flex-1"
          value={query}
          onChange={(event) => { setQuery(event.target.value); resetPage(); }}
          placeholder={t('songsPage.searchPlaceholder')}
          aria-label={t('songsPage.searchLabel')}
        />
        <Button variant="secondary" aria-expanded={showFilters} onClick={() => setShowFilters((open) => !open)}>
          {activeFilterCount
            ? t(showFilters ? 'songsPage.hideFiltersCount' : 'songsPage.filtersCount', { count: activeFilterCount })
            : t(showFilters ? 'songsPage.hideFilters' : 'songsPage.filters.toggle')}
        </Button>
        {songs.data && (
          <span className="ml-auto text-sm text-slate-500">
            {t('common:count.songs', { count: songs.data.total })}
          </span>
        )}
      </div>

      {/* Hidden rather than unmounted, so reopening shows the filters still applied. */}
      <form hidden={!showFilters} className="card mb-4 p-4" onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const input: SongLibraryFilterValues = Object.fromEntries(
          [...form.entries()].flatMap(([name, value]) => (typeof value === 'string' ? [[name, value]] : [])),
        );
        // The same rules as the app: blanks dropped, dates as UTC day starts.
        const parsed = parseSongLibraryFilters(input);
        if (!parsed.ok) { setFilterError(parsed.error); return; }
        setFilterError(null); setFilters(parsed.query); resetPage();
      }} onReset={() => { setFilterError(null); setFilters({}); resetPage(); }}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="field">{t('songsPage.filters.library')}<select name="archive" className="input"><option value="active">{t('songsPage.filters.activeSongs')}</option><option value="archived">{t('songsPage.filters.archivedSongs')}</option><option value="all">{t('songsPage.filters.allSongs')}</option></select></label>
          {TEXT_FILTERS.map((filter) => <label key={filter.name} className="field">{t(filter.label)}<input className="input" name={filter.name} /></label>)}
          <label className="field">{t('songsPage.filters.bpmMin')}<input className="input" name="bpm_min" type="number" min="20" max="300" /></label>
          <label className="field">{t('songsPage.filters.bpmMax')}<input className="input" name="bpm_max" type="number" min="20" max="300" /></label>
          <label className="field">{t('songsPage.filters.scheduledFrom')}<input className="input" name="scheduled_from" type="date" /></label>
          <label className="field">{t('songsPage.filters.scheduledTo')}<input className="input" name="scheduled_to" type="date" /></label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="reset" variant="ghost">{t('common:actions.clear')}</Button>
          <Button type="submit">{t('songsPage.applyFilters')}</Button>
        </div>
      </form>
      <ErrorNotice error={filterError ?? songs.error} />
      {canManage && selected.length > 0 && !editing && <div className="mb-4"><Button onClick={() => setEditing(true)}>{t('songsPage.editSelected', { count: selected.length })}</Button></div>}
      {canManage && editing && <SongBulkEditor songs={rows.filter((row) => selected.includes(row.id))} onDone={() => { setEditing(false); setSelected([]); }} />}


      {songs.isLoading ? (
        <Loading />
      ) : rows.length ? (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                {canManage && <th scope="col" className="px-4 py-3">{t('common:actions.select')}</th>}
                <th scope="col" className="px-4 py-3 font-medium">{t('songsPage.columns.title')}</th>
                <th scope="col" className="px-4 py-3 font-medium">{t('songsPage.columns.bpm')}</th>
                <th scope="col" className="px-4 py-3 font-medium">{t('songsPage.columns.keys')}</th>
                <th scope="col" className="px-4 py-3 font-medium">{t('songsPage.columns.lastScheduled')}</th>
                <th scope="col" className="px-4 py-3 font-medium">{t('songsPage.columns.created')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((song) => (
                <tr key={song.id} className="transition hover:bg-slate-50">
                  {canManage && <td className="px-4 py-3"><input type="checkbox" aria-label={t('songsPage.selectSong', { title: song.title })} checked={selected.includes(song.id)} disabled={editing} onChange={(event) => setSelected((current) => event.target.checked ? [...current, song.id] : current.filter((id) => id !== song.id))} /></td>}
                  <td className="px-4 py-3">
                    {song.archived_at && <span className="mr-2 text-xs text-slate-500">{t('songsPage.archivedBadge')}</span>}
                    <Link to={`/songs/${song.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                      {song.title}
                    </Link>
                    {song.author && <p className="text-xs text-slate-500">{song.author}</p>}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{songLibraryBpm(song) ?? ''}</td>
                  <td className="px-4 py-3 font-medium text-slate-700">{songLibraryKeys(song)}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {song.last_scheduled_at ? formatters.date(song.last_scheduled_at, 'medium') : ''}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatters.date(song.created_at, 'medium')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title={query ? t('songsPage.emptySearch') : t('songsPage.empty')}
          description={t('songsPage.emptyDescription')}
          action={canManage ? <Button onClick={() => setAdding(true)}>{t('songsPage.addSong')}</Button> : undefined}
        />
      )}

      <div className="my-4 flex items-center justify-end gap-3">
        <Button variant="secondary" disabled={page <= 1 || songs.isFetching || editing} onClick={() => { setPage(page - 1); setSelected([]); }}>{t('songsPage.previousPage')}</Button>
        <span className="text-sm text-slate-500">{t('songsPage.page', { page })}</span>
        <Button variant="secondary" disabled={!songs.data || page * SONG_LIBRARY_PAGE_SIZE >= songs.data.total || songs.isFetching || editing} onClick={() => { setPage(page + 1); setSelected([]); }}>{t('common:actions.next')}</Button>
      </div>
      <AddSongModal
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={(song) => navigate(`/songs/${song.id}`)}
      />
    </div>
  );
};
