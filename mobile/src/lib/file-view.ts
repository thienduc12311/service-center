import {
  ApiError,
  LocalizedError,
  formatFileSize,
  type ArrangementMaterials,
  type FileAudience,
  type FileFailureReason,
  type FileFinalizeOutcome,
  type FileSummary,
  type FileVersionSummary,
  type PlanFileEntry,
  type TranslatableMessage,
} from '@service-center/shared';
import type { FileUploadFailure } from './file-upload';

/**
 * MOB-026: what the phone may do with a file it was given. Every rule here
 * mirrors the website (`FileRow`, `PlanFilesTab`, `fileActions`); the server
 * still decides on every request.
 */

/**
 * How "Open" shows a file:
 * - `document`: F13 text rendered natively from `fileDocument` (structure, never markup);
 * - `image`: shown in the app from a fresh inline link;
 * - `browser`: PDF, audio, video and plain text in the in-app browser from a fresh inline link;
 * - `external`: a link file's own address, after the person confirms leaving the app;
 * - `none`: no preview on this phone (Office, MusicXML) — save a copy if allowed.
 */
export type FilePreviewMode = 'document' | 'image' | 'browser' | 'external' | 'none';

/** Images the native image view decodes on both platforms (HEIC: iOS only, opened in the browser elsewhere). */
const NATIVE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

const BROWSER_TYPES = new Set(['application/pdf', 'text/plain', 'text/markdown', 'image/heic']);

export const filePreviewMode = (file: FileSummary, version: FileVersionSummary | null): FilePreviewMode => {
  if (file.kind === 'link') return file.external_url ? 'external' : 'none';
  if (!version) return 'none';
  if (file.kind === 'document') return 'document';
  const type = version.mime_type;
  if (NATIVE_IMAGE_TYPES.has(type)) return 'image';
  if (BROWSER_TYPES.has(type) || type.startsWith('audio/') || type.startsWith('video/')) return 'browser';
  return 'none';
};

/** The version a view uses: a plan's pinned one when given, else the current one. */
export const shownVersion = (file: FileSummary, version?: FileVersionSummary | null): FileVersionSummary | null =>
  version === undefined ? file.current_version : version;

/**
 * Whether "Save or share a copy" is offered: finished uploads only, and a
 * play-only file only to its writers (the website's Download rule). The
 * server refuses `attachment` links for play-only files (`file_stream_only`).
 */
export const canSaveCopy = (file: FileSummary, version: FileVersionSummary | null): boolean =>
  file.kind === 'upload' && version !== null && version.status === 'ready' && (file.playback_rights !== 'stream_only' || file.can_edit);

/** A file name safe for the share folder (no path separators or control characters). */
export const safeShareFileName = (filename: string): string => {
  // eslint-disable-next-line no-control-regex
  const cleaned = filename.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, '_').replace(/^\.+/, '').trim();
  return (cleaned || 'file').slice(0, 120);
};

/** The host of a link file, shown before the person leaves the app. */
export const linkHost = (url: string | null): string | null => {
  if (!url) return null;
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
};

/** "Chart · Everyone · v2 · 1.2 MB" parts, in the website's order (labels translated by the caller). */
export interface FileMetaParts {
  versionNumber: number | null;
  versionPending: boolean;
  size: string | null;
  host: string | null;
  usable: boolean;
}

export const fileMetaParts = (file: FileSummary, version: FileVersionSummary | null): FileMetaParts => ({
  versionNumber: file.kind !== 'link' ? (version?.version_number ?? null) : null,
  versionPending: file.kind !== 'link' && version !== null && !version.version_number && version.status === 'pending',
  size: file.kind === 'upload' && version ? formatFileSize(version.size_bytes) || null : null,
  host: file.kind === 'link' ? linkHost(file.external_url) : null,
  usable: file.kind === 'link' || version !== null,
});

// ------------------------------------------------------------- audience --

/** The audience part of a file form; teams/positions only when that audience is chosen. */
export interface FileAudienceValue {
  audience: FileAudience;
  teamIds: string[];
  positionIds: string[];
}

/** True when a teams/positions audience has nothing chosen (the shared schema refuses it). */
export const audienceTargetsMissing = (value: FileAudienceValue): boolean =>
  (value.audience === 'teams' && value.teamIds.length === 0) ||
  (value.audience === 'positions' && value.positionIds.length === 0);

// ---------------------------------------------------------------- plans --

export interface PlanFileGroups {
  /** Plan-level files (an archived plan file without a link is hidden, as on the website). */
  plan: PlanFileEntry[];
  /** Per item, in the plan's order. */
  items: Map<string, PlanFileEntry[]>;
}

export const groupPlanFiles = (entries: readonly PlanFileEntry[]): PlanFileGroups => {
  const items = new Map<string, PlanFileEntry[]>();
  const plan: PlanFileEntry[] = [];
  for (const entry of entries) {
    if (entry.plan_item_id === null) {
      if (!(entry.file.archived_at && !entry.link)) plan.push(entry);
      continue;
    }
    const list = items.get(entry.plan_item_id) ?? [];
    list.push(entry);
    items.set(entry.plan_item_id, list);
  }
  return { plan, items };
};

