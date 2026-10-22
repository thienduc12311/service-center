import { Directory, File, Paths } from 'expo-file-system';
import {
  OFFLINE_PACK_FORMAT,
  entryFileName,
  isEntryComplete,
  packFolderName,
  partFileName,
  type StoredOfflinePack,
  type StoredPackEntry,
} from './offline-packs';
import type { OfflinePackFiles } from './offline-pack-download';

/**
 * MOB-025: offline packs on this device. One folder per pack key (person ×
 * organization × plan) under the app's cache directory, holding `pack.json`
 * (the shared `OfflinePackRecord` + manifest, never URLs) and one file per
 * exact version. Cache storage is not backed up and the system may clear it
 * when the phone runs low; every read re-verifies sizes, so a cleared file
 * shows as missing instead of ready.
 */

const RECORD_FILE = 'pack.json';

const root = (): Directory => new Directory(Paths.cache, 'rehearsal-packs');
const folder = (key: string): Directory => new Directory(root(), packFolderName(key));
const finishedFile = (key: string, entry: StoredPackEntry): File => new File(folder(key), entryFileName(entry));
const partFile = (key: string, entry: StoredPackEntry): File => new File(folder(key), partFileName(entry));

const fileBytes = (file: File): number | null => (file.exists ? file.size : null);

type Listener = () => void;
const listeners = new Set<Listener>();

/** Re-render screens that show packs (download progress, removal, cleanup). */
export const subscribeOfflinePacks = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const notify = (): void => {
  for (const listener of listeners) listener();
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** Narrows `pack.json` from `unknown`; anything else is discarded. */
const parseStoredPack = (value: unknown, key: string): StoredOfflinePack | null => {
  if (!isRecord(value) || value.format !== OFFLINE_PACK_FORMAT) return null;
  const { record, manifest } = value;
  if (!isRecord(record) || record.key !== key || !Array.isArray(record.entries)) return null;
  if (typeof record.user_id !== 'string' || typeof record.organization_id !== 'string' || typeof record.recheck_by !== 'string') return null;
  if (!isRecord(manifest) || !Array.isArray(manifest.items) || !Array.isArray(manifest.plan_materials)) return null;
  const entriesValid = record.entries.every(
    (entry: unknown) =>
      isRecord(entry) &&
      typeof entry.file_id === 'string' &&
      typeof entry.version_id === 'string' &&
      typeof entry.filename === 'string' &&
      typeof entry.size_bytes === 'number' &&
      typeof entry.downloaded_bytes === 'number',
  );
  if (!entriesValid || !Array.isArray(value.excluded)) return null;
  // Shape checked field by field above; the stored JSON was written from this type.
  return value as unknown as StoredOfflinePack;
};

/** Re-measures each entry from the files actually present. */
const verifyAgainstFiles = (stored: StoredOfflinePack): StoredOfflinePack => {
  const key = stored.record.key;
  let changed = false;
  const entries = stored.record.entries.map((entry) => {
    const finished = fileBytes(finishedFile(key, entry));
    const downloaded =
      finished === entry.size_bytes ? entry.size_bytes : Math.min(fileBytes(partFile(key, entry)) ?? 0, Math.max(0, entry.size_bytes - 1));
    if (downloaded !== entry.downloaded_bytes) changed = true;
    return downloaded === entry.downloaded_bytes ? entry : { ...entry, downloaded_bytes: downloaded };
  });
  if (!changed) return stored;
  return {
    ...stored,
    record: { ...stored.record, entries },
    state: stored.state === 'complete' && !entries.every(isEntryComplete) ? 'incomplete' : stored.state,
  };
};

const readPack = async (key: string): Promise<StoredOfflinePack | null> => {
  const file = new File(folder(key), RECORD_FILE);
  if (!file.exists) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch (cause) {
    console.warn('[offline] discarding an unreadable pack record', cause instanceof Error ? cause.message : 'unknown');
    parsed = null;
  }
  const stored = parseStoredPack(parsed, key);
  if (!stored) {
    removeFolder(key);
    return null;
  }
  return verifyAgainstFiles(stored);
};

const removeFolder = (key: string): void => {
  const target = folder(key);
  if (target.exists) target.delete();
};

export const offlinePackFiles: OfflinePackFiles = {
  read: readPack,
  write: async (stored) => {
    const target = folder(stored.record.key);
    if (!target.exists) target.create({ intermediates: true });
    const file = new File(target, RECORD_FILE);
    if (!file.exists) file.create();
    file.write(JSON.stringify(stored));
    notify();
  },
  removePack: async (key) => {
    removeFolder(key);
    notify();
  },
  removeEntries: (key, entries) => {
    for (const entry of entries) {
      for (const file of [finishedFile(key, entry), partFile(key, entry)]) if (file.exists) file.delete();
    }
  },
  finishedBytes: (key, entry) => fileBytes(finishedFile(key, entry)),
  partBytes: (key, entry) => fileBytes(partFile(key, entry)) ?? 0,
  appendPart: (key, entry, bytes) => {
    const target = folder(key);
    if (!target.exists) target.create({ intermediates: true });
    const file = partFile(key, entry);
    if (!file.exists) file.create();
    file.write(bytes, { append: true });
  },
  resetPart: (key, entry) => {
    const file = partFile(key, entry);
    if (file.exists) file.delete();
  },
  finish: (key, entry) => {
    const part = partFile(key, entry);
    const finished = finishedFile(key, entry);
    if (finished.exists) finished.delete();
    part.moveSync(finished);
    return finishedFile(key, entry).size;
  },
  availableDiskBytes: () => Paths.availableDiskSpace,
};

/** The playable local file of a finished entry. */
export const offlineEntryUri = (key: string, entry: StoredPackEntry): string => finishedFile(key, entry).uri;

/** Every pack on this device (all accounts), verified against its files. */
export const listOfflinePacks = async (): Promise<StoredOfflinePack[]> => {
  const directory = root();
  if (!directory.exists) return [];
  const packs: StoredOfflinePack[] = [];
  for (const child of directory.list()) {
    if (!(child instanceof Directory)) continue;
    const file = new File(child, RECORD_FILE);
    if (!file.exists) {
      child.delete();
      continue;
    }
    let key: unknown = null;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      key = isRecord(parsed) && isRecord(parsed.record) ? parsed.record.key : null;
    } catch {
      key = null;
    }
    const stored = typeof key === 'string' && packFolderName(key) === child.name ? await readPack(key) : null;
    if (stored) packs.push(stored);
    else if (child.exists) child.delete();
  }
  return packs;
};

/** Deletes these packs (sign-out, account change, organization loss, "Remove"). */
export const removeOfflinePacks = async (keys: readonly string[]): Promise<void> => {
  for (const key of keys) removeFolder(key);
  if (keys.length) notify();
};

/** Bytes every pack folder holds, measured on disk. */
export const offlineBytesOnDevice = (): number => {
  const directory = root();
  return directory.exists ? (directory.size ?? 0) : 0;
};
