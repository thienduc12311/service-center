import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import {
  ApiError,
  formatDate,
  formatDuration,
  type MediaDetail,
  type MediaSummary,
  type UpdateMediaInput,
} from '@service-center/shared';
import { useInvalidateMedia, useMediaDetail, useMediaList } from '../hooks/queries';
import { api } from '../lib/api';
import { Badge, Button, EmptyState, ErrorNotice, Loading, Modal, PageHeader } from '../components/ui';
import { FilesPanel } from '../components/files/FilesPanel';

const DAY = { month: 'short', day: 'numeric', year: 'numeric' } as const;

/** "1:30" or "90" (seconds) → seconds; blank → null. */
const parseDuration = (value: string): number | null | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = /^(?:(\d+):)?(\d{1,2}|\d+)$/.exec(trimmed);
  if (!match) return undefined;
  return match[1] ? Number(match[1]) * 60 + Number(match[2]) : Number(match[2]);
};
const labels = (value: string): string[] =>
  [...new Set(value.split(',').map((part) => part.trim()).filter(Boolean))].slice(0, 20);

const mediaError = (error: unknown): string | null => {
  if (!error) return null;
  if (error instanceof ApiError) {
    if (error.code === 'media_revision_stale') return 'Someone else changed this media. It has been reloaded — check it and try again.';
    if (error.code === 'media_in_use') return error.message;
    return error.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong';
};

/** F14: reusable media bundles (videos, cues, graphics) kept apart from songs and song books. */
export const MediaLibraryPage = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const list = useMediaList({ q: query.trim() || undefined, include_archived: showArchived });
  const rows = list.data?.media ?? [];

  return (
    <div>
      <PageHeader
        title="Media"
        subtitle="Reusable videos, cues and graphics you can link to items in a plan's order."
        actions={list.data?.can_create && <Button onClick={() => setAdding(true)}>Add media</Button>}
      />
      <div className="card mb-4 flex flex-wrap items-center gap-3 px-4 py-3">
        <input className="input max-w-sm" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by title" aria-label="Search media" />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
          Include archived
        </label>
      </div>
      {list.isLoading ? (
        <Loading />
      ) : list.error ? (
        <ErrorNotice error={list.error} />
      ) : rows.length === 0 ? (
        <EmptyState title="No media yet" description="Add a bundle, then attach its files and link it to order items." />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-widest text-slate-400">
              <tr>
                <th className="px-4 py-2">Title</th>
                <th className="px-4 py-2">Length</th>
                <th className="px-4 py-2">Themes</th>
                <th className="px-4 py-2">Last used</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((media) => (
                <MediaRowView key={media.id} media={media} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <CreateMediaModal onClose={() => setAdding(false)} onCreated={(id) => navigate(`/media/${id}`)} />}
    </div>
  );
};

const MediaRowView = ({ media }: { media: MediaSummary }) => (
  <tr>
    <td className="px-4 py-2">
      <Link to={`/media/${media.id}`} className="font-medium hover:underline">
        {media.title}
      </Link>
      {media.is_archived && (
        <span className="ml-2">
          <Badge tone="bg-amber-50 text-amber-800 ring-amber-600/20">Archived</Badge>
        </span>
      )}
      {media.creator && <span className="block text-xs text-slate-500">{media.creator}</span>}
    </td>
    <td className="px-4 py-2 tabular-nums text-slate-500">{media.duration_seconds !== null ? formatDuration(media.duration_seconds) : '—'}</td>
    <td className="px-4 py-2 text-slate-500">{[...media.themes, ...media.tags].join(', ') || '—'}</td>
    <td className="px-4 py-2 text-slate-500">
      {media.last_used_on ? formatDate(media.last_used_on, DAY) : 'Never'}
      {media.usage_count > 0 && <span className="text-xs"> · {media.usage_count}×</span>}
    </td>
  </tr>
);

const CreateMediaModal = ({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) => {
  const invalidate = useInvalidateMedia();
  const [title, setTitle] = useState('');
  const create = useMutation({
    mutationFn: () => api.createMedia({ title: title.trim() }),
    onSuccess: async (media) => {
      await invalidate();
      onCreated(media.id);
    },
  });
  return (
    <Modal open title="Add media" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <label className="block">
          <span className="label">Title</span>
          <input className="input" required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
        </label>
        <ErrorNotice error={create.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={create.isPending} disabled={!title.trim()}>Create</Button>
        </div>
      </form>
    </Modal>
  );
};

export const MediaDetailPage = () => {
  const { mediaId } = useParams();
  const navigate = useNavigate();
  const detail = useMediaDetail(mediaId);
  const invalidate = useInvalidateMedia();

  if (detail.isLoading) return <Loading />;
  if (detail.error || !detail.data) return <ErrorNotice error={detail.error ?? new Error('Media not found')} />;
  const media = detail.data;

  return (
    <div className="space-y-4">
      <PageHeader
        title={media.title}
        subtitle={[media.creator, media.duration_seconds !== null ? formatDuration(media.duration_seconds) : null].filter(Boolean).join(' · ') || 'Media'}
        actions={<Link to="/media" className="text-sm text-slate-500 hover:underline">All media</Link>}
      />
      {media.is_archived && (
        <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-600/20">
          Archived{media.archive_on && !media.archived_at ? ` since ${formatDate(media.archive_on, DAY)}` : ''}: hidden from pickers.
          Plans that already use it keep it.
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <MediaForm key={media.revision} media={media} onSaved={() => void invalidate()} onDeleted={() => navigate('/media')} />
          <FilesPanel
            owner={{ kind: 'media', id: media.id }}
            title="Files"
            description="Videos, audio, images and documents for this media. Each keeps its versions and audience."
            emptyText="No files yet."
          />
        </div>
        <div className="space-y-4">
          <Thumbnail media={media} />
          <section className="card p-5">
            <h2 className="mb-2 font-semibold text-slate-900 dark:text-white">Used in plans</h2>
            {media.usage.length === 0 ? (
              <p className="text-sm text-slate-500">Not linked to any plan yet. Link it from an item's “Media” button on the Order tab.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {media.usage.map((use) => (
                  <li key={use.item_id} className="py-2">
                    <Link className="font-medium hover:underline" to={`/plans/${use.plan_id}`}>
                      {use.plan_title}
                    </Link>
                    <span className="block text-xs text-slate-500">
                      {formatDate(use.service_date, DAY)} · {use.item_title}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

const Thumbnail = ({ media }: { media: MediaDetail }) => {
  const [url, setUrl] = useState<string | null>(null);
  const invalidate = useInvalidateMedia();
  const images = media.files.filter((file) => file.category === 'image' && file.kind === 'upload' && file.current_version && !file.archived_at);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (media.thumbnail_file_id) {
      api
        .fileDownload(media.thumbnail_file_id, { disposition: 'inline' })
        .then((result) => live && setUrl(result.url))
        .catch(() => live && setUrl(null));
    }
    return () => {
      live = false;
    };
  }, [media.thumbnail_file_id]);
  const choose = useMutation({
    mutationFn: (fileId: string | null) => api.updateMedia(media.id, { expected_revision: media.revision, thumbnail_file_id: fileId }),
    onSettled: () => void invalidate(),
  });
  return (
    <section className="card p-5">
      <h2 className="mb-2 font-semibold text-slate-900 dark:text-white">Thumbnail</h2>
      {url ? (
        <img src={url} alt={`Thumbnail for ${media.title}`} className="mb-3 max-h-40 rounded" />
      ) : (
        <p className="mb-3 text-sm text-slate-500">No thumbnail.</p>
      )}
      {media.can_edit && (
        <select
          className="input"
          aria-label="Thumbnail image"
          value={media.thumbnail_file_id ?? ''}
          onChange={(event) => choose.mutate(event.target.value || null)}
        >
          <option value="">None</option>
          {images.map((file) => (
            <option key={file.id} value={file.id}>{file.title}</option>
          ))}
        </select>
      )}
      {media.can_edit && images.length === 0 && <p className="mt-1 text-xs text-slate-500">Upload an image under Files to use it here.</p>}
      {choose.error && <p role="alert" className="mt-1 text-xs text-rose-700">{mediaError(choose.error)}</p>}
    </section>
  );
};

const MediaForm = ({ media, onSaved, onDeleted }: { media: MediaDetail; onSaved: () => void; onDeleted: () => void }) => {
  const [title, setTitle] = useState(media.title);
  const [creator, setCreator] = useState(media.creator ?? '');
  const [duration, setDuration] = useState(media.duration_seconds !== null ? formatDuration(media.duration_seconds) : '');
  const [themes, setThemes] = useState(media.themes.join(', '));
  const [tags, setTags] = useState(media.tags.join(', '));
  const [notes, setNotes] = useState(media.notes ?? '');
  const [archiveOn, setArchiveOn] = useState(media.archive_on ?? '');
  const [formError, setFormError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (input: UpdateMediaInput) => api.updateMedia(media.id, input),
    onSettled: onSaved,
  });
  const archive = useMutation({
    mutationFn: () => api.archiveMedia(media.id, { archived: !media.is_archived, expected_revision: media.revision }),
    onSettled: onSaved,
  });
  const remove = useMutation({
    mutationFn: () => api.deleteMedia(media.id, media.revision),
    onSuccess: onDeleted,
    onError: onSaved,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const seconds = parseDuration(duration);
    if (seconds === undefined) {
      setFormError('Enter the length as minutes:seconds, like 2:30.');
      return;
    }
    setFormError(null);
    save.mutate({
      expected_revision: media.revision,
      title: title.trim(),
      creator: creator.trim() || null,
      duration_seconds: seconds,
      themes: labels(themes),
      tags: labels(tags),
      notes: notes.trim() || null,
      archive_on: archiveOn || null,
    });
  };

  if (!media.can_edit) {
    return (
      <section className="card space-y-2 p-5 text-sm">
        {media.notes && <p className="whitespace-pre-wrap">{media.notes}</p>}
        <p className="text-slate-500">Themes: {media.themes.join(', ') || '—'} · Tags: {media.tags.join(', ') || '—'}</p>
      </section>
    );
  }

  return (
    <form className="card grid gap-4 p-5 sm:grid-cols-2" onSubmit={submit}>
      <label className="block sm:col-span-2">
        <span className="label">Title</span>
        <input className="input" required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label className="block">
        <span className="label">Creator</span>
        <input className="input" maxLength={200} value={creator} onChange={(event) => setCreator(event.target.value)} />
      </label>
      <label className="block">
        <span className="label">Length (m:ss)</span>
        <input className="input" value={duration} onChange={(event) => setDuration(event.target.value)} placeholder="2:30" />
      </label>
      <label className="block">
        <span className="label">Themes (comma separated)</span>
        <input className="input" value={themes} onChange={(event) => setThemes(event.target.value)} />
      </label>
      <label className="block">
        <span className="label">Tags (comma separated)</span>
        <input className="input" value={tags} onChange={(event) => setTags(event.target.value)} />
      </label>
      <label className="block sm:col-span-2">
        <span className="label">Notes</span>
        <textarea className="input" rows={3} maxLength={5000} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      <label className="block">
        <span className="label">Archive automatically on</span>
        <input className="input" type="date" value={archiveOn} onChange={(event) => setArchiveOn(event.target.value)} />
        <span className="mt-1 block text-xs text-slate-500">From this date it leaves pickers; plans that use it keep it.</span>
      </label>
      <div className="sm:col-span-2">
        {formError && <p role="alert" className="mb-2 text-sm text-rose-700">{formError}</p>}
        {[save.error, archive.error, remove.error].map((error, index) =>
          error ? (
            <p key={index} role="alert" className="mb-2 text-sm text-rose-700">{mediaError(error)}</p>
          ) : null,
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="danger"
            loading={remove.isPending}
            onClick={() => {
              if (window.confirm(`Delete “${media.title}” and its files? Plans that use it must be unlinked first.`)) remove.mutate();
            }}
          >
            Delete…
          </Button>
          <Button type="button" variant="secondary" loading={archive.isPending} onClick={() => archive.mutate()}>
            {media.is_archived ? 'Restore' : 'Archive'}
          </Button>
          <Button type="submit" loading={save.isPending}>Save</Button>
        </div>
      </div>
    </form>
  );
};
