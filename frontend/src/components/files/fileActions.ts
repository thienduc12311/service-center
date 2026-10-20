import {
  ApiError,
  FALLBACK_LOCALE,
  isInlinePreviewable,
  isSupportedLocale,
  presentError,
  translateMessage,
  type FileCategory,
  type FileFailureReason,
  type FileFinalizeOutcome,
  type FileSummary,
  type FileVersionSummary,
  formatFileSize,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { i18n } from '../../i18n';
import type { FileUploadFailure } from './useFileUpload';

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

/** Every file category, in the order pickers show them. */
export const FILE_CATEGORIES: readonly FileCategory[] = ['chart', 'lyrics', 'audio', 'video', 'image', 'document', 'other'];

const mediaT = () => i18n.getFixedT(null, 'media');

/** Localized text for any thrown value, outside React (mirrors `useErrorText`). */
const errorTextNow = (error: unknown): string => {
  const locale = isSupportedLocale(i18n.language) ? i18n.language : FALLBACK_LOCALE;
  const presentation = presentError(error, locale);
  return presentation.kind === 'text' ? presentation.text : translateMessage(i18n, presentation.message);
};

/**
 * People-facing text for an API failure on a file action, in the displayed
 * language. A plain function (other screens call it), so it reads the
 * language from the app's i18next instance.
 */
export const fileErrorMessage = (error: unknown): string => {
  const t = mediaT();
  if (error instanceof ApiError) {
    if (error.code === 'file_revision_stale') return t('fileErrors.revisionStale');
    if (error.code === 'file_stream_only') return t('fileErrors.streamOnly');
    if (error.code !== 'file_in_use') {
      if (error.status === 403) return t('fileErrors.forbidden');
      if (error.status === 404) return t('fileErrors.notFound');
    }
  }
  return errorTextNow(error);
};

/** What to tell the person when an upload did not become a file version (null when it did). */
export const fileUploadOutcomeText = (outcome: FileFinalizeOutcome, reason: FileFailureReason | null | undefined): string | null => {
  const t = mediaT();
  if (outcome === 'ready') return null;
  if (outcome === 'not_uploaded') return t('uploadOutcome.notUploaded');
  if (outcome === 'expired') return t('uploadOutcome.expired');
  switch (reason) {
    case 'size_mismatch':
      return t('uploadOutcome.sizeMismatch');
    case 'type_mismatch':
      return t('uploadOutcome.typeMismatch');
    case 'superseded':
      return t('uploadOutcome.superseded');
    case 'abandoned':
      return t('uploadOutcome.abandoned');
    default:
      return t('uploadOutcome.failed');
  }
};

/** "v3", or the state of a version that has no number yet. */
export const fileVersionText = (version: Pick<FileVersionSummary, 'version_number' | 'status'>): string => {
  const t = mediaT();
  if (version.version_number) return t('files.versionNumber', { number: version.version_number });
  return version.status === 'pending' ? t('files.versionUploading') : t('files.versionNotSaved');
};

/** The text for a failed upload, in the displayed language. */
export const fileUploadFailureText = (failure: FileUploadFailure): string => {
  const t = mediaT();
  switch (failure.kind) {
    case 'outcome':
      return fileUploadOutcomeText(failure.outcome, failure.reason) ?? t('uploadOutcome.notSaved');
    case 'unsupportedType':
      return t('upload.unsupportedType');
    case 'empty':
      return t('upload.empty');
    case 'tooLarge':
      return t('upload.tooLarge', { size: formatFileSize(failure.maxBytes) });
    case 'interrupted':
      return t('upload.interrupted', { reason: errorTextNow(failure.error) });
  }
};
