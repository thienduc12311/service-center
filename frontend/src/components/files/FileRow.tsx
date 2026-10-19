import { useRef, useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  FILE_AUDIENCE_LABELS,
  FILE_CATEGORY_LABELS,
  fileUploadOutcomeMessage,
  fileVersionLabel,
  formatDateTime,
  formatFileSize,
  type FileSummary,
  type FileVersionSummary,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { Badge, Button, Menu, MenuItem } from '../ui';
import { DocumentModal } from './DocumentModal';
import { FileDetailsModal } from './FileDetailsModal';
import { FileVersionsModal } from './FileVersionsModal';
import { fileErrorMessage, openFileVersion } from './fileActions';
import { useFileUpload } from './useFileUpload';

export interface FileRowProps {
  file: FileSummary;
  /** The version this view uses (a plan's pinned one); defaults to the current version. */
  version?: FileVersionSummary | null;
  planId?: string | null;
  /** Extra labels (where it comes from, pinning). */
  badges?: ReactNode;
  /** Extra menu entries (plan link actions). */
  extraActions?: (close: () => void) => ReactNode;
  onChanged: () => void;
}

const KIND_LABEL: Record<FileSummary['kind'], string> = { upload: 'File', link: 'Link', document: 'Text' };

/** One file: open/download, and for writers replace, details, versions, archive and delete. */
export const FileRow = ({ file, version, planId = null, badges, extraActions, onChanged }: FileRowProps) => {
  const shown = version === undefined ? file.current_version : version;
  const [dialog, setDialog] = useState<'details' | 'versions' | 'document' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replace = useFileUpload(() => onChanged());

  const archive = useMutation({
    mutationFn: () => api.archiveFile(file.id, { archived: !file.archived_at, expected_revision: file.revision }),
    onSettled: onChanged,
    onError: (cause) => setError(fileErrorMessage(cause)),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteFile(file.id, file.revision),
    onSettled: onChanged,
    onError: (cause) => setError(fileErrorMessage(cause)),
  });
  const discard = useMutation({
    mutationFn: (pending: FileVersionSummary) => api.abandonFileUpload(file.id, pending.id),
    onSettled: onChanged,
    onError: (cause) => setError(fileErrorMessage(cause)),
  });
  const checkAgain = useMutation({
    mutationFn: (pending: FileVersionSummary) => api.finalizeFile(file.id, pending.id),
    onSuccess: (result) => setError(fileUploadOutcomeMessage(result.outcome, result.reason)),
    onSettled: onChanged,
    onError: (cause) => setError(fileErrorMessage(cause)),
  });

  const open = (download = false) => {
    setError(null);
    if (file.kind === 'document') {
      setDialog('document');
      return;
    }
    openFileVersion(file, { versionId: shown?.id ?? null, download }).catch((cause: unknown) => setError(fileErrorMessage(cause)));
  };

  const replacing = replace.state.phase === 'preparing' || replace.state.phase === 'uploading' || replace.state.phase === 'finalizing';
  const usable = file.kind === 'link' || Boolean(shown);

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900 dark:text-white">
            <span className="truncate">{file.title}</span>
            <Badge tone="bg-slate-50 text-slate-600 ring-slate-500/20">{KIND_LABEL[file.kind]}</Badge>
            {file.archived_at && <Badge tone="bg-amber-50 text-amber-800 ring-amber-600/20">Archived</Badge>}
            {file.kind === 'upload' && file.playback_rights === 'stream_only' && (
              <Badge tone="bg-violet-50 text-violet-800 ring-violet-600/20">Play only</Badge>
            )}
            {badges}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {FILE_CATEGORY_LABELS[file.category]} · {FILE_AUDIENCE_LABELS[file.audience]}
            {shown && file.kind !== 'link' && (
              <>
                {' '}
                · {fileVersionLabel(shown)}
                {file.kind === 'upload' && <> · {formatFileSize(shown.size_bytes)}</>}
              </>
            )}
            {file.kind === 'link' && file.external_url && <> · {new URL(file.external_url).hostname}</>}
            {!usable && ' · No finished upload yet'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {usable && (
            <Button variant="secondary" onClick={() => open(false)}>
              Open
            </Button>
          )}
          <Menu label="More">
            {(close) => (
              <>
                {/* F14: a play-only file is not offered as a download (writers keep it). */}
                {file.kind === 'upload' && usable && (file.playback_rights !== 'stream_only' || file.can_edit) && (
                  <MenuItem onClick={() => { close(); open(true); }}>Download</MenuItem>
                )}
                {file.kind !== 'link' && (
                  <MenuItem onClick={() => { close(); setDialog('versions'); }}>Versions</MenuItem>
                )}
                {file.can_edit && file.kind === 'upload' && !file.archived_at && (
                  <MenuItem onClick={() => { close(); replaceInput.current?.click(); }}>Replace with a new version…</MenuItem>
                )}
                {file.can_edit && (
                  <MenuItem onClick={() => { close(); setDialog('details'); }}>Details and audience…</MenuItem>
                )}
                {extraActions?.(close)}
                {file.can_edit && (
                  <MenuItem onClick={() => { close(); archive.mutate(); }}>{file.archived_at ? 'Restore' : 'Archive'}</MenuItem>
                )}
                {file.can_edit && (
                  <MenuItem
                    tone="danger"
                    onClick={() => {
                      close();
                      if (window.confirm(`Delete “${file.title}” and all its versions? This cannot be undone.`)) remove.mutate();
                    }}
                  >
                    Delete…
                  </MenuItem>
                )}
              </>
            )}
          </Menu>
        </div>
      </div>

      <input
        ref={replaceInput}
        type="file"
        className="hidden"
        aria-label={`Replace ${file.title}`}
        onChange={(event) => {
          const picked = event.target.files?.[0];
          event.target.value = '';
          if (picked) void replace.start(picked, { kind: 'replace', file });
        }}
      />

      {replacing && (
        <div role="status" aria-live="polite" className="mt-2 text-xs text-slate-500">
          {replace.state.phase === 'uploading' ? (
            <>
              <progress className="w-48 align-middle" max={replace.state.total} value={replace.state.loaded} /> Uploading the new
              version — the current one stays until this finishes.
            </>
          ) : (
            'Saving the new version…'
          )}{' '}
          <button type="button" className="underline" onClick={() => void replace.cancel()}>
            Cancel
          </button>
        </div>
      )}
      {replace.state.phase === 'failed' && (
        <p role="alert" className="mt-2 text-xs text-rose-700">
          {replace.state.message}{' '}
          {replace.state.retryable && (
            <button type="button" className="underline" onClick={() => void replace.retry()}>
              Retry
            </button>
          )}
        </p>
      )}

      {file.pending_versions.map((pending) => (
        <p key={pending.id} className="mt-2 rounded bg-slate-50 px-2 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {pending.status === 'pending'
            ? `Unfinished upload “${pending.filename}” (expires ${pending.upload_expires_at ? formatDateTime(pending.upload_expires_at) : 'soon'}) — not shown to anyone yet.`
            : `Upload “${pending.filename}” was not saved: ${fileUploadOutcomeMessage(pending.status === 'expired' ? 'expired' : 'failed', pending.failure_reason) ?? ''}`}{' '}
          {pending.status === 'pending' && (
            <>
              <button type="button" className="underline" onClick={() => checkAgain.mutate(pending)}>
                Check again
              </button>{' '}
              <button type="button" className="underline" onClick={() => discard.mutate(pending)}>
                Discard
              </button>
            </>
          )}
        </p>
      ))}

      {error && (
        <p role="alert" className="mt-2 text-xs text-rose-700">
          {error}
        </p>
      )}

      {dialog === 'details' && <FileDetailsModal file={file} planId={planId} onClose={() => setDialog(null)} onSaved={onChanged} />}
      {dialog === 'versions' && <FileVersionsModal file={file} onClose={() => setDialog(null)} />}
      {dialog === 'document' && (
        <DocumentModal
          file={file}
          versionId={shown && !shown.is_current ? shown.id : null}
          onClose={() => setDialog(null)}
          onSaved={onChanged}
        />
      )}
    </li>
  );
};
