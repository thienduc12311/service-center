import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { LocalizedError, parseImportCsv, importFieldNames, importPreviewRequestSchema, IMPORT_MAX_BYTES,
  type ImportKind, type ImportPreview, type ImportPreviewRequest, type ImportJobDetail } from '@service-center/shared';
import { api } from '../lib/api';
import { useAuth } from '../providers/AuthProvider';
import { useInvalidateOrg } from '../hooks/queries';
import { Button, EmptyState, ErrorNotice, Loading, PageHeader } from '../components/ui';

type Resolutions = ImportPreviewRequest['resolutions'];
/** Shows an imported value; `none` is the localized word for an empty value. */
const display = (value: unknown, none: string) => value === null ? none : Array.isArray(value) ? value.join('; ') : String(value);
/** Import field names are the machine CSV contract and stay as written; only the stable ID gets a caption. */
const fieldLabel = (field: string, idLabel: string) => field === 'id' ? idLabel : field.replaceAll('_', ' ');

export const ImportsPage = () => {
  const { organizationId, user } = useAuth();
  return <ImportWorkspace key={`${organizationId}:${user?.profile.id}`} />;
};
const ImportWorkspace = () => {
  const { t } = useTranslation(['songs', 'common']);
  const none = t('common:states.none');
  const idLabel = t('imports.existingId');
  const { organizationId, user, canAnywhere } = useAuth();
  const [params, setParams] = useSearchParams();
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [kind, setKind] = useState<ImportKind>(() => ((params.get('kind') === 'people' && canAnywhere('people.manage')) || !canAnywhere('songs.manage')) ? 'people' : 'songs');
  const [file, setFile] = useState<Pick<ImportPreviewRequest, 'filename' | 'content_type' | 'content'> | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [resolutions, setResolutions] = useState<Resolutions>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [reviewedSource, setReviewedSource] = useState<ImportPreviewRequest | null>(null);
  const [job, setJob] = useState<ImportJobDetail | null>(null);
  const [readingFile, setReadingFile] = useState(false);
  const [fileError, setFileError] = useState<Error | null>(null);
  const [saveKey, setSaveKey] = useState(() => crypto.randomUUID());
  const invalidate = useInvalidateOrg();
  const jobs = useQuery({ queryKey: ['imports', organizationId, user?.profile.id], queryFn: () => api.listImports() });
  const permitted = canAnywhere(kind === 'people' ? 'people.manage' : 'songs.manage');
  const review = useMutation({
    mutationFn: async () => {
      const source = importPreviewRequestSchema.parse({ ...file, kind, mapping, resolutions });
      const result = await api.previewImport(source);
      return { source, result };
    },
    onSuccess: ({ source, result }) => { if (!active.current) return; setPreview(result); setReviewedSource(source); setSaveKey(crypto.randomUUID()); },
  });
  const save = useMutation({
    mutationFn: async () => {
      let saved = job;
      if (!saved) {
        saved = await api.saveImport({ source: reviewedSource!, preview_hash: preview!.preview_hash, idempotency_key: saveKey });
        if (!active.current) return saved;
        setJob(saved); setParams({ job: saved.job.id });
      }
      return api.commitImport(saved.job.id, { expected_revision: saved.job.revision });
    },
    onSuccess: async (result) => { if (!active.current) return; setJob(result); await invalidate(); if (active.current) await jobs.refetch(); },
    onError: () => { if (active.current) void jobs.refetch(); },
  });
  const resume = useMutation({
    mutationFn: (id: string) => api.getImport(id),
    onSuccess: (result) => { if (!active.current) return; setJob(result); setParams({ job: result.job.id }); setPreview(null); setReviewedSource(null); save.reset(); },
  });
  const busy = readingFile || review.isPending || save.isPending || resume.isPending;
  const locked = busy || !!job;
  const change = () => { setPreview(null); setReviewedSource(null); review.reset(); };
  const reset = () => {
    if (job) {
      setKind(job.source.kind); setFile(job.source); setMapping(job.source.mapping);
      setHeaders(parseImportCsv(job.source.content).headers);
    }
    setJob(null); setPreview(null); setReviewedSource(null); setResolutions(job?.source.resolutions ?? []); save.reset(); review.reset(); setParams({ kind: job?.source.kind ?? kind }); setSaveKey(crypto.randomUUID()); };
  const requestFile = async (selected: File | undefined) => {
    if (!selected) return;
    setReadingFile(true);
    setFileError(null); setFile(null); setHeaders([]); setMapping({}); setResolutions([]); change();
    try {
      if (selected.size > IMPORT_MAX_BYTES) throw new LocalizedError({ key: 'songs:errors.csvTooLarge' });
      const content = new TextDecoder('utf-8', { fatal: true }).decode(await selected.arrayBuffer());
      const source = { filename: selected.name, content_type: selected.type || 'text/csv', content };
      const validated = importPreviewRequestSchema.parse({ ...source, kind, mapping: {}, resolutions: [] });
      const parsed = parseImportCsv(content);
      setFile(validated); setHeaders(parsed.headers);
    } catch (error) { setFileError(error instanceof Error ? error : new LocalizedError({ key: 'songs:errors.csvUnreadable' })); }
    finally { setReadingFile(false); }
  };
  if (!canAnywhere('people.manage') && !canAnywhere('songs.manage')) return <EmptyState title={t('imports.permissionRequired')} />;
  return <div className="text-sm text-slate-700 dark:text-slate-300">
    <PageHeader title={t('imports.title')} subtitle={t('imports.subtitle')} />
    <p className="mb-4 text-slate-500">{t('imports.intro')}</p>
    {!job && <section className="card space-y-4 p-4">
      <label className="field">{t('imports.importType')}<select className="input" value={kind} disabled={busy} onChange={(event) => { setKind(event.target.value as ImportKind); setMapping({}); setResolutions([]); change(); }}>
        {canAnywhere('songs.manage') && <option value="songs">{t('imports.kind.songs')}</option>}
        {canAnywhere('people.manage') && <option value="people">{t('imports.kind.people')}</option>}
      </select></label>
      <label className="field">{t('imports.csvFile')}<input className="input" type="file" accept=".csv,text/csv" disabled={!permitted || busy} onChange={(event) => { void requestFile(event.target.files?.[0]); }} /></label>
      {file && <><p>{t('imports.fileSummary', { filename: file.filename, count: headers.length })} {t('imports.mappingHelp')}</p>
        <div className="grid gap-3 sm:grid-cols-2">{importFieldNames[kind].map((field) => <label key={field} className="field">{fieldLabel(field, idLabel)}
          <select className="input" value={mapping[field] ?? ''} disabled={busy} onChange={(event) => {
            setMapping((current) => { const next = { ...current }; if (event.target.value) next[field] = event.target.value; else delete next[field]; return next; }); change();
          }}><option value="">{t('imports.doNotImport')}</option>{headers.map((header) => <option key={header} value={header}>{header}</option>)}</select>
        </label>)}</div>
        <Button loading={review.isPending} disabled={busy || !permitted} onClick={() => review.mutate()}>{preview ? t('imports.refreshPreview') : t('imports.previewRows')}</Button>
      </>}
    </section>}
    {readingFile && <p>{t('imports.readingCsv')}</p>}
    <ErrorNotice error={fileError ?? review.error ?? save.error ?? resume.error ?? jobs.error} />
    {preview && !job && <section className="card my-4 space-y-4 p-4" aria-label={t('imports.previewLabel')}>
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">{t('imports.previewTitle')}</h2><p>{t('imports.previewHelp')}</p>
      {preview.rows.map((row) => <div className="border-t border-slate-200 py-3" key={row.row}>
        <h3 className="font-medium">{t('imports.recordAction', { number: row.row - 1, action: t(`imports.action.${row.action}`) })}</h3>
        {row.errors.map((error) => <p key={error} className="text-sm text-red-600">{error}</p>)}
        <ul className="text-sm">{Object.entries(row.data).map(([field, value]) => <li key={field}>{row.before
          ? t('imports.fieldChange', { field: fieldLabel(field, idLabel), before: display(row.before[field], none), after: display(value, none) })
          : t('imports.fieldValue', { field: fieldLabel(field, idLabel), value: display(value, none) })}</li>)}</ul>
        <label className="field">{t('imports.resolution')}<select className="input" disabled={busy} value={resolutions.find((r) => r.row === row.row)?.action === 'update'
          ? `update:${resolutions.find((r) => r.row === row.row)?.target_id}` : resolutions.find((r) => r.row === row.row)?.action ?? ''}
          onChange={(event) => {
            const value = event.target.value;
            setResolutions((current) => [...current.filter((r) => r.row !== row.row), ...(value ? [{ row: row.row,
              action: value.startsWith('update:') ? 'update' as const : value as 'create' | 'skip',
              ...(value.startsWith('update:') ? { target_id: value.slice(7) } : {}) }] : [])]);
            setReviewedSource(null);
          }}>
          <option value="">{t('imports.resolutionDefault')}</option><option value="create">{t('imports.resolutionCreate')}</option><option value="skip">{t('imports.resolutionSkip')}</option>
          {row.candidates.map((candidate) => <option key={candidate.id} value={`update:${candidate.id}`}>{t(candidate.archived ? 'imports.updateCandidateArchived' : 'imports.updateCandidate', { label: candidate.label, id: candidate.id })}</option>)}
        </select></label>
        {row.candidate_count > 10 && <p>{t('imports.candidatesTruncated', { count: row.candidate_count })}</p>}
      </div>)}
      {!reviewedSource && <p>{t('imports.resolutionChanged')}</p>}
      <Button loading={save.isPending} disabled={!preview.can_commit || !reviewedSource || busy || !permitted} onClick={() => save.mutate()}>{t('imports.saveReviewed')}</Button>
    </section>}
    {job && <section className="card my-4 space-y-3 p-4">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">{t('imports.jobHeading', { filename: job.job.filename, status: t(`imports.status.${job.job.status}`) })}</h2>
      <p>{t('imports.jobId', { id: job.job.id })} {job.job.status === 'reviewed' ? t('imports.jobReviewed') : t('imports.jobCommitted')}</p>
      <p className="text-sm">{t('imports.mappedColumns', { mapping: Object.entries(job.source.mapping).map(([field, header]) => t('imports.mappedColumn', { header, field: fieldLabel(field, idLabel) })).join('; ') })}</p>
      <ul className="space-y-2">{job.rows.map((row) => <li key={row.row_number}>
        {t('imports.recordResult', { number: row.row_number - 1, action: t(`imports.action.${row.action}`), id: row.result_id ?? row.target_id ?? '' })}
        <ul className="text-sm">{Object.entries(row.data).map(([field, value]) => <li key={field}>{row.before_data
          ? t('imports.fieldChange', { field: fieldLabel(field, idLabel), before: display(row.before_data[field], none), after: display(value, none) })
          : t('imports.fieldValue', { field: fieldLabel(field, idLabel), value: display(value, none) })}</li>)}</ul>
      </li>)}</ul>
      <Button disabled={busy} onClick={() => resume.mutate(job.job.id)}>{t('imports.checkStatus')}</Button>
      {job.job.status === 'reviewed' && <Button disabled={busy || !canAnywhere(job.job.kind === 'people' ? 'people.manage' : 'songs.manage')} onClick={() => save.mutate()}>{t('imports.retryCommit')}</Button>}
      <Button disabled={busy} onClick={reset}>{t('imports.startNew')}</Button>
      <p className="text-sm">{t('imports.startNewHelp')}</p>
    </section>}
    <section className="mt-6 space-y-3"><h2 className="text-base font-semibold text-slate-900 dark:text-white">{t('imports.recent')}</h2>
      {jobs.isLoading && <Loading />}
      {jobs.data?.length === 0 && <p>{t('imports.noneSaved')}</p>}
      {!locked && params.get('job') && <Button onClick={() => resume.mutate(params.get('job')!)}>{t('imports.resumeFromUrl')}</Button>}
      {jobs.data?.map((item) => <div className="card flex flex-wrap items-center gap-3 p-3" key={item.id}>
        <span>{t('imports.jobSummary', { filename: item.filename, kind: t(`imports.kind.${item.kind}`), status: t(`imports.status.${item.status}`) })}</span><Button disabled={busy} onClick={() => resume.mutate(item.id)}>{t('imports.openReview')}</Button>
      </div>)}
    </section>
  </div>;
};
