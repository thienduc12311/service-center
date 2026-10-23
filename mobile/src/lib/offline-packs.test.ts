import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  OFFLINE_PACK_DEFAULT_MAX_BYTES,
  offlinePackKeysToRemove,
  offlinePackRequestSchema,
  selectRehearsalTrack,
  type OfflinePackDownload,
  type OfflinePackPlan,
  type RehearsalManifest,
  type RehearsalManifestItem,
  type RehearsalMaterial,
} from '@service-center/shared';
import {
  OFFLINE_CHUNK_BYTES,
  OFFLINE_FREE_SPACE_RESERVE_BYTES,
  OFFLINE_STORAGE_LIMIT_BYTES,
  acceptChunk,
  contentRangeStart,
  entryFileName,
  isPackExpired,
  mergeOfflinePack,
  nextChunkRange,
  offlineEntryForTrack,
  offlinePackBudget,
  packFolderName,
  packKeyFor,
  recheckOfflinePack,
  summarizeOfflinePack,
  type StoredOfflinePack,
} from './offline-packs';
import { downloadOfflinePack, type OfflineDownloadDependencies, type OfflinePackFiles } from './offline-pack-download';

const MB = 1024 * 1024;
/** The fixtures' own clock (inside the pack's 24 h window), so results never depend on today's date. */
const PACK_CLOCK = new Date('2026-10-22T10:01:00.000Z');
const SCOPE = { userId: 'user-1', organizationId: 'org-1' };
const KEY = packKeyFor(SCOPE, 'plan');

const material = (fileId: string, overrides: Partial<RehearsalMaterial> = {}): RehearsalMaterial => ({
  file_id: fileId,
  version_id: `${fileId}-v1`,
  version_number: 1,
  title: fileId,
  filename: `${fileId}.m4a`,
  kind: 'upload',
  category: 'audio',
  mime_type: 'audio/mp4',
  size_bytes: 10,
  source: 'item',
  external_url: null,
  playback: 'audio',
  rights: { stream: true, download: true, offline: true },
  playback_rights: 'download',
  pinned: false,
  newer_version_available: false,
  ...overrides,
});

const item = (id: string, materials: RehearsalMaterial[]): RehearsalManifestItem => ({
  item_id: id,
  position: 0,
  item_type: 'song',
  title: id,
  length_seconds: 240,
  service_segment: 'service',
  song: { id: `${id}-song`, title: id, author: null },
  arrangement: null,
  tempo_bpm: null,
  chart: null,
  media: null,
  materials,
  track_file_id: selectRehearsalTrack(materials)?.file_id ?? null,
});

const manifest = (materials: RehearsalMaterial[], generatedAt = '2026-10-22T10:00:00.000Z'): RehearsalManifest => ({
  plan_id: 'plan',
  plan_title: 'Sunday',
  service_date: '2026-10-25',
  plan_revision: 3,
  generated_at: generatedAt,
  expires_at: '2026-10-22T10:10:00.000Z',
  items: materials.map((entry, index) => item(`item-${index}`, [entry])),
  plan_materials: [],
  truncated: false,
});

/** What `POST /plans/:id/rehearsal-manifest/offline-pack` answers for a manifest (the server's own selection). */
const packFor = (source: RehearsalManifest, createdAt = '2026-10-22T10:00:00.000Z'): OfflinePackPlan => {
  const entries: OfflinePackDownload[] = [];
  for (const entry of source.items) {
    for (const m of entry.materials) {
      if (m.kind !== 'upload' || !m.rights.offline || !m.version_id || m.size_bytes === null) continue;
      entries.push({
        item_id: entry.item_id,
        file_id: m.file_id,
        version_id: m.version_id,
        version_number: m.version_number,
        filename: m.filename ?? m.title,
        mime_type: m.mime_type ?? 'application/octet-stream',
        size_bytes: m.size_bytes,
        url: `https://storage.test/${m.version_id}?token=signed`,
        url_expires_at: '2026-10-22T10:05:00.000Z',
      });
    }
  }
  return {
    plan_id: source.plan_id,
    plan_revision: source.plan_revision,
    created_at: createdAt,
    recheck_by: '2026-10-23T10:00:00.000Z',
    total_bytes: entries.reduce((sum, entry) => sum + entry.size_bytes, 0),
    max_bytes: OFFLINE_PACK_DEFAULT_MAX_BYTES,
    entries,
    excluded: [],
    manifest: source,
  };
};

