import type { CreatePlanItemRequest, UpdatePlanItemRequest } from '../schemas/plan.js';
import type { ArrangementRow, PlanItemRow, PlanItemSegment, PlanItemType } from '../types/database.js';
import { formatDuration, parseDuration } from './dates.js';

/**
 * F11 / MOB-014: the item editor's form state and the request it becomes,
 * shared so the website and the native app send the same edit for the same
 * choices. A save sends only what changed, with the plan revision the editor
 * opened against; keys and sequences chosen here belong to the plan only.
 */

export type PlanItemLeaderMode = 'none' | 'person' | 'position';

export const PLAN_ITEM_SEGMENTS: readonly PlanItemSegment[] = ['pre', 'service', 'post'];
export const PLAN_ITEM_TYPES: readonly PlanItemType[] = ['song', 'item', 'header'];

/** Everything the editor edits, compared with the saved item to find changes. */
export interface PlanItemDraft {
  itemType: PlanItemType;
  title: string;
  /** As typed: `m:ss` or seconds; empty is zero. */
  length: string;
  description: string;
  songId: string | null;
  /** Null: the song's default arrangement. */
  arrangementId: string | null;
  /** Null: the arrangement's own key. */
  keyOverride: string | null;
  /** True: the arrangement's sequence (`sequence_override` null). */
  inheritSequence: boolean;
  /** Comma-separated steps; empty with `inheritSequence` false is "no sequence" for this plan. */
  sequence: string;
  leaderMode: PlanItemLeaderMode;
  leaderPersonId: string;
  leaderPositionId: string;
  segment: PlanItemSegment;
}

/** The saved item fields the draft starts from and is compared with. */
export type PlanItemDraftSource = Pick<
  PlanItemRow,
  | 'item_type'
  | 'title'
  | 'length_seconds'
  | 'description'
  | 'song_id'
  | 'arrangement_id'
  | 'key_override'
  | 'sequence_override'
  | 'leader_person_id'
  | 'leader_position_id'
  | 'service_segment'
>;

/** Why a draft cannot be saved yet; each is `plans:editItem.errors.<problem>`. */
export type PlanItemDraftProblem =
  | 'titleRequired'
  | 'songRequired'
  | 'lengthFormat'
  | 'lengthRange'
  | 'sequenceTooLong'
  | 'sequenceStepTooLong'
  | 'leaderPersonRequired'
  | 'leaderPositionRequired';

export const MAX_ITEM_LENGTH_SECONDS = 36_000;
export const MAX_SEQUENCE_STEPS = 60;
export const MAX_SEQUENCE_STEP_LENGTH = 20;

export const planItemDraftFrom = (item: PlanItemDraftSource): PlanItemDraft => ({
  itemType: item.item_type,
  title: item.title,
  length: item.length_seconds ? formatDuration(item.length_seconds) : '',
  description: item.description ?? '',
  songId: item.song_id,
  arrangementId: item.arrangement_id,
  keyOverride: item.key_override,
  inheritSequence: item.sequence_override === null || item.sequence_override === undefined,
  sequence: (item.sequence_override ?? []).join(', '),
  leaderMode: item.leader_person_id ? 'person' : item.leader_position_id ? 'position' : 'none',
  leaderPersonId: item.leader_person_id ?? '',
  leaderPositionId: item.leader_position_id ?? '',
  segment: item.service_segment ?? 'service',
});

/** "Intro, V1 , ,C" → ["Intro", "V1", "C"]. */
export const parseSequenceSteps = (value: string): string[] =>
  value.split(',').map((step) => step.trim()).filter(Boolean);

/** Adds one section to a typed sequence, as the section chips do. */
export const appendSequenceStep = (value: string, step: string): string =>
  [...parseSequenceSteps(value), step].join(', ');

/** The first problem the form can catch before the server does; null when valid. */
export const validatePlanItemDraft = (draft: PlanItemDraft): PlanItemDraftProblem | null => {
  if (draft.itemType !== 'song' && !draft.title.trim()) return 'titleRequired';
  if (draft.itemType === 'song' && !draft.songId) return 'songRequired';
  if (draft.length.trim() && parseDuration(draft.length) === null) return 'lengthFormat';
  const length = parseDuration(draft.length) ?? 0;
  if (length < 0 || length > MAX_ITEM_LENGTH_SECONDS) return 'lengthRange';
  if (draft.itemType === 'song' && !draft.inheritSequence) {
    const steps = parseSequenceSteps(draft.sequence);
    if (steps.length > MAX_SEQUENCE_STEPS) return 'sequenceTooLong';
    if (steps.some((step) => step.length > MAX_SEQUENCE_STEP_LENGTH)) return 'sequenceStepTooLong';
  }
  if (draft.leaderMode === 'person' && !draft.leaderPersonId) return 'leaderPersonRequired';
  if (draft.leaderMode === 'position' && !draft.leaderPositionId) return 'leaderPositionRequired';
  return null;
};

/**
 * Only the fields that changed, so a save never rewrites what it did not
 * touch. The caller adds `expected_revision`. Changing to a non-song type
 * sends only `item_type`; the server clears the song fields with it.
 */
