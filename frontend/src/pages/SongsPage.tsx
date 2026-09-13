import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatDate, type SongListItem } from '@service-center/shared';
import { useSongs } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Button, EmptyState, ErrorNotice, Loading, PageHeader } from '../components/ui';
import { AddSongModal } from '../components/AddSongModal';

const DAY = { month: 'short', day: 'numeric', year: 'numeric' } as const;

/** The keys a song is actually played in — its arrangements, not just the default. */
const songKeys = (song: SongListItem): string => {
  const keys = song.arrangements.map((arrangement) => arrangement.song_key).filter(Boolean);
  const unique = [...new Set(keys.length ? keys : [song.default_key])].filter(Boolean);
  return unique.join(', ');
};

const songBpm = (song: SongListItem): number | null =>
  song.default_bpm ?? song.arrangements.find((arrangement) => arrangement.bpm)?.bpm ?? null;

export const SongsPage = () => {
  const { canManage } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'title' | 'recent'>('title');
  const [adding, setAdding] = useState(false);
  const songs = useSongs({ q: query || undefined, sort, per_page: 100 });

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
              className="input w-36"
              value={sort}
              onChange={(event) => setSort(event.target.value as 'title' | 'recent')}
            >
              <option value="title">A–Z</option>
              <option value="recent">Recently updated</option>
            </select>
            {canManage && <Button onClick={() => setAdding(true)}>Add a song</Button>}
          </div>
        }
      />

      <div className="card mb-4 flex flex-wrap items-center gap-3 px-4 py-3">
        <input
          className="input max-w-sm"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Add text filter"
          aria-label="Search songs"
        />
        {songs.data && (
          <span className="text-sm text-slate-500">
            {songs.data.total} song{songs.data.total === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <ErrorNotice error={songs.error} />

      {songs.isLoading ? (
        <Loading />
      ) : rows.length ? (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
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
                  <td className="px-4 py-3">
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

      <AddSongModal
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={(song) => navigate(`/songs/${song.id}`)}
      />
    </div>
  );
};