/** In-memory device: a record per key, finished and partial byte arrays per version. */
const memoryFiles = (diskBytes = 10 * 1024 * MB) => {
  const records = new Map<string, string>();
  const parts = new Map<string, number[]>();
  const finished = new Map<string, number[]>();
  const id = (key: string, version: string) => `${key}/${version}`;
  let disk = diskBytes;
  const files: OfflinePackFiles = {
    read: async (key) => {
      const raw = records.get(key);
      return raw ? (JSON.parse(raw) as StoredOfflinePack) : null;
    },
    write: async (stored) => {
      records.set(stored.record.key, JSON.stringify(stored));
    },
    removePack: async (key) => {
      records.delete(key);
      for (const map of [parts, finished]) for (const name of [...map.keys()]) if (name.startsWith(`${key}/`)) map.delete(name);
    },
    removeEntries: (key, entries) => {
      for (const entry of entries) {
        parts.delete(id(key, entry.version_id));
        finished.delete(id(key, entry.version_id));
      }
    },
    finishedBytes: (key, entry) => finished.get(id(key, entry.version_id))?.length ?? null,
    partBytes: (key, entry) => parts.get(id(key, entry.version_id))?.length ?? 0,
    appendPart: (key, entry, bytes) => {
      const name = id(key, entry.version_id);
      parts.set(name, [...(parts.get(name) ?? []), ...bytes]);
    },
    resetPart: (key, entry) => {
      parts.delete(id(key, entry.version_id));
    },
    finish: (key, entry) => {
      const name = id(key, entry.version_id);
      const bytes = parts.get(name) ?? [];
      parts.delete(name);
      finished.set(name, bytes);
      return bytes.length;
    },
    availableDiskBytes: () => disk,
  };
  return { files, records, parts, finished, setDisk: (bytes: number) => (disk = bytes) };
};

/** A Storage object served with Range support (206 + Content-Range), like Supabase Storage. */
const rangeServer = (objects: Record<string, number>) => {
  const calls: Array<{ url: string; start: number; end: number }> = [];
  let failNext = 0;
  const fetchRange: OfflineDownloadDependencies['fetchRange'] = async (url, start, end) => {
    calls.push({ url, start, end });
    if (failNext > 0) {
      failNext -= 1;
      throw new TypeError('Network request failed');
    }
    const version = /storage\.test\/([^?]+)/.exec(url)?.[1] ?? '';
    const size = objects[version] ?? 0;
    const last = Math.min(end, size - 1);
    const bytes = new Uint8Array(last - start + 1).map((_, index) => (start + index) % 251);
    return { status: 206, contentRange: `bytes ${start}-${last}/${size}`, bytes };
  };
  return { fetchRange, calls, failNextRequests: (count: number) => (failNext = count) };
};

const deps = (
  files: OfflinePackFiles,
  overrides: Partial<OfflineDownloadDependencies> & Pick<OfflineDownloadDependencies, 'requestPack' | 'fetchRange'>,
): OfflineDownloadDependencies => ({
  files,
  renewLink: async (entry) => ({ url: `https://storage.test/${entry.version_id}?token=renewed`, expiresAt: Date.parse('2026-10-22T10:10:00.000Z') }),
  isCurrent: () => true,
  shouldStop: () => false,
  onChange: () => undefined,
  now: () => Date.parse('2026-10-22T10:01:00.000Z'),
  ...overrides,
});

