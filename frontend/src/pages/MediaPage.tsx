import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import {
  ApiError,
  LocalizedError,
  formatDuration,
  type MediaDetail,
  type MediaSummary,
  type UpdateMediaInput,
} from '@service-center/shared';
import { useInvalidateMedia, useMediaDetail, useMediaList } from '../hooks/queries';
import { api } from '../lib/api';
import { Badge, Button, EmptyState, ErrorNotice, Modal, PageHeader, SkeletonList } from '../components/ui';
import { Icon } from '../components/icons';
import { FilesPanel } from '../components/files/FilesPanel';
import { useErrorText, useFormatters } from '../i18n';

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

/** Text for a failed media change; a stale revision gets its own explanation. */
const useMediaErrorText = (): ((error: unknown) => string | null) => {
  const { t } = useTranslation('media');
  const errorText = useErrorText();
  return (error) => {
    if (!error) return null;
    if (error instanceof ApiError && error.code === 'media_revision_stale') return t('mediaErrors.revisionStale');
    return errorText(error);
  };
};

/** F14: reusable media bundles (videos, cues, graphics) kept apart from songs and song books. */
export const MediaLibraryPage = () => {
  const { t } = useTranslation('media');
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const list = useMediaList({ q: query.trim() || undefined, include_archived: showArchived });
  const rows = list.data?.media ?? [];

  return (
    <div>
      <PageHeader
        title={t('library.title')}
        subtitle={t('library.subtitle')}
        actions={list.data?.can_create && <Button icon="plus" onClick={() => setAdding(true)}>{t('library.add')}</Button>}
      />
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <input type="search" className="input pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('library.searchPlaceholder')} aria-label={t('library.searchLabel')} />
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
          <input type="checkbox" className="size-4 rounded border-slate-300 accent-brand-600" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
          {t('library.includeArchived')}
        </label>
      </div>
      {list.isLoading ? (
        <SkeletonList rows={4} />
      ) : list.error ? (
        <ErrorNotice error={list.error} />
      ) : rows.length === 0 ? (
        <EmptyState icon="media" title={t('library.emptyTitle')} description={t('library.emptyDescription')} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((media) => (
            <MediaRowView key={media.id} media={media} />
          ))}
        </ul>
      )}
      {adding && <CreateMediaModal onClose={() => setAdding(false)} onCreated={(id) => navigate(`/media/${id}`)} />}
    </div>
  );
};

interface MediaRowViewProps {
  media: MediaSummary;
}

/** One media bundle in the library grid. */
const MediaRowView = ({ media }: MediaRowViewProps) => {
  const { t } = useTranslation('media');
  const formatters = useFormatters();
  const chips = [...media.themes, ...media.tags];
  return (
    <li>
      <Link to={`/media/${media.id}`} className={`card card-interactive group flex h-full flex-col gap-3 p-4 ${media.is_archived ? 'opacity-75' : ''}`}>
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-50 to-brand-50 text-brand-600 ring-1 ring-inset ring-brand-100 dark:from-violet-500/10 dark:to-brand-500/10 dark:text-brand-200 dark:ring-brand-500/20">
            <Icon name="media" className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-slate-900 group-hover:text-brand-700 dark:text-white dark:group-hover:text-brand-200">{media.title}</p>
            {media.creator && <p className="truncate text-xs text-slate-500 dark:text-slate-400">{media.creator}</p>}
          </div>
          {media.is_archived && <Badge tone="bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/25">{t('files.archived')}</Badge>}
        </div>
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1" aria-label={t('library.columns.themes')}>
            {chips.slice(0, 5).map((chip, index) => (
              <span key={`${index}-${chip}`} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{chip}</span>
            ))}
            {chips.length > 5 && <span className="px-1 text-[11px] text-slate-400">+{chips.length - 5}</span>}
          </div>
        )}
        <dl className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-app-border pt-3 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-1.5">
            <dt><Icon name="clock" className="size-3.5" /><span className="sr-only">{t('library.columns.length')}</span></dt>
            <dd className="tabular-nums">{media.duration_seconds !== null ? formatDuration(media.duration_seconds) : '—'}</dd>
          </div>
          <div className="flex min-w-0 items-center gap-1.5">
            <dt><Icon name="calendar" className="size-3.5" /><span className="sr-only">{t('library.columns.lastUsed')}</span></dt>
            <dd className="truncate">
              {media.last_used_on ? formatters.calendarDate(media.last_used_on, 'medium') : t('library.never')}
              {media.usage_count > 0 && <> · {t('library.usageCount', { count: media.usage_count })}</>}
            </dd>
          </div>
        </dl>
      </Link>
    </li>
  );
};

