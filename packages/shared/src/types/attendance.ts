/**
 * F04 — assignment-specific attendance times and accurate conflicts.
 *
 * The database resolver (`private.assignment_attendance`) is the single
 * definition of which intervals an assignment commits a Person to; these are
 * the shapes the API returns from it.
 */
import type {
  AssignmentAttendanceMode,
  AssignmentStatus,
  AssignmentVisibility,
  PlanTimeKind,
} from './database.js';

/**
 * `plan_time` is a real stored time. `untimed_fallback` exists only for a plan
 * with no times at all: service date + 2 hours, always shown as approximate.
 */
export type AttendanceIntervalSource = 'plan_time' | 'untimed_fallback';

/** One interval an assignment commits its Person to. */
export interface AttendanceInterval {
  assignment_id: string;
  /** Null only for `untimed_fallback`. */
  plan_time_id: string | null;
  kind: PlanTimeKind;
  name: string | null;
  starts_at: string;
  ends_at: string;
  source: AttendanceIntervalSource;
}

export type ConflictKind = 'blockout' | 'overlapping_commitment';

/**
 * `blocking` needs an authorized, reasoned override to commit. `warning` is a
 * second position on the same plan at an overlapping time: shown, not blocking.
 */
export type ConflictSeverity = 'blocking' | 'warning';

/**
 * One collision between a candidate's interval and something already there.
 * `detail` is redacted: blockout reasons are never returned, and a commitment
 * on a plan the caller cannot schedule or edit reads "Another commitment"
 * with no plan or assignment id.
 */
export type AttendanceConflict = {
  candidate_key: string;
  person_id: string;
  kind: ConflictKind;
  severity: ConflictSeverity;
  /** The candidate's own time; null when it is an untimed fallback. */
  plan_time_id: string | null;
  interval_source: AttendanceIntervalSource;
  /** The overlapping part only. */
  starts_at: string;
  ends_at: string;
  other_plan_id: string | null;
  other_assignment_id: string | null;
  other_plan_time_id: string | null;
  other_time_kind: PlanTimeKind | null;
  detail: string;
  redacted: boolean;
  /** Present on API checks: whether the caller may schedule over it. */
  override_permitted?: boolean;
}

export interface ConflictCheckResult {
  conflicts: AttendanceConflict[];
  /** Candidates (by key) with at least one blocking conflict. */
  blocked_candidates: string[];
  /** True when every blocked candidate may be overridden by the caller. */
  override_permitted: boolean;
}

/** Audit row: a request committed over a real conflict. */
export type AssignmentConflictOverrideRow = {
  id: string;
  organization_id: string;
  assignment_id: string | null;
  person_id: string;
  plan_id: string;
  team_id: string | null;
  conflicts: AttendanceConflict[];
  reason: string;
  actor_id: string | null;
  transaction_id: number;
  created_at: string;
}

/** Per-Person calendar sequencing for one plan time (F04). */
export type AttendanceCalendarStateRow = {
  person_id: string;
  plan_time_id: string;
  organization_id: string;
  applicable: boolean;
  sequence_offset: number;
  updated_at: string;
}

export type PlanTimeChangeKind = 'added' | 'removed' | 'changed' | 'renamed' | 'unchanged';

export interface PlanTimeImpactTime {
  id: string;
  change: PlanTimeChangeKind;
  kind: PlanTimeKind;
  name: string | null;
  starts_at: string;
  ends_at: string;
  previous_starts_at: string | null;
  previous_ends_at: string | null;
}

/** How one request's attendance would move. Ids are plan time ids. */
export interface PlanTimeImpactAssignment {
  assignment_id: string;
  person_id: string;
  team_id: string | null;
  position_id: string | null;
  status: AssignmentStatus;
  visibility: AssignmentVisibility;
  attendance_mode: AssignmentAttendanceMode;
  request_revision: number;
  gains: string[];
  loses: string[];
  changed: string[];
  /** Attendance after the change. */
  after: string[];
  /** A selected request left with no time; the commit must resolve it. */
  orphaned: boolean;
  /** Filled in by the API for display. */
  person_name?: string;
  team_name?: string | null;
  position_name?: string | null;
}

/** What a proposed full time list would do, before it is saved. */
export interface PlanTimeImpact {
  plan_id: string;
  content_revision: number;
  /** Echo it on commit; any change in who is affected makes the commit 409. */
  impact_hash: string;
  was_untimed: boolean;
  becomes_untimed: boolean;
  times: PlanTimeImpactTime[];
  /** Requests the caller schedules; others are only counted. */
  assignments: PlanTimeImpactAssignment[];
  hidden_affected: number;
  /** Outstanding response requests that will have to be answered again. */
  live_requests: number;
  /** People who will receive an updated request. */
  notify_people: number;
  /** Informational: new overlaps the moved/added times would create. */
  conflicts: AttendanceConflict[];
}

export type OrphanResolutionAction = 'all' | 'remove';

export interface PlanTimeChangeResult {
  invalidated_requests: number;
  notified_assignment_ids: string[];
  effect_id: string | null;
}