describe('MOB-025 storage budget and pack identity', () => {
  it('asks for the F14 default, inside the device limit, leaving free space for the phone', () => {
    expect(offlinePackBudget({ availableDiskBytes: 64 * 1024 * MB, otherPacksBytes: 0, thisPackBytes: 0 })).toBe(OFFLINE_PACK_DEFAULT_MAX_BYTES);
    // Little free space: what is left above the reserve.
    expect(offlinePackBudget({ availableDiskBytes: OFFLINE_FREE_SPACE_RESERVE_BYTES + 40 * MB, otherPacksBytes: 0, thisPackBytes: 0 })).toBe(40 * MB);
    // Other packs near the device-wide limit.
    expect(offlinePackBudget({ availableDiskBytes: 64 * 1024 * MB, otherPacksBytes: OFFLINE_STORAGE_LIMIT_BYTES - 5 * MB, thisPackBytes: 0 })).toBe(5 * MB);
    // This pack's own bytes are reused, so they count as available.
    expect(offlinePackBudget({ availableDiskBytes: OFFLINE_FREE_SPACE_RESERVE_BYTES, otherPacksBytes: 0, thisPackBytes: 30 * MB })).toBe(30 * MB);
    // Nothing fits: refused before anything is written.
    expect(offlinePackBudget({ availableDiskBytes: OFFLINE_FREE_SPACE_RESERVE_BYTES - 1, otherPacksBytes: 0, thisPackBytes: 0 })).toBeNull();
  });

  it('the budget is a body the server accepts', () => {
    const budget = offlinePackBudget({ availableDiskBytes: 64 * 1024 * MB, otherPacksBytes: 0, thisPackBytes: 0 })!;
    expect(offlinePackRequestSchema.safeParse({ max_bytes: budget }).success).toBe(true);
  });

  it('keys packs by person, organization and plan, with file-safe names per exact version', () => {
    expect(KEY).toBe('rehearsal-pack:user-1:org-1:plan');
    expect(packFolderName(KEY)).toBe('rehearsal-pack_user-1_org-1_plan');
    expect(entryFileName({ version_id: 'v-1', filename: 'Take 3.M4A' })).toBe('v-1.m4a');
    expect(entryFileName({ version_id: 'v-1', filename: 'no-extension' })).toBe('v-1');
    expect(entryFileName({ version_id: '../v', filename: 'a.mp3' })).toBe('___v.mp3');
  });

  it('another account, a lost organization and sign-out delete packs (shared rule)', () => {
    const records = [
      { key: 'a', user_id: 'user-1', organization_id: 'org-1' },
      { key: 'b', user_id: 'user-1', organization_id: 'org-2' },
      { key: 'c', user_id: 'user-2', organization_id: 'org-1' },
    ];
    expect(offlinePackKeysToRemove(records, { userId: 'user-1', organizationIds: ['org-1'] })).toEqual(['b', 'c']);
    expect(offlinePackKeysToRemove(records, { userId: null, organizationIds: [] })).toEqual(['a', 'b', 'c']);
  });
});

describe('MOB-025 range answers', () => {
  it('asks for the next chunk until the exact size', () => {
    expect(nextChunkRange(0, 10, 4)).toEqual({ start: 0, end: 3 });
    expect(nextChunkRange(8, 10, 4)).toEqual({ start: 8, end: 9 });
    expect(nextChunkRange(10, 10, 4)).toBeNull();
    expect(nextChunkRange(0, 3 * OFFLINE_CHUNK_BYTES)).toEqual({ start: 0, end: OFFLINE_CHUNK_BYTES - 1 });
  });

  it('appends only an exact 206, accepts a whole 200 only from the start, restarts otherwise', () => {
    const base = { start: 4, end: 7, size: 10, contentRangeStart: 4, receivedBytes: 4 };
    expect(acceptChunk({ ...base, status: 206 })).toBe('append');
    expect(acceptChunk({ ...base, status: 206, contentRangeStart: 0 })).toBe('restart');
    expect(acceptChunk({ ...base, status: 206, receivedBytes: 3 })).toBe('restart');
    expect(acceptChunk({ ...base, status: 200, receivedBytes: 10 })).toBe('restart');
    expect(acceptChunk({ ...base, status: 200, start: 0, receivedBytes: 10 })).toBe('whole');
    expect(contentRangeStart('bytes 4-7/10')).toBe(4);
    expect(contentRangeStart('bytes 4-7/*')).toBe(4);
    expect(contentRangeStart(null)).toBeNull();
  });
});

