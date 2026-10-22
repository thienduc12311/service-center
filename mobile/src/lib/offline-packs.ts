import {
  ApiError,
  OFFLINE_PACK_DEFAULT_MAX_BYTES,
  OFFLINE_PACK_MAX_BYTES,
  OFFLINE_PACK_RECHECK_SECONDS,
  offlinePackKey,
  offlinePackStatus,
  selectOfflinePack,
  type OfflineEntryStatus,
  type OfflinePackEntry,
  type OfflinePackExclusion,
  type OfflinePackPlan,
  type OfflinePackRecord,
  type RehearsalManifest,
  type RehearsalTrack,
} from '@service-center/shared';

/**
 * MOB-025: the native rules for explicit offline rehearsal packs, on top of
 * the F14 contract (`rehearsalOfflinePack`, `offlinePackKey`,
 * `offlinePackStatus`). Pure, so it is tested without the file system. The
 * device stores the shared `OfflinePackRecord` plus the manifest the pack was
 * built from — never a signed URL.
 */

/** Everything offline packs may use on one device, all accounts together. */
export const OFFLINE_STORAGE_LIMIT_BYTES = OFFLINE_PACK_MAX_BYTES;
/** Free space a download always leaves for the rest of the phone. */
export const OFFLINE_FREE_SPACE_RESERVE_BYTES = 512 * 1024 * 1024;
/** Bytes asked for per range request (resume point granularity). */
export const OFFLINE_CHUNK_BYTES = 4 * 1024 * 1024;
/** Renew a download link this long before it expires. */
export const OFFLINE_LINK_RENEW_MARGIN_MS = 30_000;
/** Bump when `StoredOfflinePack` changes shape; older records are discarded. */
export const OFFLINE_PACK_FORMAT = 1;

/** Where a pack's download stands on this device. */
export type OfflineDownloadState =
  /** A download is running in this app session. */
  | 'downloading'
  /** Stopped before every file was complete (paused, closed, lost connection, storage full). */
  | 'incomplete'
  /** Every file was downloaded and its size matched exactly. */
  | 'complete';

/** Why the last download stopped early, as a catalog key suffix. */
export type OfflineDownloadStop = 'paused' | 'connection' | 'storage_full' | 'server' | 'device';

/** What the device keeps for one pack (file `pack.json`). */
export interface StoredOfflinePack {
  format: typeof OFFLINE_PACK_FORMAT;
  record: OfflinePackRecord;
  /** The manifest the pack was built from or last rechecked against: order and charts offline. */
  manifest: RehearsalManifest;
  excluded: OfflinePackExclusion[];
  max_bytes: number;
  state: OfflineDownloadState;
  stopped: OfflineDownloadStop | null;
  /** When rights and versions were last confirmed by a fresh manifest (server time). */
  checked_at: string;
}

/** The pack key for the signed-in person, organization and plan. */
export const packKeyFor = (scope: { userId: string; organizationId: string }, planId: string): string =>
  offlinePackKey(scope.userId, scope.organizationId, planId);

/** A file-system-safe folder name for a pack key (ids are uuids). */
export const packFolderName = (key: string): string => key.replace(/[^A-Za-z0-9-]/g, '_');

/**
 * The local file for one exact version. The extension is kept so the
 * platform player recognises the type of a local file.
 */
export const entryFileName = (entry: Pick<OfflinePackEntry, 'version_id' | 'filename'>): string => {
  const extension = /\.([A-Za-z0-9]{1,5})$/.exec(entry.filename)?.[1]?.toLowerCase();
  const base = entry.version_id.replace(/[^A-Za-z0-9-]/g, '_');
  return extension ? `${base}.${extension}` : base;
};

export const partFileName = (entry: Pick<OfflinePackEntry, 'version_id' | 'filename'>): string =>
  `${entryFileName(entry)}.part`;

export type StoredPackEntry = OfflinePackRecord['entries'][number];

export const isEntryComplete = (entry: StoredPackEntry): boolean => entry.downloaded_bytes === entry.size_bytes;

/** Bytes the device holds for a pack (finished and partial files). */
export const packBytesOnDevice = (record: Pick<OfflinePackRecord, 'entries'>): number =>
  record.entries.reduce((sum, entry) => sum + Math.min(entry.downloaded_bytes, entry.size_bytes), 0);

export const packTotalBytes = (record: Pick<OfflinePackRecord, 'entries'>): number =>
  record.entries.reduce((sum, entry) => sum + entry.size_bytes, 0);

export interface OfflineBudgetInput {
  /** `Paths.availableDiskSpace`. */
  availableDiskBytes: number;
  /** What every other pack on this device already uses. */
  otherPacksBytes: number;
  /** What this plan's existing pack already holds (kept and reused). */
  thisPackBytes: number;
}

/**
 * The `max_bytes` to ask the server for: the F14 default pack size, inside
 * the device-wide offline limit, leaving the reserve free. Null when not even
 * one byte fits — the download is refused before anything is written.
 */
