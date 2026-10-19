import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { labeledKeyInputSchema, duplicateArrangementSchema, type ArrangementRow, type LabeledKeyInput, type DuplicateArrangementPreview } from '@service-center/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../providers/AuthProvider';
import { useInvalidateOrg } from '../../hooks/queries';
import { Button, ErrorNotice, Loading } from '../ui';
import { KeySelect } from '../KeySelect';
import { FileRow } from '../files/FileRow';

const blankKey = (): LabeledKeyInput => ({ id: crypto.randomUUID(), expected_revision: null, label: '', song_key: 'C', capo: null, vocal_label: null, file_ids: [] });
const toggle = (ids: string[], id: string) => ids.includes(id) ? ids.filter((v) => v !== id) : [...ids, id];

export const ArrangementCurationPanel = (props: { arrangement: ArrangementRow; canManage: boolean; onDuplicated: (id: string) => void }) => {
  const { organizationId, user } = useAuth();
  return <CurationWorkspace key={`${organizationId}:${user?.profile.id}:${props.arrangement.id}`} {...props} />;
};
const CurationWorkspace = ({ arrangement, canManage, onDuplicated }: { arrangement: ArrangementRow; canManage: boolean; onDuplicated: (id: string) => void }) => {
  const { organizationId, user } = useAuth();
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const invalidate = useInvalidateOrg();
  const materials = useQuery({ queryKey: ['arrangement-materials', organizationId, user?.profile.id, arrangement.id], queryFn: () => api.getArrangementMaterials(arrangement.id) });
  const [draft, setDraft] = useState<LabeledKeyInput>(blankKey);
  const [name, setName] = useState(`${arrangement.name} copy`);
  const [metadata, setMetadata] = useState(true);
  const [sections, setSections] = useState(true);
  const [chart, setChart] = useState(true);
  const [keyIds, setKeyIds] = useState<string[]>([]);
  const [fileIds, setFileIds] = useState<string[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [preview, setPreview] = useState<DuplicateArrangementPreview | null>(null);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [notice, setNotice] = useState('');
  const save = useMutation({
    mutationFn: () => api.saveArrangementKey(arrangement.id, labeledKeyInputSchema.parse(draft)),
    onSuccess: async (key) => { if (!active.current) return; setDraft({ ...key, expected_revision: key.revision }); setNotice('Labeled key saved.'); await materials.refetch(); },
    onError: () => { if (active.current) void materials.refetch(); },
  });
  const review = useMutation({ mutationFn: () => api.previewArrangementDuplicate(arrangement.id, duplicateArrangementSchema.parse({ name, expected_revision: arrangement.revision, metadata, sections, chart, key_ids: keyIds, file_ids: fileIds })),
    onSuccess: (result) => { if (active.current) setPreview(result); } });
  const duplicate = useMutation({
    mutationFn: () => api.duplicateArrangement(arrangement.id, { ...preview!.selection, fingerprint: preview!.fingerprint, idempotency_key: requestKey }),
    onSuccess: async (result) => { if (!active.current) return; await invalidate(); if (active.current) onDuplicated(result.arrangement_id); },
  });
  const busy = save.isPending || review.isPending || duplicate.isPending;
  const files = materials.data?.files ?? [];
  const keys = materials.data?.keys ?? [];
  const selectedFiles = files.filter((f) => !f.key_ids.length || f.key_ids.includes(selectedKey));
  return <section className="card space-y-4 p-5" aria-label="Arrangement keys and reuse">
    <h2 className="font-semibold">Labeled keys and files</h2>
    <p className="text-sm text-slate-500">Keys are sounding keys. Capo and vocal labels describe a version; chart transposition and plan selection use the sounding key. Each arrangement has one label per key.</p>
    {materials.isLoading && <Loading />}
    <ErrorNotice error={materials.error ?? save.error ?? review.error ?? duplicate.error} />
    <label className="label" htmlFor="library-key-files">Files for key</label>
    <select id="library-key-files" className="input" value={selectedKey} onChange={(e) => setSelectedKey(e.target.value)}>
      <option value="">General files</option>
      {keys.map((k) => <option key={k.id} value={k.id}>{k.label} · {k.song_key}{k.capo ? ` · capo ${k.capo}` : ''}{k.vocal_label ? ` · ${k.vocal_label}` : ''}</option>)}
    </select>
    {selectedFiles.length ? <ul className="divide-y divide-slate-200 dark:divide-slate-700">{selectedFiles.map((f) => <ScopedFileRow key={f.id} file={f} onChanged={() => { void materials.refetch(); }} />)}</ul> : <p className="text-sm">No files selected for this key.</p>}
    {canManage && <>
      <details>
        <summary className="cursor-pointer font-medium">Add or edit a labeled key</summary>
        <fieldset className="mt-4 space-y-3" disabled={busy}>
          <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => { setDraft(blankKey()); save.reset(); setNotice(''); }}>New key</Button>{keys.map((k) => <Button key={k.id} variant="ghost" onClick={() => { setDraft({ ...k, expected_revision: k.revision }); save.reset(); setNotice(''); }}>Edit {k.label}</Button>)}</div>
          <label className="label">Label<input className="input" value={draft.label} maxLength={80} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></label>
          <div><label className="label" htmlFor="labeled-key-pitch">Sounding key</label><KeySelect id="labeled-key-pitch" value={draft.song_key} onChange={(v) => v && setDraft({ ...draft, song_key: v })} disabled={draft.expected_revision !== null} /></div>
          <p className="text-xs text-slate-500">Saved pitches stay stable for historical plan selection. Add a key for another pitch.</p>
          <label className="label">Capo fret<input className="input" type="number" min={0} max={11} value={draft.capo ?? ''} onChange={(e) => setDraft({ ...draft, capo: e.target.value === '' ? null : Number(e.target.value) })} /></label>
          <label className="label">Vocal label<input className="input" maxLength={80} value={draft.vocal_label ?? ''} onChange={(e) => setDraft({ ...draft, vocal_label: e.target.value || null })} /></label>
          <fieldset><legend className="label">Files for this key</legend>{files.map((f) => <label className="flex items-center gap-2 py-2" key={f.id}><input type="checkbox" checked={draft.file_ids.includes(f.id)} onChange={() => setDraft({ ...draft, file_ids: toggle(draft.file_ids, f.id) })} />{f.title}</label>)}</fieldset>
          <p className="text-xs text-slate-500">Assigning an owned file to a key scopes its automatic plan selection to that pitch. Clearing every key association returns owned files to general use. File audience and playback rights still apply.</p>
          <Button onClick={() => save.mutate()}>Save labeled key</Button>
          {save.isError && <Button variant="secondary" onClick={() => materials.refetch()}>Reload keys before retry</Button>}
        </fieldset>
      </details>
      <details>
        <summary className="cursor-pointer font-medium">Duplicate arrangement</summary>
        <fieldset className="mt-4 space-y-3" disabled={busy || !!preview}>
          <label className="label">New arrangement name<input className="input" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={metadata} onChange={(e) => setMetadata(e.target.checked)} />Key, capo, tempo, meter and length</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={sections} onChange={(e) => setSections(e.target.checked)} />Sequence / sections</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={chart} onChange={(e) => setChart(e.target.checked)} />Chart and print settings (retains its source sounding key)</label>
          <fieldset><legend className="label">Labeled keys to duplicate</legend>{keys.map((k) => <label className="flex items-center gap-2 py-2" key={k.id}><input type="checkbox" checked={keyIds.includes(k.id)} onChange={() => setKeyIds(toggle(keyIds, k.id))} />{k.label} · {k.song_key}</label>)}</fieldset>
          <fieldset><legend className="label">Files to reuse</legend>{files.map((f) => <label className="flex items-center gap-2 py-2" key={f.id}><input type="checkbox" checked={fileIds.includes(f.id)} onChange={() => setFileIds(toggle(fileIds, f.id))} />{f.title}</label>)}</fieldset>
          <Button onClick={() => review.mutate()}>Preview duplicate</Button>
        </fieldset>
        {preview && <div className="mt-4 space-y-3" aria-live="polite">
          <p>Create “{preview.selection.name}” with a new identity. Metadata {preview.selection.metadata ? 'included' : 'omitted'}; sections {preview.selection.sections ? 'included' : 'omitted'}; chart {preview.selection.chart ? 'included with its source sounding key' : 'omitted'}. Keep the current default.</p>
          <p>{preview.keys.length} new key records: {preview.keys.map((k) => `${k.label} (${k.song_key})`).join(', ') || 'none'}. {preview.files.length} file references: {preview.files.map((f) => f.title).join(', ') || 'none'}. Reused files retain their original owner, audience, versions and playback rights.</p>
          <Button disabled={busy} onClick={() => duplicate.mutate()}>Create reviewed duplicate</Button>{' '}
          <Button variant="secondary" disabled={busy} onClick={() => { setPreview(null); setRequestKey(crypto.randomUUID()); duplicate.reset(); review.reset(); }}>Change selection / refresh preview</Button>
          {duplicate.isError && <p className="text-sm">If the outcome is unknown, retry this reviewed duplicate with the same request. A stale review needs a fresh preview.</p>}
        </div>}
      </details>
    </>}
    {notice && <p role="status">{notice}</p>}
  </section>;
};

/** Reuse the complete F13 document/link/upload reader and version controls. */
const ScopedFileRow = ({ file, onChanged }: { file: { id: string; title: string; reused: boolean }; onChanged: () => void }) => {
  const { organizationId, user } = useAuth();
  const row = useQuery({ queryKey: ['arrangement-file', organizationId, user?.profile.id, file.id], queryFn: () => api.file(file.id) });
  if (row.isLoading) return <li className="py-3">Loading {file.title}…</li>;
  if (!row.data) return <li><ErrorNotice error={row.error} /></li>;
  return <FileRow file={row.data} badges={file.reused ? 'Reused file · edits affect its original' : undefined} onChanged={() => { void row.refetch(); onChanged(); }} />;
};