describe('MOB-025 explicit download', () => {
  const A = material('a', { size_bytes: 10 });
  const B = material('b', { size_bytes: 6 });
  const SOURCE = manifest([A, B]);

  it('downloads every exact version, stores no URL, and only then is ready', async () => {
    const device = memoryFiles();
    const server = rangeServer({ 'a-v1': 10, 'b-v1': 6 });
    const states: string[] = [];
    const outcome = await downloadOfflinePack(
      { planId: 'plan', scope: SCOPE, key: KEY, maxBytes: 100 },
      deps(device.files, {
        requestPack: async (_plan, max) => {
          expect(max).toBe(100);
          return packFor(SOURCE);
        },
        fetchRange: server.fetchRange,
        chunkBytes: 4,
        onChange: (stored) => states.push(summarizeOfflinePack(stored, { newFileIds: [], now: PACK_CLOCK }).phase),
      }),
    );
    expect(outcome.result).toBe('complete');
    const stored = (await device.files.read(KEY))!;
    expect(stored.state).toBe('complete');
    expect(stored.record.entries.map((entry) => [entry.version_id, entry.downloaded_bytes])).toEqual([['a-v1', 10], ['b-v1', 6]]);
    expect(JSON.stringify(stored)).not.toContain('storage.test');
    // Never "ready" while any file was partial.
    expect(states.slice(0, -1).every((phase) => phase === 'downloading')).toBe(true);
    expect(states.at(-1)).toBe('ready');
    expect(device.finished.get(`${KEY}/a-v1`)).toHaveLength(10);
  });

  it('an interrupted download is incomplete and resumes from the bytes on the device with a fresh link', async () => {
    const device = memoryFiles();
    const server = rangeServer({ 'a-v1': 10, 'b-v1': 6 });
    let chunks = 0;
    const first = await downloadOfflinePack(
      { planId: 'plan', scope: SCOPE, key: KEY, maxBytes: 100 },
      deps(device.files, {
        requestPack: async () => packFor(SOURCE),
        fetchRange: server.fetchRange,
        chunkBytes: 4,
        // The app closes after two chunks.
        shouldStop: () => chunks++ >= 2,
      }),
    );
    expect(first).toMatchObject({ result: 'stopped', reason: 'paused' });
    const partial = (await device.files.read(KEY))!;
    expect(partial.state).toBe('incomplete');
    expect(summarizeOfflinePack(partial, { newFileIds: [], now: PACK_CLOCK }).phase).toBe('incomplete');
    expect(offlineEntryForTrack(partial, { material: A })).toBeNull();
    expect(device.parts.get(`${KEY}/a-v1`)).toHaveLength(8);

    // Later: a new pack answer (new URLs); the first 8 bytes are kept.
    server.calls.length = 0;
    const resumed = await downloadOfflinePack(
      { planId: 'plan', scope: SCOPE, key: KEY, maxBytes: 100 },
      deps(device.files, { requestPack: async () => packFor(SOURCE), fetchRange: server.fetchRange }),
    );
    expect(resumed.result).toBe('complete');
    expect(server.calls[0]).toMatchObject({ start: 8, end: 9 });
    expect(device.finished.get(`${KEY}/a-v1`)).toEqual([...Array(10).keys()].map((index) => index % 251));
  });

  it('a lost connection renews the link once, then stops as incomplete (never ready)', async () => {
    const device = memoryFiles();
    const server = rangeServer({ 'a-v1': 10, 'b-v1': 6 });
    server.failNextRequests(1);
    const renewed: string[] = [];
    const ok = await downloadOfflinePack(
      { planId: 'plan', scope: SCOPE, key: KEY, maxBytes: 100 },
      deps(device.files, {
        requestPack: async () => packFor(SOURCE),
        fetchRange: server.fetchRange,
        renewLink: async (entry) => {
          renewed.push(entry.version_id);
          return { url: `https://storage.test/${entry.version_id}?token=renewed`, expiresAt: Date.parse('2026-10-22T10:10:00.000Z') };
        },
      }),
    );
    expect(ok.result).toBe('complete');
    expect(renewed).toEqual(['a-v1']);

    const offline = memoryFiles();
    const down = rangeServer({ 'a-v1': 10 });
    down.failNextRequests(5);
    const stopped = await downloadOfflinePack(
      { planId: 'plan', scope: SCOPE, key: KEY, maxBytes: 100 },
      deps(offline.files, { requestPack: async () => packFor(SOURCE), fetchRange: down.fetchRange }),
    );
    expect(stopped).toMatchObject({ result: 'stopped', reason: 'connection' });
    expect((await offline.files.read(KEY))!.state).toBe('incomplete');
  });

  it('renews an expiring link before asking for bytes', async () => {
    const device = memoryFiles();
    const server = rangeServer({ 'a-v1': 10, 'b-v1': 6 });
    const outcome = await downloadOfflinePack(
      { planId: 'plan', scope: SCOPE, key: KEY, maxBytes: 100 },
      deps(device.files, {
        requestPack: async () => packFor(SOURCE),
        fetchRange: server.fetchRange,
        // 10 s before the pack's links expire.
        now: () => Date.parse('2026-10-22T10:04:50.000Z'),
      }),
    );
    expect(outcome.result).toBe('complete');
    expect(server.calls.every((call) => call.url.endsWith('token=renewed'))).toBe(true);
  });

  it('stops when the phone runs out of space, keeping what was downloaded', async () => {
    const device = memoryFiles(OFFLINE_FREE_SPACE_RESERVE_BYTES + 3);
    const server = rangeServer({ 'a-v1': 10, 'b-v1': 6 });
    const outcome = await downloadOfflinePack(
      { planId: 'plan', scope: SCOPE, key: KEY, maxBytes: 100 },
      deps(device.files, { requestPack: async () => packFor(SOURCE), fetchRange: server.fetchRange }),
    );
    expect(outcome).toMatchObject({ result: 'stopped', reason: 'storage_full' });
    expect(server.calls).toHaveLength(0);
    expect((await device.files.read(KEY))!.stopped).toBe('storage_full');
  });

  it('a file revoked mid-download is deleted and listed as unavailable; the rest completes', async () => {
    const device = memoryFiles();
    const server = rangeServer({ 'a-v1': 10, 'b-v1': 6 });
    const outcome = await downloadOfflinePack(
      { planId: 'plan', scope: SCOPE, key: KEY, maxBytes: 100 },
      deps(device.files, {
        requestPack: async () => packFor(SOURCE),
        // Storage refuses the old link; the renewal says the file is gone (F13 404).
        fetchRange: async (url, start, end) =>
          url.includes('a-v1') ? { status: 400, contentRange: null, bytes: new Uint8Array() } : server.fetchRange(url, start, end),
        renewLink: async (entry) => {
          if (entry.version_id === 'a-v1') throw new ApiError(404, 'File not found');
          return { url: `https://storage.test/${entry.version_id}?token=renewed`, expiresAt: Date.parse('2026-10-22T10:10:00.000Z') };
        },
      }),
    );
    expect(outcome.result).toBe('complete');
    const stored = (await device.files.read(KEY))!;
    expect(stored.record.entries.map((entry) => entry.version_id)).toEqual(['b-v1']);
    expect(stored.excluded).toEqual([{ item_id: 'item-0', file_id: 'a', title: 'a.m4a', reason: 'unavailable' }]);
    expect(device.parts.has(`${KEY}/a-v1`)).toBe(false);
  });

  it('a changed object (wrong range) restarts the file once, then stops; a short file is never ready', async () => {
    const device = memoryFiles();
    const outcome = await downloadOfflinePack(
      { planId: 'plan', scope: SCOPE, key: KEY, maxBytes: 100 },
      deps(device.files, {
        requestPack: async () => packFor(SOURCE),
        fetchRange: async (_url, start) => ({ status: 206, contentRange: `bytes ${start + 1}-${start + 2}/10`, bytes: new Uint8Array(2) }),
      }),
    );
    expect(outcome).toMatchObject({ result: 'stopped', reason: 'server' });
    const stored = (await device.files.read(KEY))!;
    expect(stored.record.entries[0]!.downloaded_bytes).toBe(0);
    expect(summarizeOfflinePack(stored, { newFileIds: [], now: PACK_CLOCK }).phase).toBe('incomplete');
  });

  it('a plan no longer readable deletes the whole pack; another account or organization writes nothing', async () => {
    const device = memoryFiles();
    const server = rangeServer({ 'a-v1': 10, 'b-v1': 6 });
    await downloadOfflinePack(
      { planId: 'plan', scope: SCOPE, key: KEY, maxBytes: 100 },
      deps(device.files, { requestPack: async () => packFor(SOURCE), fetchRange: server.fetchRange }),
    );
    const lost = await downloadOfflinePack(
      { planId: 'plan', scope: SCOPE, key: KEY, maxBytes: 100 },
      deps(device.files, {
        requestPack: async () => {
          throw new ApiError(404, 'Plan not found');
        },
        fetchRange: server.fetchRange,
      }),
    );
    expect(lost.result).toBe('access_lost');
    expect(device.records.size).toBe(0);
    expect(device.finished.size).toBe(0);

    let current = true;
    const abandoned = await downloadOfflinePack(
      { planId: 'plan', scope: SCOPE, key: KEY, maxBytes: 100 },
      deps(device.files, {
        requestPack: async () => packFor(SOURCE),
        fetchRange: async (url, start, end) => {
          current = false; // signed out / switched organization while this request was in flight
          return server.fetchRange(url, start, end);
        },
        isCurrent: () => current,
      }),
    );
    expect(abandoned.result).toBe('abandoned');
    expect(device.parts.size).toBe(0);
    expect((await device.files.read(KEY))!.state).toBe('downloading');
  });
});

