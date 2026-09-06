import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { STORAGE_BUCKETS } from '@service-center/shared';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';
import { useSongbooks, useSongs, useInvalidateOrg } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Button, EmptyState, ErrorNotice, Loading, Modal, PageHeader } from '../components/ui';

export const SongbooksPage = () => {
  const { canManage, organizationId } = useAuth();
  const navigate = useNavigate();
  const invalidate = useInvalidateOrg();
  const books = useSongbooks();
  const songs = useSongs({ sort: 'title', per_page: 200 });
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<'manual' | 'document'>('manual');
  const [selected, setSelected] = useState<string[]>([]);
  const [document, setDocument] = useState<File | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      let sourceStoragePath: string | null = null;
      if (mode === 'document') {
        if (!document || !organizationId) throw new Error('Choose a PDF, Word, or text document.');
        sourceStoragePath = `${organizationId}/${crypto.randomUUID()}-${document.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
        const { error } = await supabase.storage
          .from(STORAGE_BUCKETS.songbooks)
          .upload(sourceStoragePath, document, { contentType: document.type, upsert: false });
        if (error) throw error;
      }
      return api.createSongbook({
        title,
        description: description.trim() || null,
        source_type: mode,
        source_storage_path: sourceStoragePath,
        source_filename: mode === 'document' ? document?.name ?? null : null,
        songs: selected.map((songId) => ({
          song_id: songId,
          arrangement_id: songs.data?.data.find((song) => song.id === songId)?.arrangements.find((arrangement) => arrangement.is_default)?.id ?? null,
        })),
      });
    },
    onSuccess: async (book) => {
      await invalidate();
      setOpen(false);
      navigate(`/songbooks/${book.id}`);
    },
  });

  const toggleSong = (id: string) => setSelected((current) =>
    current.includes(id) ? current.filter((songId) => songId !== id) : [...current, id],
  );

  return (
    <div>
      <PageHeader
        title="Song books"
        subtitle="Curate your library or attach a finished document for your whole community."
        actions={canManage ? <Button onClick={() => setOpen(true)}>Create song book</Button> : undefined}
      />
      <ErrorNotice error={books.error} />
      {books.isLoading ? <Loading /> : books.data?.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {books.data.map((book) => (
            <Link key={book.id} to={`/songbooks/${book.id}`} className="card group p-5 transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lg dark:hover:border-brand-500/60">
              <div className="mb-8 flex items-start justify-between gap-4">
                <span className="grid size-11 place-items-center rounded-2xl bg-brand-50 text-xl text-brand-700 dark:bg-brand-500/15 dark:text-brand-200">♫</span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium capitalize text-slate-600 dark:bg-slate-800 dark:text-slate-300">{book.source_type}</span>
              </div>
              <h2 className="font-semibold text-slate-900 group-hover:text-brand-700 dark:text-white dark:group-hover:text-brand-200">{book.title}</h2>
              <p className="mt-1 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">{book.description || 'Ready for worship, rehearsal, and study.'}</p>
            </Link>
          ))}
        </div>
      ) : <EmptyState title="No song books yet" description="Combine your songs into a shareable, print-ready collection." action={canManage ? <Button onClick={() => setOpen(true)}>Create your first song book</Button> : undefined} />}

      <Modal open={open} title="Create a song book" onClose={() => setOpen(false)}>
        <form className="space-y-5" onSubmit={(event: FormEvent) => { event.preventDefault(); create.mutate(); }}>
          <div><label className="label" htmlFor="book-title">Title</label><input id="book-title" className="input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Sunday Favorites" required /></div>
          <div><label className="label" htmlFor="book-description">Description</label><textarea id="book-description" className="input" rows={2} value={description} onChange={(event) => setDescription(event.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1 dark:bg-slate-800">
            {(['manual', 'document'] as const).map((value) => <button key={value} type="button" onClick={() => setMode(value)} className={`rounded-xl px-3 py-2 text-sm font-medium capitalize transition ${mode === value ? 'bg-white text-brand-700 shadow-sm dark:bg-slate-700 dark:text-brand-200' : 'text-slate-500 dark:text-slate-400'}`}>{value === 'manual' ? 'Choose songs' : 'Attach document'}</button>)}
          </div>
          {mode === 'manual' ? (
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2 dark:border-slate-700">
              {songs.data?.data.map((song) => <label key={song.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800"><input type="checkbox" checked={selected.includes(song.id)} onChange={() => toggleSong(song.id)} className="size-4 accent-brand-600" /><span className="flex-1 text-sm font-medium">{song.title}</span><span className="text-xs text-slate-400">{song.default_key}</span></label>)}
            </div>
          ) : (
            <label className="flex cursor-pointer flex-col items-center rounded-2xl border border-dashed border-slate-300 p-8 text-center hover:border-brand-400 dark:border-slate-700">
              <span className="text-2xl">⇧</span><span className="mt-2 text-sm font-medium">{document?.name ?? 'Choose a document'}</span><span className="text-xs text-slate-400">PDF, DOCX, or TXT · up to 50 MB</span>
              <input className="sr-only" type="file" accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={(event: ChangeEvent<HTMLInputElement>) => setDocument(event.target.files?.[0] ?? null)} />
            </label>
          )}
          <ErrorNotice error={create.error} />
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" loading={create.isPending} disabled={mode === 'manual' ? selected.length === 0 : !document}>Create book</Button></div>
        </form>
      </Modal>
    </div>
  );
};
