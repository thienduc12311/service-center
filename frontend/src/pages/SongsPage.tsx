import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useSongs, useInvalidateOrg } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Button, EmptyState, ErrorNotice, Loading, Modal, PageHeader } from '../components/ui';

export const SongsPage = () => {
  const { canManage } = useAuth();
  const invalidate = useInvalidateOrg();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'title' | 'recent'>('title');
  const [creating, setCreating] = useState(false);
  const songs = useSongs({ q: query || undefined, sort, per_page: 100 });

  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [key, setKey] = useState('');

  const create = useMutation({
    mutationFn: () =>
      api.createSong({ title, author: author || null, default_key: key || null }),
    onSuccess: async () => {
      await invalidate();
      setCreating(false);
      setTitle('');
      setAuthor('');
      setKey('');
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

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
              onChange={(e) => setSort(e.target.value as 'title' | 'recent')}
            >
              <option value="title">A–Z</option>
              <option value="recent">Recently updated</option>
            </select>
            {canManage && <Button onClick={() => setCreating(true)}>Add song</Button>}
          </div>
        }
      />

      <input
        className="input mb-4 max-w-sm"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search songs…"
        aria-label="Search songs"
      />

      <ErrorNotice error={songs.error} />

      {songs.isLoading ? (
        <Loading />
      ) : songs.data?.data.length ? (
        <ul className="card divide-y divide-slate-100">
          {songs.data.data.map((song) => (
            <li key={song.id}>
              <Link to={`/songs/${song.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-slate-50">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{song.title}</p>
                  <p className="text-sm text-slate-500">
                    {song.author ?? 'Unknown author'}
                    {song.themes.length > 0 && ` · ${song.themes.join(', ')}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-sm text-slate-400">
                  {song.default_key && <span className="font-medium text-slate-600">{song.default_key}</span>}
                  {song.default_bpm && <span>{song.default_bpm} bpm</span>}
                  <span>
                    {song.arrangements.length} arrangement{song.arrangements.length === 1 ? '' : 's'}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title={query ? 'No songs match that search' : 'No songs yet'}
          description="Add songs to build the library your plans draw from."
          action={canManage ? <Button onClick={() => setCreating(true)}>Add a song</Button> : undefined}
        />
      )}

      <Modal open={creating} title="Add song" onClose={() => setCreating(false)}>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="song-title">Title</label>
            <input id="song-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="song-author">Author</label>
            <input id="song-author" className="input" value={author} onChange={(e) => setAuthor(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="song-key">Default key</label>
            <input
              id="song-key"
              className="input"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="G"
              maxLength={8}
            />
          </div>

          <ErrorNotice error={create.error} />

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending}>
              Add song
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
