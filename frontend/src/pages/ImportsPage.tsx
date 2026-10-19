import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { parseImportCsv, importFieldNames, importPreviewRequestSchema, IMPORT_MAX_BYTES,
  type ImportKind, type ImportPreview, type ImportPreviewRequest, type ImportJobDetail } from '@service-center/shared';
import { api } from '../lib/api';
import { useAuth } from '../providers/AuthProvider';
import { useInvalidateOrg } from '../hooks/queries';
import { Button, EmptyState, ErrorNotice, Loading, PageHeader } from '../components/ui';

type Resolutions = ImportPreviewRequest['resolutions'];
const display = (value: unknown) => value === null ? 'None' : Array.isArray(value) ? value.join('; ') : String(value);
const fieldLabel = (field: string) => field === 'id' ? 'Existing Person/song ID' : field.replaceAll('_', ' ');

export const ImportsPage = () => {
  const { organizationId, user } = useAuth();
  return <ImportWorkspace key={`${organizationId}:${user?.profile.id}`} />;
};
const ImportWorkspace = () => {
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
      if (selected.size > IMPORT_MAX_BYTES) throw new Error('CSV exceeds 256 KiB');
      const content = new TextDecoder('utf-8', { fatal: true }).decode(await selected.arrayBuffer());
      const source = { filename: selected.name, content_type: selected.type || 'text/csv', content };
      const validated = importPreviewRequestSchema.parse({ ...source, kind, mapping: {}, resolutions: [] });
      const parsed = parseImportCsv(content);
      setFile(validated); setHeaders(parsed.headers);
    } catch (error) { setFileError(error instanceof Error ? error : new Error('Could not read CSV')); }
    finally { setReadingFile(false); }
  };
  if (!canAnywhere('people.manage') && !canAnywhere('songs.manage')) return <EmptyState title="Import permission required" />;
  return <div>
    <PageHeader title="Structured imports" subtitle="Review CSV mappings and every row before saving. Up to 100 records and 256 KiB per atomic import." />
    <p className="mb-4 text-sm text-slate-500">People imports maintain roster records. They do not create logins or send invitations. Songbook PDFs and Word files remain documents.</p>
    {!job && <section className="card space-y-4 p-4">
      <label className="block">Import type<select className="input" value={kind} disabled={busy} onChange={(event) => { setKind(event.target.value as ImportKind); setMapping({}); setResolutions([]); change(); }}>
        {canAnywhere('songs.manage') && <option value="songs">Song metadata</option>}
        {canAnywhere('people.manage') && <option value="people">People</option>}
      </select></label>
      <label className="block">UTF-8 CSV file<input type="file" accept=".csv,text/csv" disabled={!permitted || busy} onChange={(event) => { void requestFile(event.target.files?.[0]); }} /></label>
      {file && <><p>{file.filename} · {headers.length} columns. Blank mapped values clear nullable fields; unmapped fields stay unchanged on updates. Separate tags with semicolons.</p>
        <div className="grid gap-3 sm:grid-cols-2">{importFieldNames[kind].map((field) => <label key={field}>{fieldLabel(field)}
          <select className="input" value={mapping[field] ?? ''} disabled={busy} onChange={(event) => {
            setMapping((current) => { const next = { ...current }; if (event.target.value) next[field] = event.target.value; else delete next[field]; return next; }); change();
          }}><option value="">Do not import</option>{headers.map((header) => <option key={header} value={header}>{header}</option>)}</select>
        </label>)}</div>
        <Button loading={review.isPending} disabled={busy || !permitted} onClick={() => review.mutate()}>{preview ? 'Refresh preview' : 'Preview rows'}</Button>
      </>}
    </section>}
    {readingFile && <p>Reading CSV…</p>}
    <ErrorNotice error={fileError ?? review.error ?? save.error ?? resume.error ?? jobs.error} />
    {preview && !job && <section className="card my-4 space-y-4 p-4" aria-label="Import preview">
      <h2 className="font-semibold">Read-only preview</h2><p>Preview itself writes no records or jobs. Resolve all errors and possible duplicates before saving; retries reuse the same saved review.</p>
      {preview.rows.map((row) => <div className="border-t border-slate-200 py-3" key={row.row}>
        <h3 className="font-medium">Record {row.row - 1}: {row.action}</h3>
        {row.errors.map((error) => <p key={error} className="text-sm text-red-600">{error}</p>)}
        <ul className="text-sm">{Object.entries(row.data).map(([field, value]) => <li key={field}>{fieldLabel(field)}: {row.before ? `${display(row.before[field])} → ` : ''}{display(value)}</li>)}</ul>
        <label>Resolution<select className="input" disabled={busy} value={resolutions.find((r) => r.row === row.row)?.action === 'update'
          ? `update:${resolutions.find((r) => r.row === row.row)?.target_id}` : resolutions.find((r) => r.row === row.row)?.action ?? ''}
          onChange={(event) => {
            const value = event.target.value;
            setResolutions((current) => [...current.filter((r) => r.row !== row.row), ...(value ? [{ row: row.row,
              action: value.startsWith('update:') ? 'update' as const : value as 'create' | 'skip',
              ...(value.startsWith('update:') ? { target_id: value.slice(7) } : {}) }] : [])]);
            setReviewedSource(null);
          }}>
          <option value="">Use mapped ID / review matches</option><option value="create">Create a new record deliberately</option><option value="skip">Skip this record</option>
          {row.candidates.map((candidate) => <option key={candidate.id} value={`update:${candidate.id}`}>Update {candidate.label}{candidate.archived ? ' (archived)' : ''} · {candidate.id}</option>)}
        </select></label>
        {row.candidate_count > 10 && <p>Showing 10 of {row.candidate_count} matches. Use the exact stable ID in the CSV to choose another target.</p>}
      </div>)}
      {!reviewedSource && <p>Resolution changed. Refresh the preview to review the new result.</p>}
      <Button loading={save.isPending} disabled={!preview.can_commit || !reviewedSource || busy || !permitted} onClick={() => save.mutate()}>Save reviewed import</Button>
    </section>}
    {job && <section className="card my-4 space-y-3 p-4">
      <h2 className="font-semibold">{job.job.filename} · {job.job.status}</h2>
      <p>Job {job.job.id}. {job.job.status === 'reviewed' ? 'Review saved. Commit is pending or unconfirmed; check status or retry the entire batch.' : 'All reviewed outcomes are saved. Retrying this job cannot duplicate its records.'}</p>
      <p className="text-sm">Mapped columns: {Object.entries(job.source.mapping).map(([field, header]) => `${header} → ${fieldLabel(field)}`).join('; ')}</p>
      <ul className="space-y-2">{job.rows.map((row) => <li key={row.row_number}>
        Record {row.row_number - 1}: {row.action} {row.result_id ?? row.target_id ?? ''}
        <ul className="text-sm">{Object.entries(row.data).map(([field, value]) => <li key={field}>{fieldLabel(field)}: {row.before_data ? `${display(row.before_data[field])} → ` : ''}{display(value)}</li>)}</ul>
      </li>)}</ul>
      <Button disabled={busy} onClick={() => resume.mutate(job.job.id)}>Check saved status</Button>
      {job.job.status === 'reviewed' && <Button disabled={busy || !canAnywhere(job.job.kind === 'people' ? 'people.manage' : 'songs.manage')} onClick={() => save.mutate()}>Retry reviewed commit</Button>}
      <Button disabled={busy} onClick={reset}>Start a new preview</Button>
      <p className="text-sm">If a target changed, start a fresh preview from this saved source. The old review stays unchanged in history.</p>
    </section>}
    <section className="mt-6 space-y-3"><h2 className="font-semibold">Your recent imports (up to 50)</h2>
      {jobs.isLoading && <Loading />}
      {jobs.data?.length === 0 && <p>No saved imports yet.</p>}
      {!locked && params.get('job') && <Button onClick={() => resume.mutate(params.get('job')!)}>Resume job from this URL</Button>}
      {jobs.data?.map((item) => <div className="card flex flex-wrap items-center gap-3 p-3" key={item.id}>
        <span>{item.filename} · {item.kind} · {item.status}</span><Button disabled={busy} onClick={() => resume.mutate(item.id)}>Open review</Button>
      </div>)}
    </section>
  </div>;
};