describe('MOB-025 recheck, expiry and offline playback', () => {
  const A = material('a', { size_bytes: 10 });
  const B = material('b', { size_bytes: 6 });
  const complete = (): StoredOfflinePack => {
    const { stored } = mergeOfflinePack(null, packFor(manifest([A, B])), SCOPE);
    return {
      ...stored,
      state: 'complete',
      record: { ...stored.record, entries: stored.record.entries.map((entry) => ({ ...entry, downloaded_bytes: entry.size_bytes })) },
    };
  };

  it('a complete pack plays its exact versions offline until the recheck time, then nothing plays', () => {
    const stored = complete();
    const before = new Date('2026-10-23T09:59:00.000Z');
    const after = new Date('2026-10-23T10:00:00.000Z');
    expect(summarizeOfflinePack(stored, { newFileIds: [], now: before }).phase).toBe('ready');
    expect(offlineEntryForTrack(stored, { material: A }, before)?.version_id).toBe('a-v1');
    // Another version of the same file is not what was downloaded.
    expect(offlineEntryForTrack(stored, { material: { ...A, version_id: 'a-v2' } }, before)).toBeNull();
    expect(isPackExpired(stored, after)).toBe(true);
    expect(summarizeOfflinePack(stored, { newFileIds: [], now: after }).phase).toBe('expired');
    expect(offlineEntryForTrack(stored, { material: A }, after)).toBeNull();
  });

  it('a fresh manifest removes revoked (archived, stream-only, unreadable) and replaced versions and renews the window', () => {
    const stored = complete();
    const fresh = manifest(
      [
        { ...A, version_id: 'a-v2', version_number: 2 },
        { ...B, playback_rights: 'stream_only', rights: { stream: true, download: false, offline: false } },
      ],
      '2026-10-24T08:00:00.000Z',
    );
    const result = recheckOfflinePack(stored, fresh);
    expect(result.remove.map((entry) => entry.version_id)).toEqual(['a-v1', 'b-v1']);
    expect(result.removed).toEqual({ revoked: 1, stale: 1 });
    expect(result.stored.record.entries).toEqual([]);
    // The replaced file is offered again; the stream-only one is not.
    expect(result.newFileIds).toEqual(['a']);
    expect(result.stored.record.recheck_by).toBe('2026-10-25T08:00:00.000Z');
    expect(result.stored.manifest).toBe(fresh);
    expect(summarizeOfflinePack(result.stored, { newFileIds: result.newFileIds, now: new Date('2026-10-24T09:00:00.000Z') }).phase).toBe(
      'update_available',
    );
  });

  it('a file merged into another song or archived disappears from the manifest and is removed', () => {
    const result = recheckOfflinePack(complete(), manifest([B]));
    expect(result.remove.map((entry) => entry.file_id)).toEqual(['a']);
    expect(result.removed.revoked).toBe(1);
    expect(result.stored.state).toBe('complete');
  });

  it('renewing a pack keeps finished bytes of the same exact version and drops the rest', () => {
    const previous = complete();
    const next = packFor(manifest([A, { ...B, version_id: 'b-v2', size_bytes: 8 }]));
    const { stored, remove } = mergeOfflinePack(previous, next, SCOPE);
    expect(stored.record.entries.map((entry) => [entry.version_id, entry.downloaded_bytes])).toEqual([['a-v1', 10], ['b-v2', 0]]);
    expect(remove.map((entry) => entry.version_id)).toEqual(['b-v1']);
    expect(stored.state).toBe('incomplete');
    expect(JSON.stringify(stored)).not.toContain('token=');
  });
});

