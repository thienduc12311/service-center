import {
  ApiError,
  FILE_MAX_BYTES,
  fileCategoryForMimeType,
  resolveFileMimeType,
  type CreateFileUploadIntentRequest,
  type FileAudience,
  type FileCategory,
  type FileFailureReason,
  type FileFinalizeOutcome,
  type FileFinalizeResult,
  type FileMimeType,
  type FileOwnerRef,
  type FileSummary,
  type FileUploadIntent,
  type FileUploadTarget,
} from '@service-center/shared';

/**
 * MOB-026: the F13 upload lifecycle on a phone — intent → bytes to the one
 * signed path → finalize — exactly as the website's `useFileUpload` runs it.
 * Pure (I/O injected) so the same steps are tested without a device.
 */

/** A file chosen from the device (document picker or photo library). */
export interface PickedDeviceFile {
  /** Local `file://` address the picker copied the file to. */
  uri: string;
  name: string;
  /** Measured on the device; null when it could not be read. */
  size: number | null;
  /** What the OS reported; checked against the shared allowlist. */
  mimeType: string | null;
}

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

/** Why an upload did not become a file version. */
export type FileUploadFailure =
  | { kind: 'outcome'; outcome: FileFinalizeOutcome; reason: FileFailureReason | null }
  | { kind: 'unsupportedType' }
  | { kind: 'empty' }
  | { kind: 'tooLarge'; maxBytes: number }
  /** The picked file could not be read (size unknown). */
  | { kind: 'unreadable' }
  /** The request failed before the server answered (network, storage error). */
  | { kind: 'interrupted'; error: unknown }
  /** The server refused it (stale revision, access revoked, key reused): retrying the same request cannot help. */
  | { kind: 'refused'; error: unknown };

/** Each step as it happens; only `done` means a file version exists. */
export type FileUploadState =
  | { phase: 'idle' }
  | { phase: 'preparing'; filename: string }
  | { phase: 'uploading'; filename: string; loaded: number; total: number }
  | { phase: 'finalizing'; filename: string }
  | { phase: 'done'; filename: string; file: FileSummary }
  | {
      phase: 'failed';
      filename: string;
      failure: FileUploadFailure;
      /** The same intent (and key) can be retried: network failure, bytes not stored yet. */
      retryable: boolean;
    };

export type PickedFileCheck =
  | { ok: true; mimeType: FileMimeType; size: number }
  | { ok: false; failure: FileUploadFailure };

/** The same early refusals as the website; the database and Storage check again. */
export const checkPickedFile = (picked: PickedDeviceFile): PickedFileCheck => {
  const mimeType = resolveFileMimeType(picked.name, picked.mimeType);
  if (!mimeType) return { ok: false, failure: { kind: 'unsupportedType' } };
  if (picked.size === null) return { ok: false, failure: { kind: 'unreadable' } };
  if (picked.size === 0) return { ok: false, failure: { kind: 'empty' } };
  if (picked.size > FILE_MAX_BYTES) return { ok: false, failure: { kind: 'tooLarge', maxBytes: FILE_MAX_BYTES } };
  return { ok: true, mimeType, size: picked.size };
};

/** The intent body the website sends for the same choice. */
export const uploadIntentRequest = (
  destination: FileUploadDestination,
  picked: { name: string; size: number },
  mimeType: FileMimeType,
  idempotencyKey: string,
): CreateFileUploadIntentRequest =>
  destination.kind === 'new'
    ? {
        owner: destination.owner,
        filename: picked.name,
        mime_type: mimeType,
        size_bytes: picked.size,
        title: destination.title,
        category: destination.category ?? fileCategoryForMimeType(mimeType),
        audience: destination.audience,
        team_ids: destination.teamIds,
        position_ids: destination.positionIds,
        idempotency_key: idempotencyKey,
      }
    : {
        file_id: destination.file.id,
        expected_revision: destination.file.revision,
        filename: picked.name,
        mime_type: mimeType,
        size_bytes: picked.size,
        idempotency_key: idempotencyKey,
      };