export const offlinePackBudget = ({ availableDiskBytes, otherPacksBytes, thisPackBytes }: OfflineBudgetInput): number | null => {
  const freeForPacks = availableDiskBytes - OFFLINE_FREE_SPACE_RESERVE_BYTES + thisPackBytes;
  const underLimit = OFFLINE_STORAGE_LIMIT_BYTES - otherPacksBytes;
  const budget = Math.floor(Math.min(OFFLINE_PACK_DEFAULT_MAX_BYTES, freeForPacks, underLimit));
  return budget >= 1 ? budget : null;
};

/** What a download of this manifest would hold with this budget (the server decides the final list). */
export const offlinePackEstimate = (manifest: Pick<RehearsalManifest, 'items' | 'plan_materials'>, budget: number) =>
  selectOfflinePack(manifest, budget);

/**
 * The record for a new or renewed pack. Entries of the same exact version
 * keep what was already downloaded (resume); anything else held before is
 * returned for deletion. The URLs in `pack` are never stored.
 */
export const mergeOfflinePack = (
  previous: StoredOfflinePack | null,
  pack: OfflinePackPlan,
  scope: { userId: string; organizationId: string },
): { stored: StoredOfflinePack; remove: StoredPackEntry[] } => {
  const held = new Map((previous?.record.entries ?? []).map((entry) => [entry.version_id, entry]));
  const entries: StoredPackEntry[] = pack.entries.map(({ url: _url, url_expires_at: _expires, ...entry }) => {
    const kept = held.get(entry.version_id);
    const downloaded = kept && kept.size_bytes === entry.size_bytes ? Math.min(kept.downloaded_bytes, entry.size_bytes) : 0;
    return { ...entry, downloaded_bytes: downloaded };
  });
  const keep = new Set(entries.map((entry) => entry.version_id));
  return {
    stored: {
      format: OFFLINE_PACK_FORMAT,
      record: {
        key: packKeyFor(scope, pack.plan_id),
        user_id: scope.userId,
        organization_id: scope.organizationId,
        plan_id: pack.plan_id,
        plan_revision: pack.plan_revision,
        created_at: pack.created_at,
        recheck_by: pack.recheck_by,
        entries,
      },
      manifest: pack.manifest,
      excluded: pack.excluded,
      max_bytes: pack.max_bytes,
      state: entries.every(isEntryComplete) ? 'complete' : 'incomplete',
      stopped: null,
      checked_at: pack.manifest.generated_at,
    },
    remove: (previous?.record.entries ?? []).filter((entry) => !keep.has(entry.version_id)),
  };
};

/** Records a file's progress (and the pack's state when it is the last one). */
export const withEntryProgress = (stored: StoredOfflinePack, versionId: string, downloadedBytes: number): StoredOfflinePack => {
  const entries = stored.record.entries.map((entry) =>
    entry.version_id === versionId ? { ...entry, downloaded_bytes: Math.min(downloadedBytes, entry.size_bytes) } : entry,
  );
  return { ...stored, record: { ...stored.record, entries } };
};

/** Drops a file the server no longer allows (revoked mid-download), listing it as excluded. */
export const withoutEntry = (stored: StoredOfflinePack, versionId: string): StoredOfflinePack => {
  const gone = stored.record.entries.find((entry) => entry.version_id === versionId);
  if (!gone) return stored;
  return {
    ...stored,
    record: { ...stored.record, entries: stored.record.entries.filter((entry) => entry.version_id !== versionId) },
    excluded: [...stored.excluded, { item_id: gone.item_id, file_id: gone.file_id, title: gone.filename, reason: 'unavailable' }],
  };
};

/** The byte range to ask for next, or null when the file is complete. */
export const nextChunkRange = (downloaded: number, size: number, chunk: number = OFFLINE_CHUNK_BYTES): { start: number; end: number } | null =>
  downloaded >= size ? null : { start: downloaded, end: Math.min(size, downloaded + chunk) - 1 };

/**
 * How to treat one range answer. A 206 must start exactly where asked and
 * carry exactly the asked length; a 200 is the whole file and is accepted only
 * when nothing was held yet and its length is the exact size. Anything else
 * discards the partial file (a changed object is never stitched together).
 */
export const acceptChunk = (input: {
  status: number;
  start: number;
  end: number;
  size: number;
  contentRangeStart: number | null;
  receivedBytes: number;
}): 'append' | 'whole' | 'restart' => {
  if (input.status === 206 && input.contentRangeStart === input.start && input.receivedBytes === input.end - input.start + 1) {
    return 'append';
  }
  if (input.status === 200 && input.start === 0 && input.receivedBytes === input.size) return 'whole';
  return 'restart';
};

/** `Content-Range: bytes 0-99/1234` → 0. */
export const contentRangeStart = (header: string | null): number | null => {
  const match = header ? /^bytes (\d+)-\d+\/(?:\d+|\*)$/.exec(header.trim()) : null;
  return match ? Number(match[1]) : null;
};

export const linkNeedsRenewal = (expiresAt: number, now: number = Date.now()): boolean =>
  now > expiresAt - OFFLINE_LINK_RENEW_MARGIN_MS;

