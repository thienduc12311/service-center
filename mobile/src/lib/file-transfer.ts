import { Directory, File, Paths, UploadType } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { FileMimeType, FileUploadTarget } from '@service-center/shared';
import { env } from './env';
import { safeShareFileName } from './file-view';
import { StorageUploadError, UploadCancelledError, type PickedDeviceFile } from './file-upload';
import { newIdempotencyKey } from './idempotency';

/**
 * MOB-026 device I/O for F13 files: the signed PUT of picked bytes, and the
 * temporary copy handed to the OS share sheet. Nothing here keeps a file or a
 * link: share copies are deleted as soon as the sheet closes.
 */

const isAbort = (error: unknown): boolean => error instanceof Error && error.name === 'AbortError';

/** The size of a picked file, measured on the device (null when it cannot be read). */
export const measurePickedFile = (uri: string): number | null => {
  try {
    const file = new File(uri);
    return file.exists ? file.size : null;
  } catch {
    return null;
  }
};

/**
 * PUTs the bytes, unchanged, to the one signed path — the same request the
 * website sends (`content-type`, `x-upsert: false`, `apikey`). Runs in the
 * foreground session: cancelling the screen cancels the request.
 */
export const putFileBytes = async (
  target: FileUploadTarget,
  picked: PickedDeviceFile,
  contentType: FileMimeType,
  onProgress: (loaded: number, total: number) => void,
  signal: AbortSignal,
): Promise<void> => {
  try {
    const result = await new File(picked.uri).upload(target.signed_url, {
      httpMethod: 'PUT',
      uploadType: UploadType.BINARY_CONTENT,
      mimeType: contentType,
      headers: { 'content-type': contentType, 'x-upsert': 'false', apikey: env.supabaseAnonKey },
      onProgress: ({ bytesSent, totalBytes }) => onProgress(bytesSent, totalBytes),
      sessionType: 'foreground',
      signal,
    });
    if (result.status < 200 || result.status >= 300) throw new StorageUploadError(result.status, result.body);
  } catch (error) {
    if (signal.aborted || isAbort(error)) throw new UploadCancelledError();
    throw error;
  }
};

const shareRoot = (): Directory => new Directory(Paths.cache, 'file-shares');

/** Removes every temporary share copy (after a share, and before the next one). */
export const clearSharedCopies = (): void => {
  try {
    const root = shareRoot();
    if (root.exists) root.delete();
  } catch {
    // Cache storage: the OS clears it too. Nothing else depends on it.
  }
};

export const isSharingAvailable = (): Promise<boolean> => Sharing.isAvailableAsync();

/**
 * Downloads one authorized `attachment` link into a private temporary folder
 * and opens the share sheet with it. The copy is deleted when the sheet
 * closes, whatever the person chose; the server records nothing about it.
 */
export const shareDownloadedCopy = async (
  url: string,
  filename: string,
  mimeType: string,
  dialogTitle: string,
  signal: AbortSignal,
): Promise<void> => {
  clearSharedCopies();
  const folder = new Directory(shareRoot(), newIdempotencyKey());
  folder.create({ intermediates: true, idempotent: true });
  try {
    const copy = await File.downloadFileAsync(url, new File(folder, safeShareFileName(filename)), { signal });
    if (signal.aborted) return;
    await Sharing.shareAsync(copy.uri, { mimeType, dialogTitle });
  } finally {
    clearSharedCopies();
  }
};