/** One upload in progress; kept between retries so a retry reuses the intent and key. */
export interface PendingFileUpload {
  picked: PickedDeviceFile;
  size: number;
  destination: FileUploadDestination;
  mimeType: FileMimeType;
  idempotencyKey: string;
  intent: FileUploadIntent | null;
}

/** A non-2xx answer from Storage to the signed PUT. */
export class StorageUploadError extends Error {
  constructor(readonly status: number, readonly body: string) {
    super(`Upload failed (${status})`);
    this.name = 'StorageUploadError';
  }
}

/** Thrown by `putBytes` when the person cancels. */
export class UploadCancelledError extends Error {
  constructor() {
    super('Upload cancelled');
    this.name = 'UploadCancelledError';
  }
}

/** Supabase refuses a second PUT to the same path: the bytes from an earlier attempt are there. */
export const isAlreadyStored = (error: unknown): boolean =>
  error instanceof StorageUploadError && (error.status === 409 || /already exists/i.test(error.body));

/** A 4xx from the API is an answer, not a lost request (timeouts and rate limits can still be retried). */
const isRefusal = (error: unknown): boolean =>
  error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;

export interface FileUploadIO {
  createIntent: (body: CreateFileUploadIntentRequest) => Promise<FileUploadIntent>;
  putBytes: (
    target: FileUploadTarget,
    picked: PickedDeviceFile,
    mimeType: FileMimeType,
    onProgress: (loaded: number, total: number) => void,
  ) => Promise<void>;
  finalize: (fileId: string, versionId: string) => Promise<FileFinalizeResult>;
}

export interface FileUploadRun {
  state: FileUploadState;
  /** False once the intent is settled (ready, failed, expired) — nothing left to retry. */
  keepPending: boolean;
}

/**
 * Runs (or resumes) one upload. `pending.intent` is filled in place, so a
 * retry after a lost answer skips straight to the bytes or to finalize; a
 * cancelled run returns `idle`.
 */
export const runFileUpload = async (
  pending: PendingFileUpload,
  io: FileUploadIO,
  report: (state: FileUploadState) => void,
): Promise<FileUploadRun> => {
  const filename = pending.picked.name;
  try {
    if (!pending.intent) {
      report({ phase: 'preparing', filename });
      pending.intent = await io.createIntent(
        uploadIntentRequest(pending.destination, { name: filename, size: pending.size }, pending.mimeType, pending.idempotencyKey),
      );
    }
    const intent = pending.intent;
    if (intent.upload) {
      report({ phase: 'uploading', filename, loaded: 0, total: pending.size });
      try {
        await io.putBytes(intent.upload, pending.picked, pending.mimeType, (loaded, total) =>
          report({ phase: 'uploading', filename, loaded, total }),
        );
      } catch (error) {
        // A retry after the bytes already landed: go straight to finalize.
        if (!isAlreadyStored(error)) throw error;
      }
    }
    report({ phase: 'finalizing', filename });
    const result = await io.finalize(intent.file.id, intent.version.id);
    if (result.outcome === 'ready') return { state: { phase: 'done', filename, file: result.file }, keepPending: false };
    const retryable = result.outcome === 'not_uploaded';
    return {
      state: {
        phase: 'failed',
        filename,
        failure: { kind: 'outcome', outcome: result.outcome, reason: result.reason ?? null },
        retryable,
      },
      keepPending: retryable,
    };
  } catch (error) {
    if (error instanceof UploadCancelledError) return { state: { phase: 'idle' }, keepPending: false };
    if (isRefusal(error)) {
      return { state: { phase: 'failed', filename, failure: { kind: 'refused', error }, retryable: false }, keepPending: false };
    }
    return { state: { phase: 'failed', filename, failure: { kind: 'interrupted', error }, retryable: true }, keepPending: true };
  }
};

export const isUploadBusy = (state: FileUploadState): boolean =>
  state.phase === 'preparing' || state.phase === 'uploading' || state.phase === 'finalizing';
