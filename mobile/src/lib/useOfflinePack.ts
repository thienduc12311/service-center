import { useCallback, useEffect, useRef, useState } from 'react';
import { offlinePackKeysToRemove } from '@service-center/shared';
import { fetch as expoFetch } from 'expo/fetch';
import type { RehearsalManifest, RehearsalMaterial, RehearsalTrack } from '@service-center/shared';
import { api } from './api';
import { downloadOfflinePack, type RangeAnswer } from './offline-pack-download';
import {
  OFFLINE_STORAGE_LIMIT_BYTES,
  isPackAccessLost,
  offlineEntryForTrack,
  offlinePackBudget,
  packBytesOnDevice,
  packKeyFor,
  recheckOfflinePack,
  summarizeOfflinePack,
  type OfflinePackSummary,
  type StoredOfflinePack,
} from './offline-packs';
import { listOfflinePacks, offlineEntryUri, offlinePackFiles, removeOfflinePacks, subscribeOfflinePacks } from './offline-pack-store';
import { useAuth } from '../providers/AuthProvider';

/** One request per range; a stalled connection gives up instead of hanging the download. */
const RANGE_TIMEOUT_MS = 60_000;

const fetchRange = async (url: string, start: number, end: number): Promise<RangeAnswer> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RANGE_TIMEOUT_MS);
  try {
    const response = await expoFetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal: controller.signal });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { status: response.status, contentRange: response.headers.get('content-range'), bytes };
  } finally {
    clearTimeout(timer);
  }
};

/** Downloads running in this app session, by pack key (one at a time per pack). */
interface RunningDownload {
  stop: boolean;
  /** The pack was removed (by the person or access loss): write nothing more. */
  removed: boolean;
}
const activeDownloads = new Map<string, RunningDownload>();
const activeListeners = new Set<() => void>();
const announceActive = (): void => {
  for (const listener of activeListeners) listener();
};

/** Something the screen should say once about the last action or recheck. */
export type OfflinePackNotice =
  | { kind: 'access_lost' }
  | { kind: 'removed'; revoked: number; stale: number }
  | { kind: 'no_space' }
  | { kind: 'request_failed' };

export interface OfflineStorageFacts {
  availableBytes: number;
  /** Every pack on this phone (only this account's remain after sign-in cleanup). */
  usedBytes: number;
  limitBytes: number;
}

export interface OfflinePackView {
  stored: StoredOfflinePack | null;
  summary: OfflinePackSummary;
  /** A download for this pack is running now. */
  active: boolean;
  newFileIds: string[];
  notice: OfflinePackNotice | null;
  storage: OfflineStorageFacts | null;
  download: () => void;
  pause: () => void;
  remove: () => Promise<void>;
  /** The verified local file for this track, or null (stream through a link instead). */
  localUri: (track: RehearsalTrack) => string | null;
  /** This exact material version would play from the device. */
  isSaved: (material: RehearsalMaterial) => boolean;
}

export interface UseOfflinePackInput {
  planId: string | undefined;
  /** The signed-in person and organization; null when unknown (nothing is read or written). */
  scope: { userId: string; organizationId: string } | null;
  /** False while the identity is not confirmed online (cold start offline): no download/recheck. */
  online: boolean;
  /** True while the identity that started a download is still the current one. */
  isCurrent: () => boolean;
  /** The fresh manifest, when the last read succeeded. */
  manifest: RehearsalManifest | undefined;
  manifestUpdatedAt: number;
  manifestError: unknown;
}

/** A pack recorded as downloading by a session that is gone (app closed): it is incomplete. */
export const settled = (stored: StoredOfflinePack | null, key: string): StoredOfflinePack | null =>
  stored && stored.state === 'downloading' && !activeDownloads.has(key) ? { ...stored, state: 'incomplete', stopped: null } : stored;

