import { useCallback, useEffect, useRef, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import type { FileSummary, FileVersionSummary } from '@service-center/shared';
import { api } from './api';
import { isFileAccessLost } from './file-view';
import { isSharingAvailable, shareDownloadedCopy } from './file-transfer';
import { useInvalidateFiles } from './useFileUpload';
import { useAuth } from '../providers/AuthProvider';

/** What is running right now, for button spinners. */
export type FileOpenBusy = 'open' | 'share' | null;

export interface FileOpenController {
  busy: FileOpenBusy;
  error: unknown;
  /** A fresh inline link (access rechecked) shown in the in-app browser. */
  openInBrowser: (file: FileSummary, version: FileVersionSummary | null) => Promise<void>;
  /** A link file's own address, asked for again so a revoked link is refused. */
  openExternal: (file: FileSummary) => Promise<void>;
  /** One `attachment` copy into a private folder → the share sheet → deleted. */
  share: (file: FileSummary, version: FileVersionSummary | null, dialogTitle: string) => Promise<'shown' | 'unavailable' | 'failed'>;
  clearError: () => void;
}

/**
 * MOB-026: opening and sharing never reuse a link — each asks the server
 * again, so a narrowed audience, archive or deletion is honoured at the next
 * tap. A refusal refreshes the file lists so the file disappears from view.
 */
export const useFileOpen = (): FileOpenController => {
  const { generation, isCurrentGeneration } = useAuth();
  const invalidate = useInvalidateFiles();
  const [busy, setBusy] = useState<FileOpenBusy>(null);
  const [error, setError] = useState<unknown>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const fail = useCallback(
    async (cause: unknown, started: number) => {
      if (!isCurrentGeneration(started)) return;
      setError(cause);
      if (isFileAccessLost(cause)) await invalidate();
    },
    [invalidate, isCurrentGeneration],
  );

  const openInBrowser = useCallback(
    async (file: FileSummary, version: FileVersionSummary | null) => {
      const started = generation;
      setBusy('open');
      setError(null);
      try {
        const link = await api.fileDownload(file.id, { version_id: version?.id, disposition: 'inline' });
        if (!isCurrentGeneration(started)) return;
        await WebBrowser.openBrowserAsync(link.url, { dismissButtonStyle: 'close' });
      } catch (cause) {
        await fail(cause, started);
      } finally {
        if (isCurrentGeneration(started)) setBusy(null);
      }
    },
    [fail, generation, isCurrentGeneration],
  );

  const openExternal = useCallback(
    async (file: FileSummary) => {
      const started = generation;
      setBusy('open');
      setError(null);
      try {
        const link = await api.fileDownload(file.id);
        if (!isCurrentGeneration(started)) return;
        await WebBrowser.openBrowserAsync(link.url, { dismissButtonStyle: 'close' });
      } catch (cause) {
        await fail(cause, started);
      } finally {
        if (isCurrentGeneration(started)) setBusy(null);
      }
    },
    [fail, generation, isCurrentGeneration],
  );

  const share = useCallback(
    async (file: FileSummary, version: FileVersionSummary | null, dialogTitle: string) => {
      const started = generation;
      if (!(await isSharingAvailable())) return 'unavailable' as const;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy('share');
      setError(null);
      try {
        const link = await api.fileDownload(file.id, { version_id: version?.id, disposition: 'attachment' });
        if (!isCurrentGeneration(started) || controller.signal.aborted) return 'failed' as const;
        await shareDownloadedCopy(link.url, link.filename, version?.mime_type ?? 'application/octet-stream', dialogTitle, controller.signal);
        return 'shown' as const;
      } catch (cause) {
        if (!controller.signal.aborted) await fail(cause, started);
        return 'failed' as const;
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        if (isCurrentGeneration(started)) setBusy(null);
      }
    },
    [fail, generation, isCurrentGeneration],
  );

  const clearError = useCallback(() => setError(null), []);

  return { busy, error, openInBrowser, openExternal, share, clearError };
};
