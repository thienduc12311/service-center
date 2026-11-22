import type { PlanItemRow } from './database.js';

/** One service time an item is limited to, as embedded in the plan detail. */
export interface PlanItemTimeRef {
  plan_time_id: string;
}

/** What "Bring notes from last time" copied when a song was added. */
export interface PlanItemNotesCarried {
  /** Notes copied (only notes the person adding could read). */
  count: number;
  /** The plan the notes came from. */
  source_plan_id: string;
  /** That plan's service date. */
  service_date: string;
}

/**
 * `GET /plans/:id/songs/:songId/last-use`: the song's most recent earlier use
 * in the plan's service type, and how many of its item notes the caller can
 * read. `null` when the song was not used before.
 */
export interface SongLastUse {
  plan_id: string;
  plan_title: string;
  service_date: string;
  item_id: string;
  note_count: number;
}

/** A saved item as the item endpoints return it: the row, its limits and the plan's new revision. */
export type SavedPlanItem = PlanItemRow & {
  content_revision: number;
  item_times?: PlanItemTimeRef[];
};

/** An added item; `carried_notes` is set when notes were brought from the song's last use. */
export type AddedPlanItem = SavedPlanItem & {
  carried_notes?: PlanItemNotesCarried | null;
};