describe('MOB-025 source contract', () => {
  const read = (...parts: string[]) => readFileSync(join(__dirname, '..', '..', ...parts), 'utf8');
  const hook = read('src', 'lib', 'useOfflinePack.ts');
  const store = read('src', 'lib', 'offline-pack-store.ts');
  const downloader = read('src', 'lib', 'offline-pack-download.ts');
  const card = read('src', 'components', 'rehearsal', 'OfflinePackCard.tsx');
  const screen = read('app', 'plan', 'rehearse', '[id].tsx');
  const layout = read('app', '_layout.tsx');

  it('uses only the implemented F14/F13 methods', () => {
    const methods = [...(hook + screen + card).matchAll(/api\.(\w+)\(/g)].map((match) => match[1]);
    expect(new Set(methods)).toEqual(new Set(['rehearsalManifest', 'rehearsalOfflinePack', 'fileDownload']));
    expect(hook).toMatch(/disposition: 'attachment'/);
  });

  it('downloads only when the person asks, into scoped cache storage, and never writes the server', () => {
    // The download starts from a button, not from an effect.
    expect(card).toMatch(/onPress=\{view\.download\}/);
    expect(store).toMatch(/new Directory\(Paths\.cache, 'rehearsal-packs'\)/);
    expect(store).not.toMatch(/AsyncStorage|SecureStore/);
    expect(hook + screen).not.toMatch(/useMutation|api\.(create|update|delete|set)\w*\(/);
  });

  it('re-verifies files on every read and deletes packs on sign-out, account change and lost organizations', () => {
    expect(store).toContain('verifyAgainstFiles(stored)');
    expect(layout).toContain('useOfflinePackCleanup()');
    expect(hook).toContain('offlinePackKeysToRemove(');
  });

  it('drops late work after an identity change and logs no links', () => {
    expect(downloader.match(/deps\.isCurrent\(\)/g)!.length).toBeGreaterThanOrEqual(4);
    expect(hook + store + downloader).not.toMatch(/console\.\w+\([^)]*url/i);
  });
});