/**
 * MOB-025: an explicit offline pack for one plan, for the signed-in person
 * and organization. Nothing downloads until the person asks; a fresh manifest
 * rechecks rights and versions and removes what is no longer allowed; a
 * manifest 403/404 deletes the whole pack. Only a complete pack inside its
 * recheck window gives the player local files.
 */
export const useOfflinePack = ({
  planId,
  scope,
  online,
  isCurrent,
  manifest,
  manifestUpdatedAt,
  manifestError,
}: UseOfflinePackInput): OfflinePackView => {
  const key = scope && planId ? packKeyFor(scope, planId) : null;
  const [stored, setStored] = useState<StoredOfflinePack | null>(null);
  const [active, setActive] = useState(false);
  const [newFileIds, setNewFileIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<OfflinePackNotice | null>(null);
  const [storage, setStorage] = useState<OfflineStorageFacts | null>(null);
  const readId = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++readId.current;
    const [current, all] = key ? await Promise.all([offlinePackFiles.read(key), listOfflinePacks()]) : [null, await listOfflinePacks()];
    if (id !== readId.current) return;
    setStored(key ? settled(current, key) : null);
    setActive(key ? activeDownloads.has(key) : false);
    setStorage({
      availableBytes: offlinePackFiles.availableDiskBytes(),
      usedBytes: all.reduce((sum, pack) => sum + packBytesOnDevice(pack.record), 0),
      limitBytes: OFFLINE_STORAGE_LIMIT_BYTES,
    });
  }, [key]);

  useEffect(() => {
    setNewFileIds([]);
    setNotice(null);
    void refresh();
    const unsubscribe = subscribeOfflinePacks(() => void refresh());
    const onActive = () => void refresh();
    activeListeners.add(onActive);
    return () => {
      readId.current += 1;
      unsubscribe();
      activeListeners.delete(onActive);
    };
  }, [refresh]);

  // A fresh manifest rechecks rights and versions (not while this pack downloads).
  useEffect(() => {
    if (!key || !online || !manifest || manifest.plan_id !== planId || activeDownloads.has(key)) return;
    let cancelled = false;
    void (async () => {
      const current = settled(await offlinePackFiles.read(key), key);
      if (cancelled || !current || !isCurrent() || activeDownloads.has(key)) return;
      const result = recheckOfflinePack(current, manifest);
      offlinePackFiles.removeEntries(key, result.remove);
      await offlinePackFiles.write(result.stored);
      if (cancelled) return;
      setNewFileIds(result.newFileIds);
      if (result.removed.revoked || result.removed.stale) setNotice({ kind: 'removed', ...result.removed });
    })();
    return () => {
      cancelled = true;
    };
    // Re-run on every successful manifest read, keyed by its update time.
  }, [key, online, manifestUpdatedAt, planId, isCurrent]);

  // The plan is no longer readable: nothing of it stays on the device.
  useEffect(() => {
    if (!key || !isPackAccessLost(manifestError)) return;
    const running = activeDownloads.get(key);
    if (running) Object.assign(running, { stop: true, removed: true });
    void offlinePackFiles.read(key).then(async (current) => {
      if (!current) return;
      await offlinePackFiles.removePack(key);
      setNotice({ kind: 'access_lost' });
    });
  }, [key, manifestError]);

  const download = useCallback(() => {
    if (!key || !scope || !planId || !online || activeDownloads.has(key)) return;
    const run: RunningDownload = { stop: false, removed: false };
    activeDownloads.set(key, run);
    announceActive();
    setNotice(null);
    void (async () => {
      try {
        const all = await listOfflinePacks();
        const thisPack = all.find((pack) => pack.record.key === key);
        const maxBytes = offlinePackBudget({
          availableDiskBytes: offlinePackFiles.availableDiskBytes(),
          otherPacksBytes: all.filter((pack) => pack.record.key !== key).reduce((sum, pack) => sum + packBytesOnDevice(pack.record), 0),
          thisPackBytes: thisPack ? packBytesOnDevice(thisPack.record) : 0,
        });
        if (maxBytes === null) {
          setNotice({ kind: 'no_space' });
          return;
        }
        const outcome = await downloadOfflinePack(
          { planId, scope, key, maxBytes },
          {
            files: offlinePackFiles,
            requestPack: (id, max) => api.rehearsalOfflinePack(id, { max_bytes: max }),
            renewLink: async (entry) => {
              const link = await api.fileDownload(entry.file_id, { version_id: entry.version_id, disposition: 'attachment' });
              return { url: link.url, expiresAt: link.expires_at ? new Date(link.expires_at).getTime() : Number.POSITIVE_INFINITY };
            },
            fetchRange,
            isCurrent: () => isCurrent() && !run.removed,
            shouldStop: () => run.stop,
            onChange: () => undefined,
          },
        );
        if (outcome.result === 'access_lost') setNotice({ kind: 'access_lost' });
        else if (outcome.result === 'stopped' && !outcome.stored) setNotice({ kind: 'request_failed' });
        else if (outcome.result === 'complete') setNewFileIds([]);
      } catch (cause) {
        // Unexpected (not a stop the downloader reports itself): the record stays incomplete.
        console.warn('[offline] download failed', cause instanceof Error ? cause.message : 'unknown');
        setNotice({ kind: 'request_failed' });
      } finally {
        if (run.removed) await offlinePackFiles.removePack(key);
        activeDownloads.delete(key);
        announceActive();
      }
    })();
  }, [key, scope, planId, online, isCurrent]);

  const pause = useCallback(() => {
    const running = key ? activeDownloads.get(key) : undefined;
    if (running) running.stop = true;
  }, [key]);

  const remove = useCallback(async () => {
    if (!key) return;
    const running = activeDownloads.get(key);
    if (running) Object.assign(running, { stop: true, removed: true });
    await offlinePackFiles.removePack(key);
    setNewFileIds([]);
  }, [key]);

  const localUri = useCallback(
    (track: RehearsalTrack): string | null => {
      if (!key) return null;
      const entry = offlineEntryForTrack(stored, track);
      return entry ? offlineEntryUri(key, entry) : null;
    },
    [key, stored],
  );

  const isSaved = useCallback((material: RehearsalMaterial): boolean => offlineEntryForTrack(stored, { material }) !== null, [stored]);

  return {
    stored,
    summary: summarizeOfflinePack(stored, { newFileIds }),
    active,
    newFileIds,
    notice,
    storage,
    download,
    pause,
    remove,
    localUri,
    isSaved,
  };
};

