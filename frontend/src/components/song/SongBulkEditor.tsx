import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { songBulkPatchSchema, type SongBulkPreview, type SongListItem } from '@service-center/shared';
import { api } from '../../lib/api';
import { useInvalidateOrg } from '../../hooks/queries';
import { Button, ErrorNotice } from '../ui';

interface SongBulkEditorProps { songs: SongListItem[]; onDone: () => void }
const fields = ['author', 'ccli_number', 'copyright', 'administration', 'default_key', 'default_bpm', 'meter', 'themes', 'song_types', 'style', 'speed', 'notes'] as const;
type MetadataField = typeof fields[number];
const label = (value: string) => value.replaceAll('_', ' ');
const display = (value: unknown): string => Array.isArray(value) ? value.join(', ') || 'None' : String(value ?? 'None');

export const SongBulkEditor = ({ songs, onDone }: SongBulkEditorProps) => {
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
  return <section className="card mb-4 space-y-3 p-4" aria-label="Bulk song metadata">
    <h2 className="font-semibold">Edit metadata for {songs.length} selected songs</h2>
    {!preview ? <>
      <label className="block">Field<select className="input" value={field} onChange={(event) => setField(event.target.value as MetadataField)}>
        {fields.map((name) => <option key={name} value={name}>{label(name)}</option>)}
      </select></label>
      <label className="block">Replacement value<input className="input" value={value} onChange={(event) => setValue(event.target.value)} /></label>
      <p className="text-sm text-slate-500">Tags use commas. An empty value clears the field. Unselected fields stay unchanged.</p>
      <Button disabled={review.isPending || !songs.length} onClick={() => review.mutate()}>Preview changes</Button>
    </> : <>
      <p>{preview.committed_at ? 'Changes saved.' : 'Review each replacement before saving. Nothing has been changed yet.'}</p>
      <ul className="max-h-80 space-y-2 overflow-auto">{preview.rows.map((row) => <li key={row.id}>
        <strong>{row.before.title}</strong>: {Object.keys(preview.patch).map((name) => {
          const key = name as keyof typeof preview.patch;
          return `${label(key)}: ${display(row.before[key])} → ${display(row.after[key])}`;
        }).join('; ')}
      </li>)}</ul>
      {!preview.committed_at && <div className="flex gap-2">
        <Button disabled={commit.isPending} onClick={() => commit.mutate()}>Save reviewed changes</Button>
        <Button disabled={commit.isPending} onClick={() => { setPreview(null); commit.reset(); review.reset(); }}>Refresh preview</Button>
      </div>}
    </>}
    <ErrorNotice error={review.error ?? commit.error} />
    <Button disabled={review.isPending || commit.isPending} onClick={onDone}>{preview?.committed_at ? 'Done' : 'Cancel'}</Button>
  </section>;
};