export const planItemChangesFrom = (draft: PlanItemDraft, item: PlanItemDraftSource): UpdatePlanItemRequest => {
  const changes: UpdatePlanItemRequest = {};
  const isSong = draft.itemType === 'song';
  if (draft.itemType !== item.item_type) changes.item_type = draft.itemType;
  if (draft.title.trim() && draft.title.trim() !== item.title) changes.title = draft.title.trim();
  const length = draft.itemType === 'header' ? 0 : (parseDuration(draft.length) ?? 0);
  if (length !== item.length_seconds) changes.length_seconds = length;
  const description = draft.description.trim() || null;
  if (description !== item.description) changes.description = description;
  if (isSong) {
    if (draft.songId !== item.song_id) changes.song_id = draft.songId;
    if (draft.arrangementId !== item.arrangement_id) changes.arrangement_id = draft.arrangementId;
    if (draft.keyOverride !== item.key_override) changes.key_override = draft.keyOverride;
    const sequence = draft.inheritSequence ? null : parseSequenceSteps(draft.sequence);
    if (JSON.stringify(sequence) !== JSON.stringify(item.sequence_override ?? null)) changes.sequence_override = sequence;
  }
  const person = draft.leaderMode === 'person' ? draft.leaderPersonId : null;
  const position = draft.leaderMode === 'position' ? draft.leaderPositionId : null;
  if (person !== item.leader_person_id) changes.leader_person_id = person;
  if (position !== item.leader_position_id) changes.leader_position_id = position;
  if (draft.segment !== (item.service_segment ?? 'service')) changes.service_segment = draft.segment;
  return changes;
};

/** Choosing another song starts its arrangement, key and sequence afresh. */
export const withSong = (draft: PlanItemDraft, song: { id: string; title: string }): PlanItemDraft => ({
  ...draft,
  songId: song.id,
  title: song.title,
  arrangementId: null,
  keyOverride: null,
  inheritSequence: true,
  sequence: '',
});

/** Unticking "use the arrangement's sequence" starts from that sequence. */
export const withInheritSequence = (draft: PlanItemDraft, inherit: boolean, arrangementSequence: readonly string[]): PlanItemDraft => ({
  ...draft,
  inheritSequence: inherit,
  sequence: draft.sequence || arrangementSequence.join(', '),
});

type PickableArrangement = Pick<ArrangementRow, 'id' | 'archived_at' | 'is_default'>;

/**
 * F15: arrangements the editor offers. Archived ones are left out, except the
 * one this item already uses, so a historical choice stays visible and saved.
 */
export const editableArrangements = <A extends PickableArrangement>(arrangements: readonly A[], currentArrangementId: string | null): A[] =>
  arrangements.filter((row) => !row.archived_at || row.id === currentArrangementId);

/**
 * The arrangement a new song item starts on: the song default, else its
 * first active one. Archived arrangements are never picked for a new item.
 */
export const initialArrangementFor = <A extends PickableArrangement>(arrangements: readonly A[]): A | null =>
  arrangements.find((row) => row.is_default && !row.archived_at) ?? arrangements.find((row) => !row.archived_at) ?? null;

/** What the "Add to the order" form holds. */
export interface NewPlanItemDraft {
  itemType: PlanItemType;
  /** Required for items and headers; a song item uses the song's title. */
  title: string;
  song: { id: string; title: string; arrangements: readonly Pick<ArrangementRow, 'id' | 'archived_at' | 'is_default' | 'length_seconds'>[] } | null;
  keyOverride: string | null;
  length: string;
  description: string;
}

/**
 * The website's add-item body: a song item names its starting arrangement,
 * takes that arrangement's length when none is typed, and the chosen key is
 * kept for this plan. The server appends it at the end of the order.
 */
export const newPlanItemRequest = (draft: NewPlanItemDraft, songFallbackTitle: string): CreatePlanItemRequest => {
  const isSong = draft.itemType === 'song';
  const arrangement = isSong && draft.song ? initialArrangementFor(draft.song.arrangements) : null;
  return {
    item_type: draft.itemType,
    title: isSong ? (draft.song?.title ?? songFallbackTitle) : draft.title.trim(),
    song_id: isSong ? (draft.song?.id ?? null) : null,
    arrangement_id: arrangement?.id ?? null,
    key_override: isSong ? draft.keyOverride : null,
    length_seconds: draft.itemType === 'header' ? 0 : (parseDuration(draft.length) ?? arrangement?.length_seconds ?? 0),
    description: draft.itemType === 'header' ? null : (draft.description.trim() || null),
  };
};

/** The first problem the add form can catch; null when it can be sent. */
export const validateNewPlanItemDraft = (draft: NewPlanItemDraft): PlanItemDraftProblem | null => {
  if (draft.itemType === 'song' && !draft.song) return 'songRequired';
  if (draft.itemType !== 'song' && !draft.title.trim()) return 'titleRequired';
  if (draft.itemType === 'header') return null;
  if (draft.length.trim() && parseDuration(draft.length) === null) return 'lengthFormat';
  const length = parseDuration(draft.length) ?? 0;
  if (length < 0 || length > MAX_ITEM_LENGTH_SECONDS) return 'lengthRange';
  return null;
};

/**
 * The full order after moving one item a step; null when it cannot move.
 * Sent whole with the plan revision, so a move made against an older order
 * is refused rather than applied to a different one.
 */
export const movedItemIds = (ids: readonly string[], index: number, direction: -1 | 1): string[] | null => {
  const target = index + direction;
  if (index < 0 || index >= ids.length || target < 0 || target >= ids.length) return null;
  const next = [...ids];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
};