/** A stable key for one entry (the same file can appear under several items). */
export const planFileEntryKey = (entry: PlanFileEntry): string =>
  `${entry.file.id}:${entry.plan_item_id ?? ''}:${entry.link?.id ?? ''}`;

/** Plan-link actions an editor is offered, in the website's order. */
export type PlanLinkAction = 'useNewest' | 'followNewest' | 'pinCurrent' | 'removeFromPlan';

export const planLinkActions = (entry: PlanFileEntry, canEdit: boolean): PlanLinkAction[] => {
  if (!entry.link || !canEdit) return [];
  const actions: PlanLinkAction[] = [];
  if (entry.newer_version_available) actions.push('useNewest');
  actions.push(entry.link.pinned_version_id ? 'followNewest' : 'pinCurrent');
  actions.push('removeFromPlan');
  return actions;
};

/** Where the entry comes from, as the website's badges say it. */
export type PlanFileBadge =
  | { kind: 'fromSong' }
  | { kind: 'fromArrangement' }
  | { kind: 'serviceTypeDefault' }
  | { kind: 'linked' }
  | { kind: 'pinnedTo'; number: number }
  | { kind: 'newerAvailable' };

export const planFileBadges = (entry: PlanFileEntry): PlanFileBadge[] => {
  const badges: PlanFileBadge[] = [];
  if (entry.source === 'song') badges.push({ kind: 'fromSong' });
  if (entry.source === 'arrangement') badges.push({ kind: 'fromArrangement' });
  if (entry.link?.source === 'service_type_default') badges.push({ kind: 'serviceTypeDefault' });
  if (entry.link?.source === 'manual') badges.push({ kind: 'linked' });
  if (entry.link?.pinned_version_id && entry.version?.version_number) {
    badges.push({ kind: 'pinnedTo', number: entry.version.version_number });
  }
  if (entry.newer_version_available) badges.push({ kind: 'newerAvailable' });
  return badges;
};

// ----------------------------------------------------------------- keys --

/**
 * F15: the labeled keys ("High — E") an arrangement file is scoped to; empty
 * when it serves every key. Only keys the caller may read are listed.
 */
export const fileKeyLabels = (materials: ArrangementMaterials | null | undefined, fileId: string): string[] => {
  if (!materials) return [];
  const ids = materials.files.find((file) => file.id === fileId)?.key_ids ?? [];
  return materials.keys
    .filter((key) => ids.includes(key.id))
    .map((key) => `${key.label} — ${key.song_key}`);
};

// ------------------------------------------------------------- messages --

/**
 * The website's `fileErrorMessage`: file-specific wording for a refusal,
 * null to fall back to the shared error text.
 */
export const fileErrorMessage = (error: unknown): TranslatableMessage | null => {
  if (!(error instanceof ApiError)) return null;
  if (error.code === 'file_revision_stale') return { key: 'media:fileErrors.revisionStale' };
  if (error.code === 'file_stream_only') return { key: 'media:fileErrors.streamOnly' };
  if (error.code === 'file_in_use') return null;
  if (error.status === 403) return { key: 'media:fileErrors.forbidden' };
  if (error.status === 404) return { key: 'media:fileErrors.notFound' };
  return null;
};

/** What `ErrorNotice` should show for a file action's failure. */
export const fileErrorForDisplay = (error: unknown): unknown => {
  if (!error) return null;
  const message = fileErrorMessage(error);
  return message ? new LocalizedError(message) : error;
};

/** Access to this file is gone (revoked, narrowed audience, archived, deleted): drop it from view. */
export const isFileAccessLost = (error: unknown): boolean =>
  error instanceof ApiError && (error.status === 404 || (error.status === 403 && error.code !== 'file_stream_only'));

export const fileUploadOutcomeMessage = (
  outcome: FileFinalizeOutcome,
  reason: FileFailureReason | null | undefined,
): TranslatableMessage | null => {
  if (outcome === 'ready') return null;
  if (outcome === 'not_uploaded') return { key: 'media:uploadOutcome.notUploaded' };
  if (outcome === 'expired') return { key: 'media:uploadOutcome.expired' };
  switch (reason) {
    case 'size_mismatch':
      return { key: 'media:uploadOutcome.sizeMismatch' };
    case 'type_mismatch':
      return { key: 'media:uploadOutcome.typeMismatch' };
    case 'superseded':
      return { key: 'media:uploadOutcome.superseded' };
    case 'abandoned':
      return { key: 'media:uploadOutcome.abandoned' };
    default:
      return { key: 'media:uploadOutcome.failed' };
  }
};

/** A failed upload as a message; null when the caller should describe the carried error itself. */
export const fileUploadFailureMessage = (failure: FileUploadFailure): TranslatableMessage | null => {
  switch (failure.kind) {
    case 'outcome':
      return fileUploadOutcomeMessage(failure.outcome, failure.reason) ?? { key: 'media:uploadOutcome.notSaved' };
    case 'unsupportedType':
      return { key: 'media:upload.unsupportedType' };
    case 'empty':
      return { key: 'media:upload.empty' };
    case 'tooLarge':
      return { key: 'media:upload.tooLarge', values: { size: formatFileSize(failure.maxBytes) } };
    case 'unreadable':
      return { key: 'media:mobileFiles.unreadable' };
    case 'refused':
      return fileErrorMessage(failure.error);
    case 'interrupted':
      return null;
  }
};
