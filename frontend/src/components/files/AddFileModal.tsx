import { useRef, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  FILE_CATEGORY_LABELS,
  formatFileSize,
  type FileCategory,
  type FileOwnerRef,
  type FileSummary,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { Button, Modal } from '../ui';
import { AudienceFields, type FileAudienceValue } from './AudienceFields';
import { fileErrorMessage } from './fileActions';
import { useFileUpload } from './useFileUpload';

/** Upload a file, add a web link or write a text document under one parent. */
export type AddFileMode = 'upload' | 'link' | 'document';

export interface AddFileModalProps {
  owner: FileOwnerRef;
  planId?: string | null;
  mode: AddFileMode;
  onClose: () => void;
  onAdded: (file: FileSummary) => void;
}

const TITLES: Record<AddFileMode, string> = {
  upload: 'Upload a file',
  link: 'Add a link',
  document: 'New text document',
};

export const AddFileModal = ({ owner, planId = null, mode, onClose, onAdded }: AddFileModalProps) => {
  const [audience, setAudience] = useState<FileAudienceValue>({ audience: 'organization', teamIds: [], positionIds: [] });
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<FileCategory | ''>('');
  const [url, setUrl] = useState('');
  const [body, setBody] = useState('');
  const [picked, setPicked] = useState<File | null>(null);
  // One key per dialog: a double click or retry of "Save" is one link/document.
  const keyRef = useRef(crypto.randomUUID());
  const upload = useFileUpload(onAdded);

  const save = useMutation({
    mutationFn: async (): Promise<FileSummary> => {
      const shared = {
        owner,
        title: title.trim(),
        category: category || (mode === 'link' ? 'other' : 'document'),
        audience: audience.audience,
        team_ids: audience.teamIds,
        position_ids: audience.positionIds,
        idempotency_key: keyRef.current,
      } as const;
      return mode === 'link'
        ? api.createFileLink({ ...shared, url: url.trim() })
        : api.createFileDocument({ ...shared, body });
    },
    onSuccess: (file) => {
      onAdded(file);
      onClose();
    },
  });

  const targetsMissing =
    (audience.audience === 'teams' && audience.teamIds.length === 0) ||
    (audience.audience === 'positions' && audience.positionIds.length === 0);
  const busy = upload.state.phase === 'preparing' || upload.state.phase === 'uploading' || upload.state.phase === 'finalizing';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (mode !== 'upload') {
      save.mutate();
      return;
    }
    if (!picked) return;
    const file = await upload.start(picked, {
      kind: 'new',
      owner,
      audience: audience.audience,
      teamIds: audience.teamIds,
      positionIds: audience.positionIds,
      category: category || undefined,
      title: title.trim() || undefined,
    });
    if (file) onClose();
  };

  const close = () => {
    if (busy) void upload.cancel();
    onClose();
  };

  return (
    <Modal open title={TITLES[mode]} onClose={close} size={mode === 'document' ? 'wide' : 'default'}>
      <form className="space-y-4" onSubmit={submit}>
        {mode === 'upload' && (
          <label className="block">
            <span className="label">File</span>
            <input
              type="file"
              className="input"
              disabled={busy}
              onChange={(event) => {
                upload.reset();
                setPicked(event.target.files?.[0] ?? null);
              }}
            />
            <span className="mt-1 block text-xs text-slate-500">PDF, images, audio, video, text and Office documents up to 25 MB.</span>
          </label>
        )}

        <label className="block">
          <span className="label">Title{mode === 'upload' ? ' (optional)' : ''}</span>
          <input
            className="input"
            value={title}
            maxLength={200}
            required={mode !== 'upload'}
            placeholder={mode === 'upload' ? picked?.name ?? 'The file name' : ''}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>

        {mode === 'link' && (
          <label className="block">
            <span className="label">Web address</span>
            <input
              className="input"
              type="url"
              required
              placeholder="https://"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
            <span className="mt-1 block text-xs text-slate-500">
              Opens the other site directly. Service Center never downloads it, and that site decides who can play or save it.
            </span>
          </label>
        )}

        {mode === 'document' && (
          <label className="block">
            <span className="label">Text</span>
            <textarea
              className="input min-h-64 font-mono text-sm"
              value={body}
              maxLength={100_000}
              onChange={(event) => setBody(event.target.value)}
            />
            <span className="mt-1 block text-xs text-slate-500">
              Formatting: # Heading, - bullet, 1. numbered, **bold**, *italic*. Anything else is shown as plain text.
            </span>
          </label>
        )}

        <label className="block">
          <span className="label">Category</span>
          <select className="input" value={category} onChange={(event) => setCategory(event.target.value as FileCategory | '')}>
            <option value="">{mode === 'upload' ? 'From the file type' : 'Choose…'}</option>
            {Object.entries(FILE_CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <AudienceFields ownerKind={owner.kind} planId={planId} value={audience} onChange={setAudience} />

        {upload.state.phase === 'uploading' && (
          <div role="status" aria-live="polite">
            <progress className="w-full" max={upload.state.total} value={upload.state.loaded} />
            <p className="text-xs text-slate-500">
              Uploading {formatFileSize(upload.state.loaded)} of {formatFileSize(upload.state.total)} — not saved until it finishes.
            </p>
          </div>
        )}
        {upload.state.phase === 'preparing' && <p role="status" className="text-sm text-slate-500">Preparing the upload…</p>}
        {upload.state.phase === 'finalizing' && <p role="status" className="text-sm text-slate-500">Checking the stored file…</p>}
        {upload.state.phase === 'failed' && (
          <div role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-600/20">
            {upload.state.message}
            {upload.state.retryable && (
              <Button type="button" variant="secondary" className="ml-2" onClick={() => void upload.retry()}>
                Retry
              </Button>
            )}
          </div>
        )}
        {save.error && (
          <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-600/20">
            {fileErrorMessage(save.error)}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={close}>
            {busy ? 'Cancel upload' : 'Cancel'}
          </Button>
          <Button
            type="submit"
            loading={busy || save.isPending}
            disabled={targetsMissing || (mode === 'upload' && !picked)}
          >
            {mode === 'upload' ? 'Upload' : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
