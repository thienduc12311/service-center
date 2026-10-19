/**
 * F12: Live runs — one authoritative run of one service time, its append-only
 * transition history and audited time corrections. Countdowns, finish
 * estimates and actual durations are derived (`lib/live-run.ts`) from the
 * server timestamps stored here; nothing is written per second.
 */

import type { PlanItemSegment, PlanItemType } from './database.js';

export type LiveRunStatus = 'ready' | 'live' | 'paused' | 'ended' | 'discarded';

/**
 * What the big countdown counts down to (shown to everyone):
 * - `item`: the current item's planned length from when it became current
 *   (pauses stop it);
 * - `planned_end`: the wall-clock time the item was planned to end;
 * - `service_end`: the service time's scheduled end.
 */
export type LiveCountdownPolicy = 'item' | 'planned_end' | 'service_end';

/** Commands a client sends to `POST /runs/:id/actions`. */
export type LiveRunActionKind =
  | 'start'
  | 'advance'
  | 'jump'
  | 'pause'
  | 'resume'
  | 'end'
  | 'take_control'
  | 'take_over'
  | 'release_control'
  | 'renew'
  | 'set_policy'
  | 'refresh_snapshot'
  | 'discard';

/** What a transition row records (`renew` only extends the lease and is not recorded). */
export type LiveTransitionAction = Exclude<LiveRunActionKind, 'renew'> | 'create';

/** Transitions that move the clock; only these can be corrected. */
export type LiveTimingAction = 'start' | 'advance' | 'jump' | 'pause' | 'resume' | 'end';

/** One item of the order as the run pinned it. No people, notes or files. */
export interface LiveRunSnapshotItem {
  id: string;
  item_type: PlanItemType;
  title: string;
  length_seconds: number;
  service_segment: PlanItemSegment;
  song_id: string | null;
  key_override: string | null;
  description: string | null;
}

