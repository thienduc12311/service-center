import { useCallback, useRef, useState } from 'react';
import {
  FILE_MAX_BYTES,
  fileCategoryForMimeType,
  fileUploadOutcomeMessage,
  formatFileSize,
  resolveFileMimeType,
  type FileAudience,
  type FileCategory,
  type FileMimeType,
  type FileOwnerRef,
  type FileSummary,
  type FileUploadIntent,
  type FileUploadTarget,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { env } from '../../lib/env';

/** Where the bytes go: a new file under a parent, or a new version of an existing file. */
export type FileUploadDestination =
  | {
      kind: 'new';
      owner: FileOwnerRef;
      audience: FileAudience;
      teamIds: string[];
      positionIds: string[];
      category?: FileCategory;
      title?: string;
    }
  | { kind: 'replace'; file: FileSummary };

/** Each step is shown as it happens; only `done` means a file version exists. */
export type FileUploadState =
  | { phase: 'idle' }
  | { phase: 'preparing'; filename: string }
  | { phase: 'uploading'; filename: string; loaded: number; total: number }
  | { phase: 'finalizing'; filename: string }
  | { phase: 'done'; filename: string; file: FileSummary }
  | {
      phase: 'failed';
      filename: string;
      message: string;
      /** The same intent can be retried (network failure, bytes not stored yet). */
      retryable: boolean;
    };

export interface FileUploadController {
  state: FileUploadState;
  start: (picked: File, destination: FileUploadDestination) => Promise<FileSummary | null>;
  retry: () => Promise<FileSummary | null>;
  cancel: () => Promise<void>;
  reset: () => void;
}

class UploadHttpError extends Error {
  constructor(readonly status: number, readonly body: string) {
    super(`Upload failed (${status})`);
  }
}

/** PUTs the bytes to the one signed path, reporting progress. */
const putBytes = (
  target: FileUploadTarget,
  picked: File,
  contentType: FileMimeType,
  onProgress: (loaded: number, total: number) => void,
  register: (xhr: XMLHttpRequest) => void,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    register(xhr);
    xhr.open('PUT', target.signed_url);
    xhr.setRequestHeader('content-type', contentType);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.setRequestHeader('apikey', env.supabaseAnonKey);
    xhr.upload.onprogress = (event) => onProgress(event.loaded, event.lengthComputable ? event.total : picked.size);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new UploadHttpError(xhr.status, xhr.responseText));
    xhr.onerror = () => reject(new Error('The connection was interrupted'));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    xhr.send(picked);
  });

const alreadyStored = (error: unknown): boolean =>
  error instanceof UploadHttpError && (error.status === 409 || /already exists/i.test(error.body));

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : 'Something went wrong');

/**
 * Upload intent → bytes to the exact signed path → finalize. A retry reuses
 * the same intent (and idempotency key), so a repeated click never creates a
 * second file; cancelling abandons the intent so nothing half-finished stays.
 */
export const useFileUpload = (onFinished?: (file: FileSummary) => void): FileUploadController => {
  const [state, setState] = useState<FileUploadState>({ phase: 'idle' });
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const pendingRef = useRef<{
    picked: File;
    destination: FileUploadDestination;
    mimeType: FileMimeType;
    key: string;
    intent: FileUploadIntent | null;
  } | null>(null);

  const run = useCallback(async (): Promise<FileSummary | null> => {
    const pending = pendingRef.current;
    if (!pending) return null;
    const { picked, destination, mimeType } = pending;
    const filename = picked.name;
    try {
      if (!pending.intent) {
        setState({ phase: 'preparing', filename });
        pending.intent = await api.createFileUploadIntent(
          destination.kind === 'new'
            ? {
                owner: destination.owner,
                filename,
                mime_type: mimeType,
                size_bytes: picked.size,
                title: destination.title,
                category: destination.category ?? fileCategoryForMimeType(mimeType),
                audience: destination.audience,
                team_ids: destination.teamIds,
                position_ids: destination.positionIds,
                idempotency_key: pending.key,
              }
            : {
                file_id: destination.file.id,
                expected_revision: destination.file.revision,
                filename,
                mime_type: mimeType,
                size_bytes: picked.size,
                idempotency_key: pending.key,
              },
        );
      }
      const intent = pending.intent;
      if (intent.upload) {
        setState({ phase: 'uploading', filename, loaded: 0, total: picked.size });
        try {
          await putBytes(
            intent.upload,
            picked,
            mimeType,
            (loaded, total) => setState({ phase: 'uploading', filename, loaded, total }),
            (xhr) => {
              xhrRef.current = xhr;
            },
          );
        } catch (error) {
          // A retry after the bytes already landed: go straight to finalize.
          if (!alreadyStored(error)) throw error;
        }
      }
      setState({ phase: 'finalizing', filename });
      const result = await api.finalizeFile(intent.file.id, intent.version.id);
      if (result.outcome === 'ready') {
        pendingRef.current = null;
        setState({ phase: 'done', filename, file: result.file });
        onFinished?.(result.file);
        return result.file;
      }
      setState({
        phase: 'failed',
        filename,
        message: fileUploadOutcomeMessage(result.outcome, result.reason) ?? 'The upload was not saved.',
        retryable: result.outcome === 'not_uploaded',
      });
      if (result.outcome !== 'not_uploaded') pendingRef.current = null;
      return null;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return null;
      setState({
        phase: 'failed',
        filename,
        message: `${messageOf(error)}. Nothing was saved yet — retry to continue the same upload.`,
        retryable: true,
      });
      return null;
    } finally {
      xhrRef.current = null;
    }
  }, [onFinished]);

  const start = useCallback(
    async (picked: File, destination: FileUploadDestination): Promise<FileSummary | null> => {
      const mimeType = resolveFileMimeType(picked.name, picked.type);
      if (!mimeType) {
        setState({ phase: 'failed', filename: picked.name, message: 'This file type is not supported.', retryable: false });
        return null;
      }
      if (picked.size === 0 || picked.size > FILE_MAX_BYTES) {
        setState({
          phase: 'failed',
          filename: picked.name,
          message: picked.size === 0 ? 'This file is empty.' : `Files are limited to ${formatFileSize(FILE_MAX_BYTES)}.`,
          retryable: false,
        });
        return null;
      }
      pendingRef.current = { picked, destination, mimeType, key: crypto.randomUUID(), intent: null };
      return run();
    },
    [run],
  );

  const cancel = useCallback(async () => {
    xhrRef.current?.abort();
    const pending = pendingRef.current;
    pendingRef.current = null;
    setState({ phase: 'idle' });
    if (pending?.intent) {
      await api.abandonFileUpload(pending.intent.file.id, pending.intent.version.id);
    }
  }, []);

  const reset = useCallback(() => {
    pendingRef.current = null;
    setState({ phase: 'idle' });
  }, []);

  return { state, start, retry: run, cancel, reset };
};
