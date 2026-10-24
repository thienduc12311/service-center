import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { FileSummary } from '@service-center/shared';
import { api } from './api';
import { queryKeys } from './query-keys';
import { putFileBytes } from './file-transfer';
import {
  checkPickedFile,
  runFileUpload,
  type FileUploadDestination,
  type FileUploadState,
  type PendingFileUpload,
  type PickedDeviceFile,
} from './file-upload';
import { newIdempotencyKey } from './idempotency';
import { useAuth } from '../providers/AuthProvider';

export interface NativeFileUpload {
  state: FileUploadState;
  start: (picked: PickedDeviceFile, destination: FileUploadDestination) => Promise<FileSummary | null>;
  /** Same intent and key: never a second file. */
  retry: () => Promise<FileSummary | null>;
  /** Stops the bytes and abandons the intent so nothing half-finished stays. */
  cancel: () => Promise<void>;
  reset: () => void;
}

/** Refreshes every file list, detail and rehearsal manifest of this identity. */
export const useInvalidateFiles = (): (() => Promise<void>) => {
  const queryClient = useQueryClient();
  const { queryScope } = useAuth();
  return useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.filesAll(queryScope) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.rehearsalAll(queryScope) }),
      // MOB-030: a media bundle's detail lists its files.
      queryClient.invalidateQueries({ queryKey: queryKeys.mediaAll(queryScope) }),
    ]);
  }, [queryClient, queryScope]);
};

/**
 * MOB-026: the website's `useFileUpload` on a phone. Results that arrive
 * after a sign-out or organization switch are dropped. Cancel stops the
 * bytes and abandons the intent; leaving the screen only stops the bytes.
 */
export const useNativeFileUpload = (onFinished?: (file: FileSummary) => void): NativeFileUpload => {
  const { generation, isCurrentGeneration } = useAuth();
  const invalidate = useInvalidateFiles();
  const [state, setState] = useState<FileUploadState>({ phase: 'idle' });
  const pendingRef = useRef<PendingFileUpload | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(generation);

  const run = useCallback(async (): Promise<FileSummary | null> => {
    const pending = pendingRef.current;
    if (!pending) return null;
    const started = generationRef.current;
    const current = () => isCurrentGeneration(started) && pendingRef.current === pending;
    const controller = new AbortController();
    abortRef.current = controller;
    const outcome = await runFileUpload(
      pending,
      {
        createIntent: (body) => api.createFileUploadIntent(body),
        putBytes: (target, picked, mimeType, onProgress) => putFileBytes(target, picked, mimeType, onProgress, controller.signal),
        finalize: (fileId, versionId) => api.finalizeFile(fileId, versionId),
      },
      (next) => {
        if (current()) setState(next);
      },
    );
    if (abortRef.current === controller) abortRef.current = null;
    if (!current()) return null;
    if (!outcome.keepPending) pendingRef.current = null;
    setState(outcome.state);
    // A settled failure may have left a failed version writers can see; a
    // refusal (stale revision, access lost) means the lists are out of date.
    if (
      outcome.state.phase === 'done' ||
      (outcome.state.phase === 'failed' && (outcome.state.failure.kind === 'outcome' || outcome.state.failure.kind === 'refused'))
    ) {
      await invalidate();
    }
    if (outcome.state.phase !== 'done') return null;
    onFinished?.(outcome.state.file);
    return outcome.state.file;
  }, [invalidate, isCurrentGeneration, onFinished]);

  const start = useCallback(
    async (picked: PickedDeviceFile, destination: FileUploadDestination): Promise<FileSummary | null> => {
      const check = checkPickedFile(picked);
      if (!check.ok) {
        setState({ phase: 'failed', filename: picked.name, failure: check.failure, retryable: false });
        return null;
      }
      generationRef.current = generation;
      pendingRef.current = {
        picked,
        size: check.size,
        destination,
        mimeType: check.mimeType,
        idempotencyKey: newIdempotencyKey(),
        intent: null,
      };
      return run();
    },
    [generation, run],
  );

  const cancel = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    const pending = pendingRef.current;
    pendingRef.current = null;
    setState({ phase: 'idle' });
    if (pending?.intent && isCurrentGeneration(generationRef.current)) {
      await api.abandonFileUpload(pending.intent.file.id, pending.intent.version.id);
      await invalidate();
    }
  }, [invalidate, isCurrentGeneration]);

  const reset = useCallback(() => {
    pendingRef.current = null;
    setState({ phase: 'idle' });
  }, []);

  // Leaving the screen: stop the bytes. An intent that was created stays
  // visible to writers as an unfinished upload (Check again / Discard) until
  // it expires — the same as closing the website's tab.
  useEffect(() => () => abortRef.current?.abort(), []);

  return { state, start, retry: run, cancel, reset };
};
