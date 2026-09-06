import { useEffect, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { STORAGE_BUCKETS, type ChordSheetImportRow, type ImportQuota } from '@service-center/shared';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';
import { useImportQuota, useImports, useInvalidateOrg } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Badge, Button, EmptyState, ErrorNotice, Loading, PageHeader } from '../components/ui';
import { ChordChart } from '../components/ChordChart';

const statusTone: Record<ChordSheetImportRow['status'], string> = {
  pending: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  processing: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  succeeded: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  failed: 'bg-rose-50 text-rose-700 ring-rose-600/20',
};

/** Reads as "3 of 10 left today", with the reset time once it runs out. */
const QuotaNotice = ({ quota }: { quota: ImportQuota }) => {
  const exhausted = quota.remaining === 0;
  return (
    <p className={`text-xs ${exhausted ? 'text-amber-700' : 'text-slate-500'}`}>
      {exhausted
        ? `Daily limit reached (${quota.limit}). More imports at ${new Date(
            quota.resets_at,
          ).toLocaleString()}.`
        : `${quota.remaining} of ${quota.limit} imports left today.`}
    </p>
  );
};

export const ImportsPage = () => {
  const { isAdmin, organizationId } = useAuth();
  const invalidate = useInvalidateOrg();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<unknown>(null);
  const [uploading, setUploading] = useState(false);

  // Poll while anything is still being worked on.
  const imports = useImports({ refetchInterval: 3000 });
  const quota = useImportQuota(isAdmin);
  const outOfQuota = quota.data?.remaining === 0;
  const anyRunning = (imports.data ?? []).some(
    (record) => record.status === 'pending' || record.status === 'processing',
  );

  useEffect(() => {
    if (!anyRunning) void invalidate();
    // Only re-run when the "is anything running" answer flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyRunning]);

  const selected = (imports.data ?? []).find((record) => record.id === selectedId) ?? null;

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !organizationId) return;

    setUploading(true);
    setUploadError(null);
    try {
      const extension = file.name.split('.').pop() ?? 'jpg';
      const path = `${organizationId}/${crypto.randomUUID()}.${extension}`;

      // Upload straight to Storage so the image never passes through the API.
      const { error } = await supabase.storage
        .from(STORAGE_BUCKETS.chordSheets)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;

      const created = await api.createImport({ storage_path: path, original_filename: file.name });
      setSelectedId(created.id);
      await invalidate();
    } catch (err) {
      setUploadError(err);
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  if (!isAdmin) {
    return (
      <div>
        <PageHeader title="Import a chord sheet" />
        <EmptyState
          title="Admins only"
          description="Importing a chord sheet runs it through an AI transcription service, so it is limited to organization owners and admins."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Import a chord sheet"
        subtitle="Phase 2 — photograph or scan a chart and turn it into an editable song."
        actions={
          <div className="flex flex-col items-end gap-1">
            <label
              className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium text-white ${
                outOfQuota
                  ? 'cursor-not-allowed bg-slate-300'
                  : 'cursor-pointer bg-brand-600 hover:bg-brand-700'
              }`}
            >
              {uploading ? 'Uploading…' : 'Upload image'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/heic,application/pdf"
                className="sr-only"
                onChange={upload}
                disabled={uploading || outOfQuota}
              />
            </label>
            {quota.data && <QuotaNotice quota={quota.data} />}
          </div>
        }
      />

      <ErrorNotice error={uploadError ?? imports.error} />

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Imports</h2>
          {imports.isLoading ? (
            <Loading />
          ) : imports.data?.length ? (
            <ul className="card divide-y divide-slate-100">
              {imports.data.map((record) => (
                <li key={record.id}>
                  <button
                    onClick={() => setSelectedId(record.id)}
                    className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 ${
                      selectedId === record.id ? 'bg-brand-50/60' : ''
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {record.detected_title ?? record.original_filename ?? 'Untitled'}
                      </p>
                      <p className="text-xs text-slate-500">
                        {new Date(record.created_at).toLocaleString()}
                        {record.detected_key ? ` · key ${record.detected_key}` : ''}
                      </p>
                    </div>
                    <Badge tone={statusTone[record.status]}>{record.status}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No imports yet"
              description="Upload a photo of a chord sheet and it will be transcribed into ChordPro."
            />
          )}
        </section>

        <section className="lg:col-span-3">
          {selected ? (
            <ImportDetail record={selected} canRerun={!outOfQuota} onDone={() => void invalidate()} />
          ) : (
            <div className="card p-6 text-sm text-slate-500">
              <h2 className="mb-2 font-semibold text-slate-800">How it works</h2>
              <ol className="list-decimal space-y-1.5 pl-5">
                <li>Upload a photo or scan of the chart.</li>
                <li>The image is transcribed, keeping chords above the words they sit on.</li>
                <li>The transcription is converted into ChordPro, so it can be transposed.</li>
                <li>Review and correct it, then save it as a song or a new arrangement.</li>
              </ol>
              <p className="mt-4 text-xs text-slate-400">
                With <code className="rounded bg-slate-100 px-1">OCR_PROVIDER=stub</code> the server returns
                a fixture, so you can exercise the whole flow without credentials.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

interface ImportDetailProps {
  record: ChordSheetImportRow;
  /** Re-running the transcription spends another import. */
  canRerun: boolean;
  onDone: () => void;
}

const ImportDetail = ({ record, canRerun, onDone }: ImportDetailProps) => {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [chordpro, setChordpro] = useState('');
  const [preview, setPreview] = useState(true);

  useEffect(() => {
    setTitle(record.detected_title ?? '');
    setChordpro(record.parsed_chordpro ?? '');
  }, [record.id, record.detected_title, record.parsed_chordpro]);

  const retry = useMutation({ mutationFn: () => api.retryImport(record.id), onSuccess: onDone });
  const accept = useMutation({
    mutationFn: () =>
      api.acceptImport(record.id, {
        title,
        author: author || null,
        song_key: record.detected_key,
        chordpro,
        arrangement_name: 'Imported Arrangement',
      }),
    onSuccess: onDone,
  });

  if (record.status === 'pending' || record.status === 'processing') {
    return (
      <div className="card">
        <Loading label="Transcribing the chart…" />
      </div>
    );
  }

  if (record.status === 'failed') {
    return (
      <div className="card space-y-3 p-6">
        <h2 className="font-semibold text-rose-700">Import failed</h2>
        <p className="text-sm text-slate-600">{record.error_message ?? 'Unknown error'}</p>
        <Button loading={retry.isPending} disabled={!canRerun} onClick={() => retry.mutate()}>
          Try again
        </Button>
        {!canRerun && (
          <p className="text-xs text-amber-700">You have used today’s imports.</p>
        )}
        <ErrorNotice error={retry.error} />
      </div>
    );
  }

  if (accept.isSuccess) {
    return (
      <div className="card space-y-3 p-6">
        <h2 className="font-semibold text-emerald-700">Saved to your library</h2>
        <Link to={`/songs/${accept.data.song.id}`}>
          <Button>Open {accept.data.song.title}</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="card space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-semibold">Review the transcription</h2>
        {record.confidence !== null && (
          <Badge tone={record.confidence >= 0.8 ? statusTone.succeeded : statusTone.pending}>
            {Math.round(record.confidence * 100)}% confidence
          </Badge>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={() => setPreview((value) => !value)}>
            {preview ? 'Edit source' : 'Preview'}
          </Button>
          <Button
            variant="secondary"
            loading={retry.isPending}
            disabled={!canRerun}
            onClick={() => retry.mutate()}
          >
            Re-run
          </Button>
        </div>
      </div>

      {record.confidence !== null && record.confidence < 0.8 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Low confidence — check the chords against the original before saving.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="import-title">Song title</label>
          <input id="import-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="import-author">Author</label>
          <input id="import-author" className="input" value={author} onChange={(e) => setAuthor(e.target.value)} />
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 p-4">
        {preview ? (
          <ChordChart chordpro={chordpro} />
        ) : (
          <textarea
            className="input font-mono"
            rows={18}
            value={chordpro}
            onChange={(e) => setChordpro(e.target.value)}
            aria-label="ChordPro source"
          />
        )}
      </div>

      <ErrorNotice error={accept.error} />

      <div className="flex justify-end">
        <Button loading={accept.isPending} disabled={!title || !chordpro} onClick={() => accept.mutate()}>
          Save as song
        </Button>
      </div>
    </div>
  );
};
