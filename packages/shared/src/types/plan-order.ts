/**
 * F11: derived running-order timing and item responsibility. Nothing here is
 * stored — it is recomputed from item durations, segments and the selected
 * service time, so it can never disagree with them.
 */

import type { PlanItemSegment } from './database.js';

/** One item's planned slot against one service time. */
export interface PlannedItemTime {
  item_id: string;
  segment: PlanItemSegment;
  /** ISO instants. Equal for a header (headers consume no time). */
  starts_at: string;
  ends_at: string;
  /** Seconds from the service start; negative before it. */
  offset_seconds: number;
  duration_seconds: number;
}

/** Why a computed schedule deserves a second look; never a refusal. */
export type PlanScheduleWarningCode =
  /** A before/after item is listed among the service items. */
  | 'segment_out_of_order'
  /** Service items run past the service time's end. */
  | 'runs_over'
  /** The plan has no service time to compute against. */
  | 'no_service_time';

export interface PlanScheduleWarning {
  code: PlanScheduleWarningCode;
  item_id?: string;
  /** For `runs_over`: how long past the scheduled end. */
  seconds?: number;
}

export interface PlanSchedule {
  /** The service time the order is timed against; null without one. */
  time_id: string | null;
  service_starts_at: string | null;
  /** The service time's scheduled end, for comparison. */
  service_scheduled_end: string | null;
  /** Service start plus every service item's length. */
  planned_finish_at: string | null;
  pre_seconds: number;
  service_seconds: number;
  post_seconds: number;
  items: PlannedItemTime[];
  warnings: PlanScheduleWarning[];
}

/** `GET /plans/:id/schedule` — every service time the plan has, plus the selected one. */
export interface PlanScheduleResponse {
  content_revision: number;
  selected: PlanSchedule;
  /** Service times the order can be timed against. */
  service_times: Array<{ id: string; name: string | null; starts_at: string; ends_at: string }>;
}

/** Who leads an item, resolved against the plan's current staffing. */
export type ItemLeader =
  | { kind: 'none' }
  /** A named Person; follows the item, not the staffing. */
  | { kind: 'person'; person_id: string; name: string | null }
  /** A position on the plan; whoever currently holds it. */
  | {
      kind: 'position';
      position_id: string;
      position_name: string | null;
      /** Non-declined holders the reader can see. Empty: unfilled. */
      holders: ItemLeaderHolder[];
    };

export interface ItemLeaderHolder {
  person_id: string;
  name: string | null;
  status: 'confirmed' | 'unconfirmed';
  /** Prepared: only schedulers see it, nobody has been asked yet. */
  prepared: boolean;
}

/** The Person a direct leader resolves to, as the plan detail returns it. */
export interface PlanItemLeaderPerson {
  id: string;
  full_name: string | null;
}
