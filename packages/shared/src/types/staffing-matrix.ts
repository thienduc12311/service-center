import type { AssignmentAttendanceMode, AssignmentStatus, AssignmentVisibility, PlanTimeKind } from './database.js';
import type { AttendanceConflict } from './attendance.js';
import type { PreferenceWarning } from './availability.js';

export interface StaffingMatrixFilters {
  from: string;
  to: string;
  service_type_ids: string[];
  team_ids: string[];
  plan_ids: string[];
  search: string | null;
}

export interface StaffingMatrixPlan {
  id: string;
  title: string;
  service_date: string;
  service_type_id: string | null;
  service_type_name: string | null;
  staffing_revision: number;
  times: Array<{ id: string; kind: PlanTimeKind; name: string | null; starts_at: string; ends_at: string }>;
  needs: Array<{ team_id: string; team_name: string; position_id: string; position_name: string; needed: number }>;
}

export interface StaffingMatrixPerson {
  id: string;
  full_name: string;
  avatar_url: string | null;
  campus: string | null;
  recent_serving_count: number;
  last_served_at: string | null;
}

export interface StaffingMatrixAssignment {
  id: string;
  plan_id: string;
  person_id: string;
  team_id: string;
  team_name: string;
  position_id: string | null;
  position_name: string | null;
  status: AssignmentStatus;
  visibility: AssignmentVisibility;
  request_revision: number;
  attendance_mode: AssignmentAttendanceMode;
  time_ids: string[];
}

export interface StaffingMatrixConflictCell {
  key: string;
  person_id: string;
  plan_id: string;
  conflicts: AttendanceConflict[];
}

export interface StaffingMatrixPage {
  plans: StaffingMatrixPlan[];
  people: StaffingMatrixPerson[];
  assignments: StaffingMatrixAssignment[];
  conflicts: StaffingMatrixConflictCell[];
  next_cursor: string | null;
}

export interface StaffingMatrixSavedView {
  id: string;
  name: string;
  filters: StaffingMatrixFilters;
  created_at: string;
  updated_at: string;
}

export type StaffingMatrixAction =
  | { kind: 'assign'; plan_id: string; person_id: string; team_id: string; position_id: string | null; visibility: AssignmentVisibility; attendance_mode: AssignmentAttendanceMode; time_ids: string[]; notify: boolean }
  | { kind: 'remove'; plan_id: string; assignment_id: string; expected_request_revision: number }
  | { kind: 'copy'; source_assignment_id: string; expected_source_revision: number; destination_plan_id: string; destination_attendance_mode: AssignmentAttendanceMode; destination_time_ids: string[]; visibility: AssignmentVisibility; notify: boolean }
  | { kind: 'release'; plan_id: string; assignment_id: string; expected_request_revision: number; notify: boolean };

export interface StaffingMatrixPlanRevision {
  plan_id: string;
  staffing_revision: number;
}

export interface StaffingMatrixPreviewItem {
  index: number;
  action: StaffingMatrixAction;
  person_id: string;
  person_name: string;
  plan_id: string;
  plan_title: string;
  delivery_intent: 'none' | 'assignment_request';
  conflicts: AttendanceConflict[];
  /** English sentences, kept for older clients. */
  warnings: string[];
  /** The same warnings as data, in the same order. */
  warning_details: StaffingMatrixWarning[];
}

/** A staffing-matrix preview warning a client can word in the viewer's language. */
export type StaffingMatrixWarning =
  | { kind: 'preference'; warning: PreferenceWarning }
  | { kind: 'copy_resets_answers' }
  | { kind: 'team_unavailable' };

export interface StaffingMatrixPreview {
  operation_id: string;
  base_revisions: StaffingMatrixPlanRevision[];
  actions: StaffingMatrixAction[];
  items: StaffingMatrixPreviewItem[];
  has_blocking_conflicts: boolean;
}

export interface StaffingMatrixCommitResult {
  operation_id: string;
  committed_at: string;
  assignment_ids: string[];
  affected_plan_ids: string[];
  /** The consolidated release-batch effect (at most one per commit). */
  delivery_effect_ids: string[];
  /** F08 release batches the commit's release cells went through. Absent on commits stored before batching. */
  release_batch_ids?: string[];
}