/** A link request answered "not yours any more" (revoked, archived, stream-only now). */
export const isEntryRevoked = (cause: unknown): boolean =>
  cause instanceof ApiError && (cause.status === 403 || cause.status === 404);

/** The pack's whole plan is gone for this person (manifest 403/404): delete every file. */
export const isPackAccessLost = (cause: unknown): boolean =>
  cause instanceof ApiError && (cause.status === 403 || cause.status === 404);

/** Rights have not been confirmed by a fresh manifest within the F14 recheck window. */
export const isPackExpired = (stored: Pick<StoredOfflinePack, 'record'>, now: Date = new Date()): boolean =>
  now.getTime() >= new Date(stored.record.recheck_by).getTime();

/**
 * Rechecks a stored pack against a fresh manifest (online). Revoked entries
 * (no longer readable, archived, stream-only, merged away) and stale ones (the
 * plan now uses another version) are removed — only the exact version the
 * plan uses may play offline. A fresh manifest renews the recheck window from
 * the server's clock, and becomes the pack's order and charts.
 */
export const recheckOfflinePack = (
  stored: StoredOfflinePack,
  manifest: RehearsalManifest,
): { stored: StoredOfflinePack; remove: StoredPackEntry[]; newFileIds: string[]; removed: Record<'revoked' | 'stale', number> } => {
  const status = offlinePackStatus(stored.record, manifest);
  const byVersion = new Map<string, OfflineEntryStatus>(status.entries.map((entry) => [entry.version_id, entry.status]));
  const remove = stored.record.entries.filter((entry) => {
    const entryStatus = byVersion.get(entry.version_id);
    return entryStatus === 'revoked' || entryStatus === 'stale';
  });
  const removedVersions = new Set(remove.map((entry) => entry.version_id));
  const entries = stored.record.entries.filter((entry) => !removedVersions.has(entry.version_id));
  const generated = new Date(manifest.generated_at).getTime();
  return {
    stored: {
      ...stored,
      manifest,
      checked_at: manifest.generated_at,
      record: {
        ...stored.record,
        plan_revision: manifest.plan_revision,
        recheck_by: new Date(generated + OFFLINE_PACK_RECHECK_SECONDS * 1000).toISOString(),
        entries,
      },
      state: stored.state === 'downloading' ? 'downloading' : entries.every(isEntryComplete) ? 'complete' : 'incomplete',
    },
    remove,
    // A replaced version is offered again as a file the pack lacks.
    newFileIds: [
      ...status.new_file_ids,
      ...remove.filter((entry) => byVersion.get(entry.version_id) === 'stale').map((entry) => entry.file_id),
    ],
    removed: {
      revoked: remove.filter((entry) => byVersion.get(entry.version_id) === 'revoked').length,
      stale: remove.filter((entry) => byVersion.get(entry.version_id) === 'stale').length,
    },
  };
};

/** What the screen says about a pack. */
export type OfflinePackPhase =
  | 'none'
  | 'downloading'
  /** Not every file is complete: nothing is presented as available offline. */
  | 'incomplete'
  | 'ready'
  /** Complete, but the plan now has files the pack lacks (or changed versions were removed). */
  | 'update_available'
  /** Rights were not rechecked in time: nothing plays until a fresh manifest is read. */
  | 'expired';

export interface OfflinePackSummary {
  phase: OfflinePackPhase;
  files: number;
  completeFiles: number;
  totalBytes: number;
  downloadedBytes: number;
}

export const summarizeOfflinePack = (
  stored: StoredOfflinePack | null,
  options: { newFileIds: readonly string[]; now?: Date },
): OfflinePackSummary => {
  if (!stored) return { phase: 'none', files: 0, completeFiles: 0, totalBytes: 0, downloadedBytes: 0 };
  const completeFiles = stored.record.entries.filter(isEntryComplete).length;
  const summary = {
    files: stored.record.entries.length,
    completeFiles,
    totalBytes: packTotalBytes(stored.record),
    downloadedBytes: packBytesOnDevice(stored.record),
  };
  let phase: OfflinePackPhase;
  if (stored.state === 'downloading') phase = 'downloading';
  else if (isPackExpired(stored, options.now)) phase = 'expired';
  else if (stored.state !== 'complete' || completeFiles < summary.files) phase = 'incomplete';
  else if (options.newFileIds.length) phase = 'update_available';
  else phase = 'ready';
  return { phase, ...summary };
};

/**
 * The verified local file for a track, or null (then the player asks the API
 * for a link as before). Only a complete pack within its recheck window plays
 * offline, and only the exact version the track names.
 */
export const offlineEntryForTrack = (
  stored: StoredOfflinePack | null,
  track: Pick<RehearsalTrack, 'material'>,
  now: Date = new Date(),
): StoredPackEntry | null => {
  if (!stored || stored.state !== 'complete' || isPackExpired(stored, now)) return null;
  const entry = stored.record.entries.find(
    (candidate) => candidate.file_id === track.material.file_id && candidate.version_id === track.material.version_id,
  );
  return entry && isEntryComplete(entry) ? entry : null;
};
