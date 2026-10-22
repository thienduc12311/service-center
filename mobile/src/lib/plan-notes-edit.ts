import {
  ApiError,
  noteCategoryLabel,
  type NoteCategoryRow,
  type PlanItemComment,
  type PlanNote,
  type PlanNoteDraft,
} from '@service-center/shared';

/**
 * MOB-016: native notes and item discussion on the F09 contracts
 * (`planNotes`, `createPlanNote`, `updatePlanNote`, `deletePlanNote`,
 * `itemComments`, `postItemComment`, `editItemComment`, `deleteItemComment`,
 * `mentionCandidates`). Draft/request rules live in `@service-center/shared`
 * (`plan-notes`); these helpers only read the server's answers.
 */

/** How a refused or failed note save/delete should be presented. */
export type NoteWriteOutcome =
  /** Someone else changed the note first (409 `note_stale`): nothing was saved. */
  | 'stale'
  /** The note (or plan) is gone or no longer readable by this person. */
  | 'gone'
  /** No answer: it may or may not have been saved. */
  | 'uncertain'
  /** Refused for another reason (validation, archived category, permission); shown as is. */
  | 'refused';

export const noteWriteOutcome = (error: unknown): NoteWriteOutcome => {
  if (error instanceof ApiError) {
    if (error.code === 'note_stale') return 'stale';
    if (error.status === 404) return 'gone';
    return 'refused';
  }
  return 'uncertain';
};

/**
 * After a refused save, a category that is no longer offered (archived, or
 * moved to another service type) is the likely cause. The server accepts a
 * note keeping the category it already had, so only a newly chosen category
 * is dropped back to General. Returns null when the category is fine.
 */
export const draftWithoutWithdrawnCategory = (
  draft: PlanNoteDraft,
  note: Pick<PlanNote, 'category_id'> | null,
  offered: readonly NoteCategoryRow[],
): PlanNoteDraft | null => {
  if (!draft.categoryId || draft.categoryId === note?.category_id) return null;
  return noteCategoryLabel(draft.categoryId, offered).kind === 'unavailable' ? { ...draft, categoryId: null } : null;
};

/** Whether an item thread could be read. */
export type ThreadAccess = 'open' | 'unavailable' | 'error';

/**
 * 404/403: the thread is only for plan leaders and people scheduled on the
 * plan (the server gives the same answer for a missing item, so nothing
 * about the item leaks). Anything else is a retryable failure.
 */
export const threadAccess = (error: unknown): ThreadAccess => {
  if (!error) return 'open';
  if (error instanceof ApiError && (error.status === 404 || error.status === 403)) return 'unavailable';
  return 'error';
};

/**
 * Pages of a thread (each oldest-first) merged into one oldest-first list.
 * The newest page is re-read after every post or edit, so it wins for the
 * comments it holds; earlier pages already shown stay, so a comment that
 * slides off the newest page after a post does not disappear.
 */
export const mergeCommentPages = (
  known: readonly PlanItemComment[],
  page: readonly PlanItemComment[],
): PlanItemComment[] => {
  const byId = new Map<string, PlanItemComment>();
  for (const comment of known) byId.set(comment.id, comment);
  for (const comment of page) byId.set(comment.id, comment);
  return [...byId.values()].sort((a, b) =>
    a.created_at === b.created_at ? a.id.localeCompare(b.id) : a.created_at.localeCompare(b.created_at));
};

/**
 * A comment draft keeps one id until the server confirms it, so sending again
 * after no answer replays the same comment. Only a server refusal saying the
 * id belongs to something else needs a fresh one.
 */
export const commentNeedsNewId = (error: unknown): boolean =>
  error instanceof ApiError && error.code === 'comment_id_conflict';
