import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatDate, listSongsQuerySchema, type ListSongsQuery, type SongListItem } from '@service-center/shared';
import { useSongs } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Button, EmptyState, ErrorNotice, Loading, PageHeader } from '../components/ui';
import { SongBulkEditor } from '../components/song/SongBulkEditor';
import { AddSongModal } from '../components/AddSongModal';

const DAY = { month: 'short', day: 'numeric', year: 'numeric' } as const;

/** A free-text song filter: the query parameter it sets and its caption. */
interface TextFilter {
  name: keyof ListSongsQuery;
  label: string;
}

const NOT_FILTERS = new Set(['archive', 'sort', 'page', 'per_page', 'q']);

const TEXT_FILTERS: TextFilter[] = [
  { name: 'key', label: 'Key' },
  { name: 'theme', label: 'Theme' },
  { name: 'song_type', label: 'Song type' },
  { name: 'style', label: 'Style' },
  { name: 'speed', label: 'Speed' },
  { name: 'author', label: 'Author' },
];

/** The keys a song is actually played in — its arrangements, not just the default. */
const songKeys = (song: SongListItem): string => {
  const keys = song.arrangements.map((arrangement) => arrangement.song_key).filter(Boolean);
  const unique = [...new Set(keys.length ? keys : [song.default_key])].filter(Boolean);
  return unique.join(', ');
};

const songBpm = (song: SongListItem): number | null =>
  song.default_bpm ?? song.arrangements.find((arrangement) => arrangement.bpm)?.bpm ?? null;

export const SongsPage = () => {
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
  const activeFilterCount = Object.entries(filters)
    .filter(([name, value]) => !NOT_FILTERS.has(name) && value !== undefined).length;
  const songs = useSongs({ ...filters, q: query || undefined, sort, page, per_page: 50 });
  const resetPage = () => { setPage(1); setSelected([]); setEditing(false); };

  const rows = songs.data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Songs"
        subtitle="Your library, with arrangements and chord charts."
        actions={
          <div className="flex items-center gap-2">
            <select
              aria-label="Sort songs"
              className="input w-48"
              value={sort}
              onChange={(event) => { setSort(event.target.value as 'title' | 'recent'); resetPage(); }}
            >
              <option value="title">A–Z</option>
              <option value="recent">Recently updated</option>
            </select>
            {canManage && <><Link className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300" to="/imports?kind=songs">Import CSV</Link><Button onClick={() => setAdding(true)}>Add a song</Button></>}
          </div>
        }
      />

      <div className="card mb-4 flex flex-wrap items-center gap-3 px-4 py-3">
        <input
          className="input min-w-48 max-w-sm flex-1"
          value={query}
          onChange={(event) => { setQuery(event.target.value); resetPage(); }}
          placeholder="Add text filter"
          aria-label="Search songs"
        />
        <Button variant="secondary" aria-expanded={showFilters} onClick={() => setShowFilters((open) => !open)}>
          {showFilters ? 'Hide filters' : 'Filters'}{activeFilterCount ? ` (${activeFilterCount})` : ''}
        </Button>
        {songs.data && (
          <span className="ml-auto text-sm text-slate-500">
            {songs.data.total} song{songs.data.total === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {/* Hidden rather than unmounted, so reopening shows the filters still applied. */}
      <form hidden={!showFilters} className="card mb-4 p-4" onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const input = Object.fromEntries([...form.entries()].filter(([, value]) => value !== ''));
        for (const key of ['scheduled_from', 'scheduled_to']) {
          const value = input[key];
          if (typeof value === 'string' && value) input[key] = `${value}T00:00:00Z`;
        }
        const parsed = listSongsQuerySchema.safeParse(input);
        if (!parsed.success) { setFilterError(parsed.error); return; }
        setFilterError(null); setFilters(parsed.data); resetPage();
      }} onReset={() => { setFilterError(null); setFilters({}); resetPage(); }}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="field">Library<select name="archive" className="input"><option value="active">Active songs</option><option value="archived">Archived songs</option><option value="all">All songs</option></select></label>
          {TEXT_FILTERS.map((filter) => <label key={filter.name} className="field">{filter.label}<input className="input" name={filter.name} /></label>)}
          <label className="field">Minimum BPM<input className="input" name="bpm_min" type="number" min="20" max="300" /></label>
          <label className="field">Maximum BPM<input className="input" name="bpm_max" type="number" min="20" max="300" /></label>
          <label className="field">Scheduled from (UTC)<input className="input" name="scheduled_from" type="date" /></label>
          <label className="field">Scheduled before (UTC)<input className="input" name="scheduled_to" type="date" /></label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="reset" variant="ghost">Clear</Button>
          <Button type="submit">Apply filters</Button>
        </div>
      </form>
      <ErrorNotice error={filterError ?? songs.error} />
      {canManage && selected.length > 0 && !editing && <div className="mb-4"><Button onClick={() => setEditing(true)}>Edit {selected.length} selected songs</Button></div>}
      {canManage && editing && <SongBulkEditor songs={rows.filter((row) => selected.includes(row.id))} onDone={() => { setEditing(false); setSelected([]); }} />}


      {songs.isLoading ? (
        <Loading />
      ) : rows.length ? (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                {canManage && <th scope="col" className="px-4 py-3">Select</th>}
                <th scope="col" className="px-4 py-3 font-medium">Title</th>
                <th scope="col" className="px-4 py-3 font-medium">BPM</th>
                <th scope="col" className="px-4 py-3 font-medium">Keys</th>
                <th scope="col" className="px-4 py-3 font-medium">Last scheduled</th>
                <th scope="col" className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((song) => (
                <tr key={song.id} className="transition hover:bg-slate-50">
                  {canManage && <td className="px-4 py-3"><input type="checkbox" aria-label={`Select ${song.title}`} checked={selected.includes(song.id)} disabled={editing} onChange={(event) => setSelected((current) => event.target.checked ? [...current, song.id] : current.filter((id) => id !== song.id))} /></td>}
                  <td className="px-4 py-3">
                    {song.archived_at && <span className="mr-2 text-xs text-slate-500">Archived</span>}
                    <Link to={`/songs/${song.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                      {song.title}
                    </Link>
                    {song.author && <p className="text-xs text-slate-500">{song.author}</p>}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{songBpm(song) ?? ''}</td>
                  <td className="px-4 py-3 font-medium text-slate-700">{songKeys(song)}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {song.last_scheduled_at ? formatDate(song.last_scheduled_at, DAY) : ''}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(song.created_at, DAY)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title={query ? 'No songs match that search' : 'No songs yet'}
          description="Add songs to build the library your plans draw from."
          action={canManage ? <Button onClick={() => setAdding(true)}>Add a song</Button> : undefined}
        />
      )}

      <div className="my-4 flex items-center justify-end gap-3">
        <Button variant="secondary" disabled={page <= 1 || songs.isFetching || editing} onClick={() => { setPage(page - 1); setSelected([]); }}>Previous</Button>
        <span className="text-sm text-slate-500">Page {page}</span>
        <Button variant="secondary" disabled={!songs.data || page * 50 >= songs.data.total || songs.isFetching || editing} onClick={() => { setPage(page + 1); setSelected([]); }}>Next</Button>
      </div>
      <AddSongModal
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={(song) => navigate(`/songs/${song.id}`)}
      />
    </div>
  );
};
