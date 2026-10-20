import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { songBulkPatchSchema, type SongBulkPreview, type SongListItem, type TranslationKey } from '@service-center/shared';
import { api } from '../../lib/api';
import { useInvalidateOrg } from '../../hooks/queries';
import { Button, ErrorNotice } from '../ui';

interface SongBulkEditorProps { songs: SongListItem[]; onDone: () => void }
const fields = ['author', 'ccli_number', 'copyright', 'administration', 'default_key', 'default_bpm', 'meter', 'themes', 'song_types', 'style', 'speed', 'notes'] as const;
type MetadataField = typeof fields[number];
/** Catalog keys for the editable metadata fields, by field name. */
const FIELD_LABEL_KEYS: Readonly<Record<MetadataField, TranslationKey<'songs'>>> = {
  author: 'bulk.fields.author',
  ccli_number: 'bulk.fields.ccliNumber',
  copyright: 'bulk.fields.copyright',
  administration: 'bulk.fields.administration',
  default_key: 'bulk.fields.defaultKey',
  default_bpm: 'bulk.fields.defaultBpm',
  meter: 'bulk.fields.meter',
  themes: 'bulk.fields.themes',
  song_types: 'bulk.fields.songTypes',
  style: 'bulk.fields.style',
  speed: 'bulk.fields.speed',
  notes: 'bulk.fields.notes',
};
const isMetadataField = (value: string): value is MetadataField => (fields as readonly string[]).includes(value);
/** Shows a value; `none` is the localized word for an empty one. */
const display = (value: unknown, none: string): string => Array.isArray(value) ? value.join(', ') || none : String(value ?? none);

export const SongBulkEditor = ({ songs, onDone }: SongBulkEditorProps) => {
  const { t } = useTranslation(['songs', 'common']);
  const none = t('common:states.none');
  const label = (name: string): string => (isMetadataField(name) ? t(FIELD_LABEL_KEYS[name]) : name.replaceAll('_', ' '));
  const invalidate = useInvalidateOrg();
  const [field, setField] = useState<MetadataField>('themes');
  const [value, setValue] = useState('');
  const [preview, setPreview] = useState<SongBulkPreview | null>(null);
  const review = useMutation({
    mutationFn: () => {
      const next: unknown = field === 'themes' || field === 'song_types'
        ? value.split(',').map((tag) => tag.trim()).filter(Boolean)
        : value === '' ? null : field === 'default_bpm' ? Number(value) : value;
      return api.previewSongBulk({ rows: songs.map((song) => ({ id: song.id, expected_revision: song.revision })),
        patch: songBulkPatchSchema.parse({ [field]: next }) });
    },
    onSuccess: setPreview,
    onError: () => { void invalidate(); },
  });
  const commit = useMutation({
    mutationFn: () => api.commitSongBulk({ preview_id: preview!.id }),
    onSuccess: async (result) => { setPreview(result); await invalidate(); },
    onError: () => { void invalidate(); },
  });
  return <section className="card mb-4 space-y-3 p-4" aria-label={t('bulk.sectionLabel')}>
    <h2 className="font-semibold">{t('bulk.title', { count: songs.length })}</h2>
    {!preview ? <>
      <label className="field">{t('bulk.field')}<select className="input" value={field} onChange={(event) => setField(event.target.value as MetadataField)}>
        {fields.map((name) => <option key={name} value={name}>{label(name)}</option>)}
      </select></label>
      <label className="field">{t('bulk.value')}<input className="input" value={value} onChange={(event) => setValue(event.target.value)} /></label>
      <p className="text-sm text-slate-500">{t('bulk.help')}</p>
      <Button disabled={review.isPending || !songs.length} onClick={() => review.mutate()}>{t('bulk.preview')}</Button>
    </> : <>
      <p>{preview.committed_at ? t('bulk.saved') : t('bulk.reviewHelp')}</p>
      <ul className="max-h-80 space-y-2 overflow-auto">{preview.rows.map((row) => <li key={row.id}>
        <strong>{row.before.title}</strong>: {Object.keys(preview.patch).map((name) => {
          const key = name as keyof typeof preview.patch;
          return t('bulk.change', { field: label(key), before: display(row.before[key], none), after: display(row.after[key], none) });
        }).join('; ')}
      </li>)}</ul>
      {!preview.committed_at && <div className="flex gap-2">
        <Button disabled={commit.isPending} onClick={() => commit.mutate()}>{t('bulk.save')}</Button>
        <Button disabled={commit.isPending} onClick={() => { setPreview(null); commit.reset(); review.reset(); }}>{t('imports.refreshPreview')}</Button>
      </div>}
    </>}
    <ErrorNotice error={review.error ?? commit.error} />
    <Button disabled={review.isPending || commit.isPending} onClick={onDone}>{preview?.committed_at ? t('common:actions.done') : t('common:actions.cancel')}</Button>
  </section>;
};
