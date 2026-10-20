import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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

/** Props of the labeled-keys and duplicate-arrangement panel. */
export interface ArrangementCurationPanelProps {
  arrangement: ArrangementRow;
  canManage: boolean;
  onDuplicated: (id: string) => void;
}

/** A file the arrangement owns or reuses, as listed in its materials. */
interface ScopedFile {
  id: string;
  title: string;
  reused: boolean;
}

/** Props of one file row inside the curation panel. */
interface ScopedFileRowProps {
  file: ScopedFile;
  onChanged: () => void;
}

export const ArrangementCurationPanel = (props: ArrangementCurationPanelProps) => {
  const { organizationId, user } = useAuth();
  return <CurationWorkspace key={`${organizationId}:${user?.profile.id}:${props.arrangement.id}`} {...props} />;
};
const CurationWorkspace = ({ arrangement, canManage, onDuplicated }: ArrangementCurationPanelProps) => {
  const { t } = useTranslation(['songs', 'common']);
  const { organizationId, user } = useAuth();
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const invalidate = useInvalidateOrg();
  const materials = useQuery({ queryKey: ['arrangement-materials', organizationId, user?.profile.id, arrangement.id], queryFn: () => api.getArrangementMaterials(arrangement.id) });
  const [draft, setDraft] = useState<LabeledKeyInput>(blankKey);
  const [name, setName] = useState(() => t('curation.copyName', { name: arrangement.name }));
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
    onSuccess: async (key) => { if (!active.current) return; setDraft({ ...key, expected_revision: key.revision }); setNotice(t('curation.keySaved')); await materials.refetch(); },
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
  return <section className="card space-y-4 p-5" aria-label={t('curation.sectionLabel')}>
    <h2 className="font-semibold">{t('curation.title')}</h2>
    <p className="text-sm text-slate-500">{t('curation.intro')}</p>
    {materials.isLoading && <Loading />}
    <ErrorNotice error={materials.error ?? save.error ?? review.error ?? duplicate.error} />
    <label className="label" htmlFor="library-key-files">{t('curation.filesForKey')}</label>
    <select id="library-key-files" className="input" value={selectedKey} onChange={(e) => setSelectedKey(e.target.value)}>
      <option value="">{t('curation.generalFiles')}</option>
      {keys.map((k) => <option key={k.id} value={k.id}>{[k.label, k.song_key, k.capo ? t('curation.capoValue', { capo: k.capo }) : null, k.vocal_label].filter(Boolean).join(' · ')}</option>)}
    </select>
    {selectedFiles.length ? <ul className="divide-y divide-slate-200 dark:divide-slate-700">{selectedFiles.map((f) => <ScopedFileRow key={f.id} file={f} onChanged={() => { void materials.refetch(); }} />)}</ul> : <p className="text-sm">{t('curation.noFiles')}</p>}
    {canManage && <>
      <details>
        <summary className="cursor-pointer font-medium">{t('curation.editKeySummary')}</summary>
        <fieldset className="mt-4 space-y-3" disabled={busy}>
          <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => { setDraft(blankKey()); save.reset(); setNotice(''); }}>{t('curation.newKey')}</Button>{keys.map((k) => <Button key={k.id} variant="ghost" onClick={() => { setDraft({ ...k, expected_revision: k.revision }); save.reset(); setNotice(''); }}>{t('curation.editKey', { label: k.label })}</Button>)}</div>
          <label className="label">{t('curation.label')}<input className="input" value={draft.label} maxLength={80} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></label>
          <div><label className="label" htmlFor="labeled-key-pitch">{t('curation.soundingKey')}</label><KeySelect id="labeled-key-pitch" value={draft.song_key} onChange={(v) => v && setDraft({ ...draft, song_key: v })} disabled={draft.expected_revision !== null} /></div>
          <p className="text-xs text-slate-500">{t('curation.pitchHelp')}</p>
          <label className="label">{t('curation.capoFret')}<input className="input" type="number" min={0} max={11} value={draft.capo ?? ''} onChange={(e) => setDraft({ ...draft, capo: e.target.value === '' ? null : Number(e.target.value) })} /></label>
          <label className="label">{t('curation.vocalLabel')}<input className="input" maxLength={80} value={draft.vocal_label ?? ''} onChange={(e) => setDraft({ ...draft, vocal_label: e.target.value || null })} /></label>
          <fieldset><legend className="label">{t('curation.filesForThisKey')}</legend>{files.map((f) => <label className="flex items-center gap-2 py-2" key={f.id}><input type="checkbox" checked={draft.file_ids.includes(f.id)} onChange={() => setDraft({ ...draft, file_ids: toggle(draft.file_ids, f.id) })} />{f.title}</label>)}</fieldset>
          <p className="text-xs text-slate-500">{t('curation.fileScopeHelp')}</p>
          <Button onClick={() => save.mutate()}>{t('curation.saveKey')}</Button>
          {save.isError && <Button variant="secondary" onClick={() => materials.refetch()}>{t('curation.reloadKeys')}</Button>}
        </fieldset>
      </details>
      <details>
        <summary className="cursor-pointer font-medium">{t('curation.duplicateSummary')}</summary>
        <fieldset className="mt-4 space-y-3" disabled={busy || !!preview}>
          <label className="label">{t('curation.newName')}<input className="input" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={metadata} onChange={(e) => setMetadata(e.target.checked)} />{t('curation.includeMetadata')}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={sections} onChange={(e) => setSections(e.target.checked)} />{t('curation.includeSections')}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={chart} onChange={(e) => setChart(e.target.checked)} />{t('curation.includeChart')}</label>
          <fieldset><legend className="label">{t('curation.keysToDuplicate')}</legend>{keys.map((k) => <label className="flex items-center gap-2 py-2" key={k.id}><input type="checkbox" checked={keyIds.includes(k.id)} onChange={() => setKeyIds(toggle(keyIds, k.id))} />{t('curation.keyOption', { label: k.label, key: k.song_key })}</label>)}</fieldset>
          <fieldset><legend className="label">{t('curation.filesToReuse')}</legend>{files.map((f) => <label className="flex items-center gap-2 py-2" key={f.id}><input type="checkbox" checked={fileIds.includes(f.id)} onChange={() => setFileIds(toggle(fileIds, f.id))} />{f.title}</label>)}</fieldset>
          <Button onClick={() => review.mutate()}>{t('curation.previewDuplicate')}</Button>
        </fieldset>
        {preview && <div className="mt-4 space-y-3" aria-live="polite">
          <p>{t('curation.previewCreate', { name: preview.selection.name })}{' '}
            {t(preview.selection.metadata ? 'curation.previewMetadataIncluded' : 'curation.previewMetadataOmitted')}{' '}
            {t(preview.selection.sections ? 'curation.previewSectionsIncluded' : 'curation.previewSectionsOmitted')}{' '}
            {t(preview.selection.chart ? 'curation.previewChartIncluded' : 'curation.previewChartOmitted')}{' '}
            {t('curation.previewKeepDefault')}</p>
          <p>{t('curation.previewKeys', { count: preview.keys.length, keys: preview.keys.map((k) => t('curation.keyWithPitch', { label: k.label, key: k.song_key })).join(', ') || t('common:states.none') })}{' '}
            {t('curation.previewFiles', { count: preview.files.length, files: preview.files.map((f) => f.title).join(', ') || t('common:states.none') })}{' '}
            {t('curation.previewReuseNote')}</p>
          <Button disabled={busy} onClick={() => duplicate.mutate()}>{t('curation.createDuplicate')}</Button>{' '}
          <Button variant="secondary" disabled={busy} onClick={() => { setPreview(null); setRequestKey(crypto.randomUUID()); duplicate.reset(); review.reset(); }}>{t('curation.changeSelection')}</Button>
          {duplicate.isError && <p className="text-sm">{t('curation.retryHelp')}</p>}
        </div>}
      </details>
    </>}
    {notice && <p role="status">{notice}</p>}
  </section>;
};

/** Reuse the complete F13 document/link/upload reader and version controls. */
const ScopedFileRow = ({ file, onChanged }: ScopedFileRowProps) => {
  const { t } = useTranslation('songs');
  const { organizationId, user } = useAuth();
  const row = useQuery({ queryKey: ['arrangement-file', organizationId, user?.profile.id, file.id], queryFn: () => api.file(file.id) });
  if (row.isLoading) return <li className="py-3">{t('curation.loadingFile', { title: file.title })}</li>;
  if (!row.data) return <li><ErrorNotice error={row.error} /></li>;
  return <FileRow file={row.data} badges={file.reused ? t('curation.reusedBadge') : undefined} onChanged={() => { void row.refetch(); onChanged(); }} />;
};
