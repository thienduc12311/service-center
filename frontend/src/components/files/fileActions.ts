import { ApiError, isInlinePreviewable, type FileSummary } from '@service-center/shared';
import { api } from '../../lib/api';

/**
 * Asks the API for a fresh short-lived link (access is rechecked every time)
 * and opens it. The tab is opened first so the browser does not treat it as
 * an unrequested pop-up.
 */
export const openFileVersion = async (
  file: FileSummary,
  options: { versionId?: string | null; download?: boolean } = {},
): Promise<void> => {
  const tab = window.open('', '_blank');
  try {
    const result = await api.fileDownload(file.id, {
      version_id: options.versionId ?? undefined,
      disposition: options.download ? 'attachment' : 'inline',
    });
    if (tab) {
      tab.opener = null;
      tab.location.href = result.url;
    } else {
      window.location.assign(result.url);
    }
  } catch (error) {
    tab?.close();
    throw error;
  }
};

/** Whether "Open" previews in the browser or only downloads. */
export const canPreviewInline = (file: FileSummary): boolean =>
  file.kind === 'link' || file.kind === 'document' || isInlinePreviewable(file.current_version?.mime_type ?? '');

/** People-facing text for an API failure on a file action. */
export const fileErrorMessage = (error: unknown): string => {
  if (error instanceof ApiError) {
    if (error.code === 'file_revision_stale') return 'Someone else changed this file. The list has been refreshed — check it and try again.';
    if (error.code === 'file_in_use') return error.message;
    if (error.code === 'file_stream_only') return 'This file can be played here but not downloaded.';
    if (error.status === 403) return 'You do not have permission to change this file.';
    if (error.status === 404) return 'This file is no longer available to you.';
    return error.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong';
};
