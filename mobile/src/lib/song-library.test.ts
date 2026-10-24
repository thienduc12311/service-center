import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@service-center/shared';
import { queryKeys } from './query-keys';
import type { ProtectedQueryScope } from './session-lifecycle';
import {
  AuthoringDraftStore,
  canAuthorSong,
  draftTargets,
  invalidateLibrary,
  libraryWriteOutcome,
} from './song-library';

const scope: ProtectedQueryScope = { generation: 1, userId: 'user-a', organizationId: 'org-a' };
const mobileRoot = join(__dirname, '..', '..');
const source = (path: string): string => readFileSync(join(mobileRoot, path), 'utf8');

describe('libraryWriteOutcome', () => {
  it('reads revision and library conflicts as stale, so the draft is kept for a reload', () => {
    for (const code of ['song_revision_stale', 'arrangement_revision_stale', 'library_changed']) {
      expect(libraryWriteOutcome(new ApiError(409, 'changed', code))).toBe('stale');
    }
  });

  it('separates gone, refused and no-answer outcomes', () => {
    expect(libraryWriteOutcome(new ApiError(404, 'Song not found'))).toBe('gone');
    expect(libraryWriteOutcome(new ApiError(409, 'An active song needs an arrangement', 'conflict'))).toBe('refused');
    expect(libraryWriteOutcome(new ApiError(403, 'forbidden'))).toBe('refused');
    expect(libraryWriteOutcome(new TypeError('Network request failed'))).toBe('uncertain');
  });
});

describe('canAuthorSong', () => {
  it('needs songs.manage and an unmerged song', () => {
    expect(canAuthorSong(true, { merged_into_song_id: null })).toBe(true);
    expect(canAuthorSong(true, { merged_into_song_id: 'kept-song' })).toBe(false);
    expect(canAuthorSong(false, { merged_into_song_id: null })).toBe(false);
    expect(canAuthorSong(true, null)).toBe(false);
  });
});

describe('AuthoringDraftStore', () => {
  it('keeps a draft and the revision it started from per record', () => {
    const store = new AuthoringDraftStore();
    store.set(scope, draftTargets.song('s1'), { draft: { title: 'Draft' }, baseRevision: 4 });
    expect(store.get(scope, draftTargets.song('s1'))).toEqual({ draft: { title: 'Draft' }, baseRevision: 4 });
    expect(store.get(scope, draftTargets.song('s2'))).toBeNull();
    store.clear(scope, draftTargets.song('s1'));
    expect(store.get(scope, draftTargets.song('s1'))).toBeNull();
  });

  it('never offers a draft to another account, organization or session generation', () => {
    for (const other of [
      { ...scope, userId: 'user-b' },
      { ...scope, organizationId: 'org-b' },
      { ...scope, generation: 2 },
    ]) {
      const store = new AuthoringDraftStore();
      store.set(scope, draftTargets.newSong(), { draft: { title: 'Draft' }, baseRevision: null });
      expect(store.get(other, draftTargets.newSong())).toBeNull();
      expect(store.get(scope, draftTargets.newSong())).toBeNull();
    }
  });

  it('keeps nothing while signed out', () => {
    const store = new AuthoringDraftStore();
    store.set(null, draftTargets.newSong(), { draft: 'x', baseRevision: null });
    expect(store.get(null, draftTargets.newSong())).toBeNull();
  });
});

describe('library cache', () => {
  it('keys every library page by account, organization and generation', () => {
    const query = { q: 'grace', archive: 'active' as const };
    expect(queryKeys.songLibrary(scope, query)).not.toEqual(queryKeys.songLibrary({ ...scope, organizationId: 'org-b' }, query));
    expect(queryKeys.songLibrary(scope, query)).not.toEqual(queryKeys.songLibrary({ ...scope, generation: 2 }, query));
    expect(queryKeys.songLibrary(scope, query).slice(0, 5)).toEqual([...queryKeys.songsAll(scope)]);
  });

  it('invalidates the library, songs, keys, and every plan, rehearsal and file list that inherits from them', async () => {
    const invalidated: unknown[] = [];
    const client = {
      invalidateQueries: (filters: { queryKey: readonly unknown[] }) => {
        invalidated.push(filters.queryKey);
        return Promise.resolve();
      },
    } as unknown as QueryClient;
    await invalidateLibrary(client, scope);
    expect(invalidated).toEqual([
      queryKeys.songsAll(scope),
      queryKeys.songAll(scope),
      queryKeys.arrangementMaterialsAll(scope),
      queryKeys.planAll(scope),
      queryKeys.rehearsalAll(scope),
      queryKeys.filesAll(scope),
    ]);
    // The prefixes really cover the per-record keys they are meant to refresh.
    expect(queryKeys.plan(scope, 'p1').slice(0, 5)).toEqual([...queryKeys.planAll(scope)]);
    expect(queryKeys.song(scope, 's1').slice(0, 5)).toEqual([...queryKeys.songAll(scope)]);
    expect(queryKeys.arrangementMaterials(scope, 'a1').slice(0, 5)).toEqual([...queryKeys.arrangementMaterialsAll(scope)]);
  });
});

describe('native library contract', () => {
  it('pages the library instead of reading one capped page', () => {
    const tab = source('app/(tabs)/songs.tsx');
    expect(tab).toContain('useInfiniteQuery');
    expect(tab).toContain('nextSongLibraryPage');
    expect(tab).toContain('per_page: SONG_LIBRARY_PAGE_SIZE');
    expect(tab).not.toMatch(/per_page:\s*100/);
  });

  it('sends every song and arrangement edit with the revision it was opened at', () => {
    const songEdit = source('app/song/edit/[id].tsx');
    expect(songEdit).toContain('api.updateSong(song.id, updateSongSchema.parse({ ...toUpdateSongInput(form), expected_revision: baseRevision }))');
    const arrangementEdit = source('app/song/arrangement.tsx');
    expect(arrangementEdit).toContain('toArrangementEdit(');
    const manage = source('src/components/song/SongManagement.tsx');
    expect(manage).toMatch(/archiveSong\(song\.id, \{ expected_revision: song\.revision/);
    expect(manage).toMatch(/archiveArrangement\(row\.id, \{ expected_revision: row\.revision/);
  });

  it('keeps one request key per reviewed duplicate and one id per new labeled key', () => {
    const duplicate = source('app/song/duplicate.tsx');
    expect(duplicate).toContain('idempotency_key: requestKey');
    expect(duplicate).toContain('fingerprint: preview!.fingerprint');
    const keys = source('app/song/keys.tsx');
    expect(keys).toContain('blankLabeledKey(keyId)');
  });
});
