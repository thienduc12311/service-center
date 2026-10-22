import type { SavePlanNoteInput } from '../schemas/collaboration.js';
import type { NoteAudience, NoteCategoryRow, PlanNote } from '../types/collaboration.js';

/**
 * F09 / MOB-016: the note editor's form state and the request it becomes,
 * shared so the website and the native app save the same note for the same
 * choices. Notes are read only through `planNotes`, which already returns
 * just the notes the caller may read; nothing here filters by audience.
 */

export const NOTE_AUDIENCES: readonly NoteAudience[] = ['organization', 'scheduled', 'teams', 'leaders'];

/** Everything the note editor edits. */
export interface PlanNoteDraft {
  /** Null: a plan note. Fixed by where the editor was opened. */
  planItemId: string | null;
  /** Null: "General". */
  categoryId: string | null;
  audience: NoteAudience;
  /** Only sent for a `teams` note. */
  teamIds: string[];
  body: string;
}

export type PlanNoteDraftProblem = 'body_required' | 'teams_required';

/** A new note starts General and readable by everyone, like the plan's simple note. */
export const planNoteDraftFrom = (note: PlanNote | null, planItemId: string | null): PlanNoteDraft =>
  note
    ? {
        planItemId: note.plan_item_id,
        categoryId: note.category_id,
        audience: note.audience,
        teamIds: [...note.team_ids],
        body: note.body,
      }
    : { planItemId, categoryId: null, audience: 'organization', teamIds: [], body: '' };

/**
 * Choosing a category suggests its default audience for a new note; it never
 * changes the audience of a note that already exists.
 */
export const withNoteCategory = (
  draft: PlanNoteDraft,
  categoryId: string | null,
  categories: readonly NoteCategoryRow[],
  isNew: boolean,
): PlanNoteDraft => {
  const category = categories.find((candidate) => candidate.id === categoryId);
  return {
    ...draft,
    categoryId,
    audience: isNew && category ? category.default_audience : draft.audience,
  };
};

export const toggleNoteTeam = (draft: PlanNoteDraft, teamId: string): PlanNoteDraft => ({
  ...draft,
  teamIds: draft.teamIds.includes(teamId)
    ? draft.teamIds.filter((id) => id !== teamId)
    : [...draft.teamIds, teamId],
});

export const validatePlanNoteDraft = (draft: PlanNoteDraft): PlanNoteDraftProblem | null => {
  if (!draft.body.trim()) return 'body_required';
  if (draft.audience === 'teams' && draft.teamIds.length === 0) return 'teams_required';
  return null;
};

/**
 * The body for `createPlanNote` (no `note`) or `updatePlanNote`, which must
 * carry the revision the editor opened (`baseRevision`, the note's own unless
 * the editor re-based onto a newer copy). Team ids go only with a team note.
 */
export const planNoteRequest = (
  draft: PlanNoteDraft,
  note: Pick<PlanNote, 'revision'> | null,
  baseRevision: number | null = note?.revision ?? null,
): SavePlanNoteInput => ({
  plan_item_id: draft.planItemId,
  category_id: draft.categoryId,
  audience: draft.audience,
  team_ids: draft.audience === 'teams' ? [...new Set(draft.teamIds)] : [],
  body: draft.body.trim(),
  ...(note && baseRevision !== null ? { expected_revision: baseRevision } : {}),
});

const sameTeams = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id) => b.includes(id));

/** Something typed or chosen would be lost by leaving. */
export const planNoteDraftChanged = (draft: PlanNoteDraft, note: PlanNote | null): boolean => {
  if (!note) return draft.body.trim().length > 0;
  return (
    draft.body.trim() !== note.body.trim()
    || draft.categoryId !== note.category_id
    || draft.audience !== note.audience
    || (draft.audience === 'teams' && !sameTeams(draft.teamIds, note.team_ids))
  );
};

/**
 * The plan's simple note (mirrored to `plans.notes`, read by older apps)
 * stays simple only while it is a General, everyone, plan-level note.
 * Saving any other shape makes it an ordinary note and clears the simple
 * text — the server does this; the editor says so before saving.
 */
export const planNoteLeavesSimple = (note: PlanNote | null, draft: PlanNoteDraft): boolean =>
  Boolean(note?.is_legacy)
  && (draft.planItemId !== null || draft.categoryId !== null || draft.audience !== 'organization');

/** How a note's category reads: General, a live category, or one no longer offered (archived). */
export type NoteCategoryLabel =
  | { kind: 'general' }
  | { kind: 'category'; category: NoteCategoryRow }
  | { kind: 'unavailable' };

export const noteCategoryLabel = (categoryId: string | null, categories: readonly NoteCategoryRow[]): NoteCategoryLabel => {
  if (!categoryId) return { kind: 'general' };
  const category = categories.find((candidate) => candidate.id === categoryId);
  return category ? { kind: 'category', category } : { kind: 'unavailable' };
};

/** The names of a team note's teams, in the order given; unknown ids are left out. */
export const noteTeamNames = (
  teamIds: readonly string[],
  teams: readonly { id: string; name: string }[],
): string[] =>
  teamIds.flatMap((id) => {
    const team = teams.find((candidate) => candidate.id === id);
    return team ? [team.name] : [];
  });

/** Plan-level notes (`itemId` null) or one item's notes, in the server's order. */
export const planNotesFor = (notes: readonly PlanNote[], itemId: string | null): PlanNote[] =>
  notes.filter((note) => note.plan_item_id === itemId);

/** How many readable notes each item has. */
export const itemNoteCounts = (notes: readonly PlanNote[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const note of notes) {
    if (note.plan_item_id) counts.set(note.plan_item_id, (counts.get(note.plan_item_id) ?? 0) + 1);
  }
  return counts;
};
