import type { OfflinePackPlan } from '@service-center/shared';
import {
  OFFLINE_CHUNK_BYTES,
  OFFLINE_FREE_SPACE_RESERVE_BYTES,
  acceptChunk,
  contentRangeStart,
  isEntryRevoked,
  isPackAccessLost,
  linkNeedsRenewal,
  mergeOfflinePack,
  nextChunkRange,
  withEntryProgress,
  withoutEntry,
  type OfflineDownloadStop,
  type StoredOfflinePack,
  type StoredPackEntry,
} from './offline-packs';

/**
 * MOB-025: one explicit, resumable download of a plan's offline pack. The
 * device asks `rehearsalOfflinePack` for the exact versions it may keep, then
 * fetches each file in byte ranges into a partial file, so an interrupted
 * download (closed app, lost connection, full storage, pause) resumes where
 * it stopped. Links are renewed through `fileDownload` (access rechecked;
 * 403/404 drops that file). A file counts only when its size matches exactly;
 * the pack is `complete` only when every file does. File and network access
 * are injected, so this runs in tests without a device.
 */

/** The pack's files on this device (see `offline-pack-store.ts`). */
export interface OfflinePackFiles {
  read: (key: string) => Promise<StoredOfflinePack | null>;
  write: (stored: StoredOfflinePack) => Promise<void>;
  /** Deletes the pack folder: record and every file. */
  removePack: (key: string) => Promise<void>;
  /** Deletes these entries' partial and finished files. */
  removeEntries: (key: string, entries: readonly StoredPackEntry[]) => void;
  /** Size of the finished file, or null when there is none. */
  finishedBytes: (key: string, entry: StoredPackEntry) => number | null;
  /** Size of the partial file (0 when there is none). */
  partBytes: (key: string, entry: StoredPackEntry) => number;
  appendPart: (key: string, entry: StoredPackEntry, bytes: Uint8Array) => void;
  resetPart: (key: string, entry: StoredPackEntry) => void;
  /** Turns the partial file into the finished one; returns its size. */
  finish: (key: string, entry: StoredPackEntry) => number;
  availableDiskBytes: () => number;
}

export interface RangeAnswer {
  status: number;
  contentRange: string | null;
  bytes: Uint8Array;
}

export interface OfflineDownloadDependencies {
  files: OfflinePackFiles;
  requestPack: (planId: string, maxBytes: number) => Promise<OfflinePackPlan>;
  /** A fresh attachment link for one exact version (`fileDownload`). */
  renewLink: (entry: StoredPackEntry) => Promise<{ url: string; expiresAt: number }>;
  fetchRange: (url: string, start: number, end: number) => Promise<RangeAnswer>;
  /** False once the account, organization or session changed: stop without writing. */
  isCurrent: () => boolean;
  /** True once the person paused. */
  shouldStop: () => boolean;
  onChange: (stored: StoredOfflinePack) => void;
  now?: () => number;
  /** Bytes per range request (defaults to `OFFLINE_CHUNK_BYTES`). */
  chunkBytes?: number;
}

export interface OfflineDownloadRequest {
  planId: string;
  scope: { userId: string; organizationId: string };
  key: string;
  maxBytes: number;
}

export type OfflineDownloadOutcome =
  | { result: 'complete'; stored: StoredOfflinePack }
  | { result: 'stopped'; reason: OfflineDownloadStop; stored: StoredOfflinePack | null }
  /** The plan is no longer readable: the whole pack was deleted. */
  | { result: 'access_lost' }
  /** Another account/organization took over: nothing more was written. */
  | { result: 'abandoned' };

interface Link {
  url: string;
  expiresAt: number;
}

class StopDownload extends Error {
  constructor(readonly reason: OfflineDownloadStop | 'abandoned') {
    super(reason);
  }
}