/** Stops any running download of these packs and deletes them. */
export const deleteOfflinePacks = async (keys: readonly string[]): Promise<void> => {
  for (const key of keys) {
    const running = activeDownloads.get(key);
    if (running) Object.assign(running, { stop: true, removed: true });
  }
  await removeOfflinePacks(keys);
};

/**
 * Account isolation: signing out deletes every pack; a confirmed identity
 * keeps only its own packs in organizations it still belongs to (another
 * account's packs, or a removed membership's, are deleted). An identity that
 * could not be confirmed (offline start) changes nothing.
 */
export const useOfflinePackCleanup = (): void => {
  const { session, user, loading, ready } = useAuth();
  const userId = session?.user.id ?? null;
  const organizationIds = user?.memberships.map(({ organization }) => organization.id).join(',') ?? null;
  useEffect(() => {
    if (loading || !ready) return;
    if (userId && organizationIds === null) return;
    let cancelled = false;
    void (async () => {
      const packs = await listOfflinePacks();
      if (cancelled) return;
      const keys = offlinePackKeysToRemove(
        packs.map((pack) => pack.record),
        { userId, organizationIds: userId && organizationIds ? organizationIds.split(',') : [] },
      );
      await deleteOfflinePacks(keys);
    })().catch((cause: unknown) => {
      console.warn('[offline] could not clean up offline packs', cause instanceof Error ? cause.message : 'unknown');
    });
    return () => {
      cancelled = true;
    };
  }, [loading, ready, userId, organizationIds]);
};