interface CreateMediaModalProps {
  onClose: () => void;
  onCreated: (id: string) => void;
}

const CreateMediaModal = ({ onClose, onCreated }: CreateMediaModalProps) => {
  const { t } = useTranslation(['media', 'common']);
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
    <Modal open title={t('library.add')} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <label className="block">
          <span className="label">{t('form.title')}</span>
          <input className="input" required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
        </label>
        <ErrorNotice error={create.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t('common:actions.cancel')}</Button>
          <Button type="submit" loading={create.isPending} disabled={!title.trim()}>{t('common:actions.create')}</Button>
        </div>
      </form>
    </Modal>
  );
};

export const MediaDetailPage = () => {
  const { t } = useTranslation('media');
  const formatters = useFormatters();
  const { mediaId } = useParams();
  const navigate = useNavigate();
  const detail = useMediaDetail(mediaId);
  const invalidate = useInvalidateMedia();

  if (detail.isLoading) return <SkeletonList rows={3} />;
  if (detail.error || !detail.data) return <ErrorNotice error={detail.error ?? new LocalizedError({ key: 'media:detail.notFound' })} />;
  const media = detail.data;

  return (
    <div className="space-y-4">
      <PageHeader
        back={{ to: '/media', label: t('detail.allMedia') }}
        title={media.title}
        subtitle={[media.creator, media.duration_seconds !== null ? formatDuration(media.duration_seconds) : null].filter(Boolean).join(' · ') || t('library.title')}
      />
      {media.is_archived && (
        <p role="status" className="flex items-start gap-2.5 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/25">
          <Icon name="alert" className="mt-px size-4 shrink-0" />
          {media.archive_on && !media.archived_at
            ? t('detail.archivedSince', { date: formatters.calendarDate(media.archive_on, 'medium') })
            : t('detail.archived')}
        </p>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="min-w-0 space-y-6">
          <MediaForm key={media.revision} media={media} onSaved={() => void invalidate()} onDeleted={() => navigate('/media')} />
          <FilesPanel
            owner={{ kind: 'media', id: media.id }}
            title={t('filesPanel.title')}
            description={t('detail.filesDescription')}
            emptyText={t('filesPanel.empty')}
          />
        </div>
        <div className="space-y-6">
          <Thumbnail media={media} />
          <section className="card p-5">
            <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
              <Icon name="plans" className="size-4 text-slate-400" />
              {t('detail.usedIn')}
            </h2>
            {media.usage.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">{t('detail.notUsed')}</p>
            ) : (
              <ul className="row-list -mx-5 text-sm">
                {media.usage.map((use) => (
                  <li key={use.item_id} className="px-5 py-2.5">
                    <Link className="font-medium text-slate-900 hover:text-brand-700 dark:text-white dark:hover:text-brand-200" to={`/plans/${use.plan_id}`}>
                      {use.plan_title}
                    </Link>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                      {formatters.calendarDate(use.service_date, 'medium')} · {use.item_title}
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

interface ThumbnailProps {
  media: MediaDetail;
}

const Thumbnail = ({ media }: ThumbnailProps) => {
  const { t } = useTranslation(['media', 'common']);
  const mediaError = useMediaErrorText();
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
      <h2 className="mb-3 font-semibold text-slate-900 dark:text-white">{t('thumbnail.title')}</h2>
      {url ? (
        <img src={url} alt={t('thumbnail.alt', { title: media.title })} className="mb-3 aspect-video w-full rounded-xl object-cover ring-1 ring-app-border" />
      ) : (
        <div className="surface-inset mb-3 flex aspect-video flex-col items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Icon name="media" className="size-6 text-slate-400" />
          {t('thumbnail.none')}
        </div>
      )}
      {media.can_edit && (
        <select
          className="input"
          aria-label={t('thumbnail.selectLabel')}
          value={media.thumbnail_file_id ?? ''}
          onChange={(event) => choose.mutate(event.target.value || null)}
        >
          <option value="">{t('common:states.none')}</option>
          {images.map((file) => (
            <option key={file.id} value={file.id}>{file.title}</option>
          ))}
        </select>
      )}
      {media.can_edit && images.length === 0 && <p className="mt-1 text-xs text-slate-500">{t('thumbnail.uploadHint')}</p>}
      {choose.error && <p role="alert" className="mt-1 text-xs text-rose-700">{mediaError(choose.error)}</p>}
    </section>
  );
};

interface MediaFormProps {
  media: MediaDetail;
  onSaved: () => void;
  onDeleted: () => void;
}

const MediaForm = ({ media, onSaved, onDeleted }: MediaFormProps) => {
  const { t } = useTranslation(['media', 'common']);
  const mediaError = useMediaErrorText();
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
      setFormError(t('form.durationInvalid'));
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
        <p className="text-slate-500">
          {t('form.readOnlyLabels', { themes: media.themes.join(', ') || '—', tags: media.tags.join(', ') || '—' })}
        </p>
      </section>
    );
  }

  return (
    <form className="card grid overflow-hidden gap-4 p-5 sm:grid-cols-2 sm:p-6" onSubmit={submit}>
      <label className="block sm:col-span-2">
        <span className="label">{t('form.title')}</span>
        <input className="input" required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label className="block">
        <span className="label">{t('form.creator')}</span>
        <input className="input" maxLength={200} value={creator} onChange={(event) => setCreator(event.target.value)} />
      </label>
      <label className="block">
        <span className="label">{t('form.length')}</span>
        <input className="input" value={duration} onChange={(event) => setDuration(event.target.value)} placeholder="2:30" />
      </label>
      <label className="block">
        <span className="label">{t('form.themes')}</span>
        <input className="input" value={themes} onChange={(event) => setThemes(event.target.value)} />
      </label>
      <label className="block">
        <span className="label">{t('form.tags')}</span>
        <input className="input" value={tags} onChange={(event) => setTags(event.target.value)} />
      </label>
      <label className="block sm:col-span-2">
        <span className="label">{t('form.notes')}</span>
        <textarea className="input" rows={3} maxLength={5000} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      <label className="block">
        <span className="label">{t('form.archiveOn')}</span>
        <input className="input" type="date" value={archiveOn} onChange={(event) => setArchiveOn(event.target.value)} />
        <span className="mt-1 block text-xs text-slate-500">{t('form.archiveOnHint')}</span>
      </label>
      <div className="sm:col-span-2">
        {formError && <p role="alert" className="mb-2 text-sm text-rose-700">{formError}</p>}
        {[save.error, archive.error, remove.error].map((error, index) =>
          error ? (
            <p key={index} role="alert" className="mb-2 text-sm text-rose-700">{mediaError(error)}</p>
          ) : null,
        )}
        <div className="-mx-5 -mb-5 flex flex-wrap items-center gap-2 border-t border-app-border bg-slate-50/70 px-5 py-3 sm:-mx-6 sm:-mb-6 sm:px-6 dark:bg-slate-950/30">
          <Button
            type="button"
            variant="ghost"
            icon="trash"
            className="text-rose-600 hover:!bg-rose-50 hover:!text-rose-700 dark:text-rose-400 dark:hover:!bg-rose-500/10"
            loading={remove.isPending}
            onClick={() => {
              if (window.confirm(t('form.deleteConfirm', { title: media.title }))) remove.mutate();
            }}
          >
            {t('form.delete')}
          </Button>
          <span className="flex-1" />
          <Button type="button" variant="secondary" loading={archive.isPending} onClick={() => archive.mutate()}>
            {media.is_archived ? t('common:actions.restore') : t('common:actions.archive')}
          </Button>
          <Button type="submit" loading={save.isPending}>{t('common:actions.save')}</Button>
        </div>
      </div>
    </form>
  );
};