export const downloadOfflinePack = async (
  request: OfflineDownloadRequest,
  deps: OfflineDownloadDependencies,
): Promise<OfflineDownloadOutcome> => {
  const { files } = deps;
  const now = deps.now ?? Date.now;
  const chunk = deps.chunkBytes ?? OFFLINE_CHUNK_BYTES;
  const previous = await files.read(request.key);

  let pack: OfflinePackPlan;
  try {
    pack = await deps.requestPack(request.planId, request.maxBytes);
  } catch (cause) {
    if (!deps.isCurrent()) return { result: 'abandoned' };
    if (isPackAccessLost(cause)) {
      await files.removePack(request.key);
      return { result: 'access_lost' };
    }
    return { result: 'stopped', reason: 'connection', stored: previous };
  }
  if (!deps.isCurrent()) return { result: 'abandoned' };

  const merged = mergeOfflinePack(previous, pack, request.scope);
  files.removeEntries(request.key, merged.remove);
  let stored: StoredOfflinePack = { ...merged.stored, state: 'downloading' };
  const links = new Map<string, Link>(
    pack.entries.map((entry) => [entry.version_id, { url: entry.url, expiresAt: new Date(entry.url_expires_at).getTime() }]),
  );

  const save = async (next: StoredOfflinePack): Promise<void> => {
    if (!deps.isCurrent()) throw new StopDownload('abandoned');
    stored = next;
    await files.write(stored);
    deps.onChange(stored);
  };

  /** A link for this entry, or null when the server no longer allows it. */
  const linkFor = async (entry: StoredPackEntry, force: boolean): Promise<Link | null> => {
    const held = links.get(entry.version_id);
    if (held && !force && !linkNeedsRenewal(held.expiresAt, now())) return held;
    if (!deps.isCurrent()) throw new StopDownload('abandoned');
    try {
      const renewed = await deps.renewLink(entry);
      links.set(entry.version_id, renewed);
      return renewed;
    } catch (cause) {
      if (isEntryRevoked(cause)) return null;
      throw new StopDownload('connection');
    }
  };

  /** Downloads one entry to completion; false when it was dropped (revoked). */
  const downloadEntry = async (entry: StoredPackEntry): Promise<boolean> => {
    let offset = files.partBytes(request.key, entry);
    if (offset > entry.size_bytes) {
      files.resetPart(request.key, entry);
      offset = 0;
    }
    let restarts = 0;
    let retriedChunk = false;
    for (let range = nextChunkRange(offset, entry.size_bytes, chunk); range; range = nextChunkRange(offset, entry.size_bytes, chunk)) {
      if (deps.shouldStop()) throw new StopDownload('paused');
      const length = range.end - range.start + 1;
      if (files.availableDiskBytes() - length < OFFLINE_FREE_SPACE_RESERVE_BYTES) throw new StopDownload('storage_full');
      const link = await linkFor(entry, retriedChunk);
      if (!link) return false;
      let answer: RangeAnswer;
      try {
        answer = await deps.fetchRange(link.url, range.start, range.end);
      } catch {
        if (retriedChunk) throw new StopDownload('connection');
        retriedChunk = true;
        continue;
      }
      if (answer.status < 200 || answer.status >= 300) {
        // An expired or refused link: ask once more (access is rechecked then).
        if (retriedChunk) throw new StopDownload('server');
        retriedChunk = true;
        continue;
      }
      if (!deps.isCurrent()) throw new StopDownload('abandoned');
      retriedChunk = false;
      const verdict = acceptChunk({
        status: answer.status,
        start: range.start,
        end: range.end,
        size: entry.size_bytes,
        contentRangeStart: contentRangeStart(answer.contentRange),
        receivedBytes: answer.bytes.byteLength,
      });
      if (verdict === 'restart') {
        files.resetPart(request.key, entry);
        offset = 0;
        restarts += 1;
        if (restarts > 1) throw new StopDownload('server');
        await save(withEntryProgress(stored, entry.version_id, 0));
        continue;
      }
      if (verdict === 'whole') files.resetPart(request.key, entry);
      files.appendPart(request.key, entry, answer.bytes);
      offset = files.partBytes(request.key, entry);
      // Hold back the last byte until the file is finished and its size verified.
      await save(withEntryProgress(stored, entry.version_id, Math.min(offset, entry.size_bytes - 1)));
    }
    const finished = files.finish(request.key, entry);
    if (finished !== entry.size_bytes) {
      files.removeEntries(request.key, [entry]);
      await save(withEntryProgress(stored, entry.version_id, 0));
      throw new StopDownload('server');
    }
    await save(withEntryProgress(stored, entry.version_id, finished));
    return true;
  };

  try {
    await save(stored);
    for (const entry of [...stored.record.entries]) {
      if (files.finishedBytes(request.key, entry) === entry.size_bytes) {
        if (entry.downloaded_bytes !== entry.size_bytes) await save(withEntryProgress(stored, entry.version_id, entry.size_bytes));
        continue;
      }
      const kept = await downloadEntry(entry);
      if (!kept) {
        files.removeEntries(request.key, [entry]);
        await save(withoutEntry(stored, entry.version_id));
      }
    }
    await save({ ...stored, state: 'complete', stopped: null });
    return { result: 'complete', stored };
  } catch (cause) {
    if (!deps.isCurrent() || (cause instanceof StopDownload && cause.reason === 'abandoned')) return { result: 'abandoned' };
    // Anything else (a file that could not be written) stops the download as incomplete, never as ready.
    const reason: OfflineDownloadStop = cause instanceof StopDownload && cause.reason !== 'abandoned' ? cause.reason : 'device';
    if (!(cause instanceof StopDownload)) {
      console.warn('[offline] a pack file could not be saved', cause instanceof Error ? cause.message : 'unknown');
    }
    stored = { ...stored, state: 'incomplete', stopped: reason };
    await files.write(stored);
    deps.onChange(stored);
    return { result: 'stopped', reason, stored };
  }
};