/** A `type` (not an interface) so it satisfies supabase-js's row constraint. */
export type LiveRunRow = {
  id: string;
  organization_id: string;
  plan_id: string;
  /** Null once the service time is deleted; the time fields below remain. */
  plan_time_id: string | null;
  time_name: string | null;
  time_starts_at: string;
  time_ends_at: string;
  status: LiveRunStatus;
  countdown_policy: LiveCountdownPolicy;
  snapshot: LiveRunSnapshotItem[];
  /** The plan's `content_revision` the snapshot was taken at. */
  snapshot_revision: number;
  snapshot_at: string;
  current_index: number | null;
  current_started_at: string | null;
  paused_at: string | null;
  /** Paused milliseconds already accumulated on the current item. */
  current_paused_ms: number;
  started_at: string | null;
  ended_at: string | null;
  revision: number;
  controller_user_id: string | null;
  /** The controlling client instance (one browser tab / device session). */
  controller_client_id: string | null;
  controller_name: string | null;
  controller_lease_expires_at: string | null;
  discarded_reason: string | null;
  idempotency_key: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** A `type` (not an interface) so it satisfies supabase-js's row constraint. */
export type LiveRunTransitionRow = {
  id: number;
  run_id: string;
  organization_id: string;
  /** The run's revision after this transition. */
  revision: number;
  action: LiveTransitionAction;
  from_index: number | null;
  to_index: number | null;
  item_id: string | null;
  status_after: LiveRunStatus;
  occurred_at: string;
  actor_user_id: string | null;
  actor_name: string | null;
  client_action_id: string | null;
  reason: string | null;
  details: Record<string, unknown>;
};

/** A `type` (not an interface) so it satisfies supabase-js's row constraint. */
export type LiveRunCorrectionRow = {
  id: number;
  run_id: string;
  organization_id: string;
  transition_id: number;
  revision: number;
  previous_at: string;
  corrected_at: string;
  reason: string;
  actor_user_id: string | null;
  actor_name: string | null;
  created_at: string;
};

/** What `create_live_run`, `live_run_action` and `correct_live_run_time` return. */
export interface LiveRunCommandResult {
  run: LiveRunRow;
  /** True when the same request/action id had already been applied; nothing changed. */
  replayed: boolean;
}

/** The run as clients see it: the idempotency key stays on the server. */
export type LiveRun = Omit<LiveRunRow, 'idempotency_key'>;

/** What `live_run_state` returns: the visible run plus the database clock and plan context. */
export interface LiveRunStateRecord {
  run: LiveRun;
  server_now: string;
  plan_content_revision: number;
  /** The run's service time as it is now; null once deleted. */
  time: { id: string; starts_at: string; ends_at: string } | null;
  can_control: boolean;
}

export type LiveRunWarningCode =
  /** The plan order changed after the snapshot was pinned. */
  | 'plan_changed_since_snapshot'
  /** The service time was moved after the run was created. */
  | 'service_time_moved'
  /** The service time no longer exists on the plan. */
  | 'service_time_removed';

export interface LiveRunWarning {
  code: LiveRunWarningCode;
}

/** `GET /runs/:id/state` and every action response. */
export interface LiveRunState {
  run: LiveRun;
  /** Server clock when the state was read; clients derive their clock offset from it. */
  server_now: string;
  /** The plan's current order revision (compare with `run.snapshot_revision`). */
  plan_content_revision: number;
  warnings: LiveRunWarning[];
  /** The caller may control Live on this plan (still subject to the lease). */
  can_control: boolean;
  /** Present on an action response: the command was a repeat and changed nothing. */
  replayed?: boolean;
}

/** One planned-versus-actual line. */
export interface LiveItemActual {
  item_id: string;
  index: number;
  title: string;
  item_type: PlanItemType;
  segment: PlanItemSegment;
  planned_seconds: number;
  /** Seconds it was current while the run was not paused. */
  actual_seconds: number;
  /** When it first became current; null if it never did. */
  first_started_at: string | null;
  /** actual − planned, for items that ran; null otherwise. */
  variance_seconds: number | null;
  /** How many times it became current (a jump back counts again). */
  visits: number;
}

export interface LiveRunActuals {
  started_at: string | null;
  ended_at: string | null;
  /** End − start, including pauses. */
  elapsed_seconds: number | null;
  paused_seconds: number;
  planned_service_seconds: number;
  actual_service_seconds: number;
  items: LiveItemActual[];
  /** At least one transition time was corrected. */
  corrected: boolean;
}

/** `GET /runs/:id/history`: history, corrections and derived actuals. */
export interface LiveRunHistory {
  run: LiveRun;
  transitions: LiveRunTransitionRow[];
  corrections: LiveRunCorrectionRow[];
  actuals: LiveRunActuals;
  server_now: string;
  can_control: boolean;
}

/** A run in the plan's run list. */
export interface LiveRunSummary {
  id: string;
  plan_time_id: string | null;
  time_name: string | null;
  time_starts_at: string;
  time_ends_at: string;
  status: LiveRunStatus;
  started_at: string | null;
  ended_at: string | null;
  revision: number;
  snapshot_revision: number;
  controller_name: string | null;
  controller_lease_expires_at: string | null;
  discarded_reason: string | null;
  created_at: string;
}

/** A service time of the plan and its current (non-discarded) run, if any. */
export interface LiveServiceTimeOption {
  id: string;
  name: string | null;
  starts_at: string;
  ends_at: string;
  run_id: string | null;
  run_status: LiveRunStatus | null;
}

/** `GET /plans/:id/runs`. */
export interface LivePlanRuns {
  service_times: LiveServiceTimeOption[];
  /** Every run of the plan, newest first, discarded ones included. */
  runs: LiveRunSummary[];
  plan_content_revision: number;
  can_control: boolean;
  server_now: string;
}

/** Derived for display from a run and the (offset-corrected) current time. */
export interface LiveView {
  status: LiveRunStatus;
  current: LiveRunSnapshotItem | null;
  current_index: number | null;
  next: LiveRunSnapshotItem | null;
  next_index: number | null;
  /** The header the current item sits under. */
  section: string | null;
  /** Seconds the current item has run (pauses excluded). */
  elapsed_seconds: number;
  /** Seconds left by the run's policy; null when nothing counts down (no length, not running). */
  remaining_seconds: number | null;
  /** Seconds past the countdown target; 0 when not over. */
  overrun_seconds: number;
  countdown_policy: LiveCountdownPolicy;
  /** Planned end of the service segment for this occurrence. */
  planned_finish_at: string | null;
  /** Now plus what is left of the service items; null before start or once only after-service items remain. */
  projected_finish_at: string | null;
  /** projected − planned; positive means running late. */
  finish_delta_seconds: number | null;
}

/** Whether a client (user + client instance) holds the run's controller lease. */
export interface LiveControlStatus {
  held_by_you: boolean;
  /** Someone holds a lease that has not expired. */
  held: boolean;
  holder_name: string | null;
  /** Seconds until the lease lapses; null without one. */
  lease_seconds_left: number | null;
}
