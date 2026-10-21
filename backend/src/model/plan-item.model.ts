import type { CreatePlanItemInput, PlanItemRow, PlanItemSegment, PlanItemType, UpdatePlanItemInput } from '@service-center/shared';

/** The item columns an edit may write, as sent to `update_plan_item`. */
export interface PlanItemPatch {
  item_type?: PlanItemType;
  title?: string;
  song_id?: string | null;
  arrangement_id?: string | null;
  key_override?: string | null;
  sequence_override?: string[] | null;
  length_seconds?: number;
  description?: string | null;
  leader_person_id?: string | null;
  leader_position_id?: string | null;
  service_segment?: PlanItemSegment;
}

/** The current item fields an edit is normalized against. */
export type PlanItemPatchBase = Pick<PlanItemRow, 'item_type' | 'song_id' | 'leader_person_id' | 'leader_position_id'>;

const PATCH_KEYS = [
  'item_type',
  'title',
  'song_id',
  'arrangement_id',
  'key_override',
  'sequence_override',
  'length_seconds',
  'description',
  'leader_person_id',
  'leader_position_id',
  'service_segment',
] as const satisfies ReadonlyArray<keyof PlanItemPatch>;

/**
 * Turns a validated edit into the columns to write. Edits that would leave
 * the item contradictory are completed rather than refused:
 * - a different song drops the old song's arrangement and sequence unless
 *   the edit names new ones;
 * - turning a song into another type clears its song-only fields;
 * - choosing one kind of leader clears the other.
 * Library arrangements are never part of the patch.
 */
export const buildPlanItemPatch = (input: UpdatePlanItemInput, current: PlanItemPatchBase): PlanItemPatch => {
  const patch: PlanItemPatch = {};
  for (const key of PATCH_KEYS) {
    if (input[key] !== undefined) Object.assign(patch, { [key]: input[key] });
  }

  const type = patch.item_type ?? current.item_type;
  if (type !== 'song') {
    patch.song_id = null;
    patch.arrangement_id = null;
    patch.key_override = null;
    patch.sequence_override = null;
  } else if (patch.song_id !== undefined && patch.song_id !== current.song_id) {
    if (input.arrangement_id === undefined) patch.arrangement_id = null;
    if (input.sequence_override === undefined) patch.sequence_override = null;
  }

  if (patch.leader_person_id) patch.leader_position_id = null;
  else if (patch.leader_position_id) patch.leader_person_id = null;
  return patch;
};

/** The item an add writes, as sent to `add_plan_item` (and compared on a keyed replay). */
export type PlanItemCreateBody = Omit<CreatePlanItemInput, 'idempotency_key'>;

/** The validated add without its key; the key travels separately. */
export const buildPlanItemCreateBody = (input: CreatePlanItemInput): PlanItemCreateBody => {
  const { idempotency_key: _key, ...body } = input;
  return body;
};
