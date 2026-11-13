import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { LocalizedError, STORAGE_BUCKETS } from '@service-center/shared';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';
import { useSongbooks, useSongs, useInvalidateOrg } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Button, EmptyState, ErrorNotice, Modal, PageHeader, SkeletonList } from '../components/ui';
import { Icon } from '../components/icons';

export const SongbooksPage = () => {
  const { t } = useTranslation(['songs', 'common']);
  const { canAnywhere, organizationId } = useAuth();
  // The song library is organization-wide; leading a team never implies it.
  const canManage = canAnywhere('songs.manage');
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
        if (!document || !organizationId) throw new LocalizedError({ key: 'songs:errors.chooseDocument' });
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
        title={t('common:nav.songbooks')}
        subtitle={t('songbooksPage.subtitle')}
        actions={canManage ? <Button icon="plus" onClick={() => setOpen(true)}>{t('songbooksPage.create')}</Button> : undefined}
      />
      <div className="mb-4 empty:hidden"><ErrorNotice error={books.error} /></div>
      {books.isLoading ? <SkeletonList rows={3} /> : books.data?.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {books.data.map((book) => (
            <Link key={book.id} to={`/songbooks/${book.id}`} className="card card-interactive group flex flex-col p-5">
              <div className="mb-6 flex items-start justify-between gap-4">
                <span className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-violet-700 text-white shadow-sm shadow-brand-600/30">
                  <Icon name={book.source_type === 'document' ? 'document' : 'music'} className="size-5" />
                </span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium capitalize text-slate-600 dark:bg-slate-800 dark:text-slate-300">{t(`songbooksPage.sourceType.${book.source_type}`)}</span>
              </div>
              <h2 className="font-semibold text-slate-900 group-hover:text-brand-700 dark:text-white dark:group-hover:text-brand-200">{book.title}</h2>
              <p className="mt-1 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">{book.description || t('songbooksPage.defaultDescription')}</p>
              <Icon name="chevronRight" className="mt-4 size-4 self-end text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-500 dark:text-slate-600" />
            </Link>
          ))}
        </div>
      ) : <EmptyState icon="music" title={t('songbooksPage.empty')} description={t('songbooksPage.emptyDescription')} action={canManage ? <Button icon="plus" onClick={() => setOpen(true)}>{t('songbooksPage.createFirst')}</Button> : undefined} />}

      <Modal open={open} title={t('songbooksPage.modalTitle')} onClose={() => setOpen(false)}>
        <form className="space-y-5" onSubmit={(event: FormEvent) => { event.preventDefault(); create.mutate(); }}>
          <div><label className="label" htmlFor="book-title">{t('songbooksPage.fields.title')}</label><input id="book-title" className="input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t('songbooksPage.fields.titlePlaceholder')} required /></div>
          <div><label className="label" htmlFor="book-description">{t('songbooksPage.fields.description')}</label><textarea id="book-description" className="input" rows={2} value={description} onChange={(event) => setDescription(event.target.value)} /></div>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 ring-1 ring-inset ring-slate-200/60 dark:bg-slate-800/70 dark:ring-slate-700/60">
            {(['manual', 'document'] as const).map((value) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)} className={`rounded-lg px-3 py-2 text-sm font-medium transition ${mode === value ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100'}`}>{value === 'manual' ? t('songbooksPage.chooseSongs') : t('songbooksPage.attachDocument')}</button>)}
          </div>
          {mode === 'manual' ? (
            <div className="scrollbar-thin max-h-64 space-y-0.5 overflow-y-auto rounded-xl border border-app-border p-1.5">
              {songs.data?.data.map((song) => <label key={song.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800"><input type="checkbox" checked={selected.includes(song.id)} onChange={() => toggleSong(song.id)} className="size-4 accent-brand-600" /><span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 dark:text-slate-100">{song.title}</span>{song.default_key && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{song.default_key}</span>}</label>)}
            </div>
          ) : (
            <label className="flex cursor-pointer flex-col items-center rounded-2xl border border-dashed border-slate-300 p-8 text-center transition hover:border-brand-400 hover:bg-brand-50/40 focus-within:border-brand-500 dark:border-slate-700 dark:hover:bg-brand-500/5">
              <span className="grid size-11 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-200"><Icon name="upload" className="size-5" /></span><span className="mt-3 text-sm font-medium text-slate-800 dark:text-slate-100">{document?.name ?? t('songbooksPage.chooseDocument')}</span><span className="text-xs text-slate-400">{t('songbooksPage.documentHint')}</span>
              <input className="sr-only" type="file" accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={(event: ChangeEvent<HTMLInputElement>) => setDocument(event.target.files?.[0] ?? null)} />
            </label>
          )}
          <ErrorNotice error={create.error} />
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>{t('common:actions.cancel')}</Button><Button type="submit" loading={create.isPending} disabled={mode === 'manual' ? selected.length === 0 : !document}>{t('songbooksPage.submit')}</Button></div>
        </form>
      </Modal>
    </div>
  );
};
