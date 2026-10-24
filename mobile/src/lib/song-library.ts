import type { QueryClient } from '@tanstack/react-query';
import { ApiError, type SongRow } from '@service-center/shared';
import { queryKeys } from './query-keys';
import type { ProtectedQueryScope } from './session-lifecycle';

/**
 * MOB-028: native song library and authoring on the website's F15 contracts
 * (`listSongs`, `getSong`, `createSong`, `updateSong`, `createArrangement`,
 * `updateArrangement`, `archiveSong`, `archiveArrangement`,
 * `getArrangementMaterials`, `saveArrangementKey`,
 * `previewArrangementDuplicate`, `duplicateArrangement`). Forms, request
 * bodies, filters and paging come from `@service-center/shared`
 * (`song-authoring`); these helpers only read the server's answers and keep
 * unsaved drafts for the signed-in identity.
 */

/** How a refused or failed library write should be presented. */
export type LibraryWriteOutcome =
  /** Someone else saved first (409 revision/library change): nothing was saved. */
  | 'stale'
  /** The song or arrangement is gone or no longer readable. */
  | 'gone'
  /** No answer: it may or may not have been saved. */
  | 'uncertain'
  /** Refused for another reason (validation, permission, archive rule); shown as is. */
  | 'refused';

const STALE_CODES: ReadonlySet<string> = new Set(['song_revision_stale', 'arrangement_revision_stale', 'library_changed']);

export const libraryWriteOutcome = (error: unknown): LibraryWriteOutcome => {
  if (error instanceof ApiError) {
    if (error.code && STALE_CODES.has(error.code)) return 'stale';
    if (error.status === 404) return 'gone';
    return 'refused';
  }
  return 'uncertain';
};

/**
 * Whether the signed-in person may author this song: `songs.manage` is
 * organization-wide (leading a team never implies it), and a merged song is
 * read-only history that points at the kept one. The server rechecks both.
 */
export const canAuthorSong = (canManage: boolean, song: Pick<SongRow, 'merged_into_song_id'> | null | undefined): boolean =>
  canManage && Boolean(song) && !song?.merged_into_song_id;

/** One unsaved authoring draft and the revision it was started from. */
export interface AuthoringDraft<T> {
  draft: T;
  /** Null for a create; otherwise the record revision the edit is checked against. */
  baseRevision: number | null;
  /** The saved values at `baseRevision`, so a later reload can rebase the draft field by field. */
  base?: T;
}

/**
 * Unsaved song/arrangement/key drafts, kept in memory only and per signed-in
 * identity: a draft written under one account, organization or session
 * generation is never offered under another. A draft survives a failed,
 * stale or unanswered save and leaving the editor by accident; it is cleared
 * on a confirmed save or an explicit discard.
 */
export class AuthoringDraftStore {
  private drafts = new Map<string, AuthoringDraft<unknown>>();
  private scopeKey: string | null = null;

  private keyFor(scope: ProtectedQueryScope, target: string): string {
    const scopeKey = `${scope.userId}:${scope.organizationId}:${scope.generation}`;
    if (scopeKey !== this.scopeKey) {
      this.drafts.clear();
      this.scopeKey = scopeKey;
    }
    return `${scopeKey}:${target}`;
  }

  get<T>(scope: ProtectedQueryScope | null, target: string): AuthoringDraft<T> | null {
    if (!scope) return null;
    const found = this.drafts.get(this.keyFor(scope, target));
    return found ? (found as AuthoringDraft<T>) : null;
  }

  set<T>(scope: ProtectedQueryScope | null, target: string, entry: AuthoringDraft<T>): void {
    if (!scope) return;
    this.drafts.set(this.keyFor(scope, target), entry);
  }

  clear(scope: ProtectedQueryScope | null, target: string): void {
    if (!scope) return;
    this.drafts.delete(this.keyFor(scope, target));
  }
}

export const authoringDrafts = new AuthoringDraftStore();

/**
 * The arrangement a song page should open on after an editor saved or
 * duplicated one (keyed by `draftTargets.song`), taken once on return.
 */
export const arrangementSelections = new AuthoringDraftStore();

/** Draft targets: one per record (or per song for a new arrangement). */
export const draftTargets = {
  newSong: () => 'song:new',
  song: (songId: string) => `song:${songId}`,
  newArrangement: (songId: string) => `song:${songId}:arrangement:new`,
  arrangement: (arrangementId: string) => `arrangement:${arrangementId}`,
  labeledKey: (arrangementId: string, keyId: string) => `arrangement:${arrangementId}:key:${keyId}`,
  /** MOB-029: the Lyrics & Chords editor's draft of one arrangement's chart. */
  chart: (arrangementId: string) => `arrangement:${arrangementId}:chart`,
};

/**
 * Everything a library write can change for a reader: the library pages and
 * pickers, the song, an arrangement's keys/files, and every plan, rehearsal
 * and file list that inherits a default arrangement or key from it.
 */
export const invalidateLibrary = (queryClient: QueryClient, scope: ProtectedQueryScope | null): Promise<void> =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.songsAll(scope) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.songAll(scope) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.arrangementMaterialsAll(scope) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.planAll(scope) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.rehearsalAll(scope) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.filesAll(scope) }),
  ]).then(() => undefined);
