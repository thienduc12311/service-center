import type { AssignmentStatus, AssignmentVisibility } from './database.js';

/**
 * F06 — deterministic, explainable staffing proposals and team rotations.
 *
 * A proposal is computed from an immutable snapshot of authorized inputs, so
 * the same snapshot + rule version + seed + reviewer edits always produce the
 * same choices and explanations. The engine is pure and never reads live state.
 */

/** Bump whenever the engine's ordering or exclusion semantics change. */
export const STAFFING_PROPOSAL_RULE_VERSION = 'f06.fairness.v1' as const;
export type StaffingProposalRuleVersion = typeof STAFFING_PROPOSAL_RULE_VERSION;

export type RotationSubstitutePolicy = 'vacancy' | 'fairness';

/** Hard reasons a candidate cannot fill a slot. Never overridden by the engine. */
export type ProposalExclusionCode =
  | 'not_position_member'
  | 'blockout'
  | 'overlapping_commitment'
  | 'already_on_plan'
  | 'already_chosen_on_plan'
  | 'excluded_by_reviewer';

/** Why the engine picked (or kept) someone for a slot. */
export type ProposalChoiceSource = 'existing' | 'locked' | 'rotation' | 'fairness';

/** Reasons an open slot stays open. The first applicable code is the binding one. */
export type ProposalVacancyCode =
  | 'no_position_members'
  | 'all_candidates_excluded'
  | 'locked_choice_invalid'
  | 'rotation_member_unavailable'
  | 'rotation_member_missing';

export type ProposalWarningCode =
  | 'preference'
  | 'rotation_member_unavailable'
  | 'rotation_member_missing'
  | 'rotation_exception'
  | 'locked_choice_invalid'
  | 'snapshot_truncated';

// ------------------------------------------------------------- snapshot --

export interface ProposalSnapshotNeed {
  team_id: string;
  position_id: string;
  needed: number;
}

export interface ProposalSnapshotPlan {
  id: string;
  title: string;
  service_date: string;
  /** Civil date of the service in the organization's IANA zone (rotation weeks use it). */
  local_date: string;
  service_type_id: string | null;
  staffing_revision: number;
  needs: ProposalSnapshotNeed[];
}

export interface ProposalSnapshotPerson {
  id: string;
  full_name: string;
}

export interface ProposalSnapshotMembership {
  person_id: string;
  team_id: string;
  position_id: string;
}

export interface ProposalSnapshotAssignment {
  id: string;
  plan_id: string;
  person_id: string;
  team_id: string;
  position_id: string | null;
  status: AssignmentStatus;
  visibility: AssignmentVisibility;
}

/** A hard conflict at snapshot time, redacted to a code (never a blockout reason or another plan title). */
export interface ProposalSnapshotUnavailability {
  person_id: string;
  plan_id: string;
  code: 'blockout' | 'overlapping_commitment';
}

/** A soft F03 preference warning; never excludes, only lowers priority. */
export interface ProposalSnapshotPreference {
  person_id: string;
  plan_id: string;
  team_id: string;
  codes: string[];
}

/** One caller-visible, non-declined plan someone served on (any team). */
export interface ProposalSnapshotServing {
  person_id: string;
  plan_id: string;
  service_date: string;
}

export interface ProposalSnapshotRotationSlot {
  week_index: number;
  position_id: string;
  person_id: string;
}

export interface ProposalSnapshotRotationException {
  local_date: string;
  position_id: string;
  /** `null` = no rotation choice that date (fairness decides). */
  person_id: string | null;
}

export interface ProposalSnapshotRotation {
  id: string;
  team_id: string;
  name: string;
  revision: number;
  cycle_weeks: number;
  anchor_date: string;
  substitute_policy: RotationSubstitutePolicy;
  slots: ProposalSnapshotRotationSlot[];
  exceptions: ProposalSnapshotRotationException[];
}

export interface StaffingProposalSnapshot {
  rule_version: StaffingProposalRuleVersion;
  organization_id: string;
  time_zone: string;
  captured_at: string;
  lookback_days: number;
  team_ids: string[];
  plans: ProposalSnapshotPlan[];
  people: ProposalSnapshotPerson[];
  memberships: ProposalSnapshotMembership[];
  assignments: ProposalSnapshotAssignment[];
  unavailable: ProposalSnapshotUnavailability[];
  preferences: ProposalSnapshotPreference[];
  serving: ProposalSnapshotServing[];
  rotations: ProposalSnapshotRotation[];
}

// ---------------------------------------------------- reviewer edits --

/** Pin a person to one slot (plan × position × ordinal). Survives recomputation. */
export interface ProposalLock {
  plan_id: string;
  position_id: string;
  person_id: string;
}

/** Keep a person out of one plan × position (reviewer choice). */
export interface ProposalExclusion {
  plan_id: string;
  position_id: string;
  person_id: string;
}

export interface StaffingProposalEdits {
  locks: ProposalLock[];
  exclusions: ProposalExclusion[];
}

// --------------------------------------------------------------- result --

export interface ProposalFairnessMetrics {
  /** Plans served in the lookback window before this plan, including earlier proposal choices. */
  assigned_count: number;
  last_served_on: string | null;
  /** Stable hex tie-break derived from the recorded seed. */
  tie_break: string;
  has_preference_warning: boolean;
}

export interface ProposalCandidateExplanation {
  person_id: string;
  person_name: string;
  excluded: ProposalExclusionCode | null;
  metrics: ProposalFairnessMetrics | null;
}

/** How the fairness ranking separated the chosen person from the runner-up. */
export type ProposalTieBreak = 'preference_warnings' | 'fewer_plans_served' | 'served_less_recently' | 'seeded_tie_break';

/** One explanation line for a choice, as data (the English `reasons` mirror these). */
export type ProposalReasonDetail =
  | { code: 'kept_existing'; state: AssignmentStatus | 'prepared' }
  | { code: 'locked' }
  | { code: 'rotation_week'; rotation_name: string; week: number; cycle_weeks: number }
  | { code: 'rotation_exception'; rotation_name: string; date: string }
  | { code: 'all_have_preference_warnings' }
  | { code: 'no_preference_warnings' }
  | { code: 'served_count'; count: number; lookback_days: number; last_served_on: string | null }
  | { code: 'chosen_over'; person_id: string; person_name: string; decided_by: ProposalTieBreak };

/** Values behind a vacancy's or warning's English text. */
export interface ProposalTextParams {
  person_id?: string;
  person_name?: string;
  plan_title?: string;
  /** Local service date (YYYY-MM-DD). */
  date?: string;
  rotation_name?: string;
  exclusion?: ProposalExclusionCode;
  preference_codes?: string[];
  /** `rotation_exception` warnings: whether the rotation is skipped that day. */
  skipped?: boolean;
}

export interface ProposalChoice {
  slot_key: string;
  plan_id: string;
  team_id: string;
  position_id: string;
  person_id: string;
  person_name: string;
  source: ProposalChoiceSource;
  /** Existing request id when `source = 'existing'`. */
  assignment_id: string | null;
  assignment_status: AssignmentStatus | null;
  assignment_visibility: AssignmentVisibility | null;
  metrics: ProposalFairnessMetrics | null;
  /** English explanations, kept for stored proposals and older clients. */
  reasons: string[];
  /** The same explanations as data. Absent on proposals computed before it existed. */
  reason_details?: ProposalReasonDetail[];
  preference_codes: string[];
  /** Up to 5 next-best eligible people, best first, for adjusting. */
  alternatives: ProposalCandidateExplanation[];
}

export interface ProposalVacancy {
  slot_key: string;
  plan_id: string;
  team_id: string;
  position_id: string;
  code: ProposalVacancyCode;
  /** English sentence, kept for stored proposals and older clients. */
  reason: string;
  params?: ProposalTextParams;
  /** How many members were excluded, per hard reason. */
  exclusion_counts: Partial<Record<ProposalExclusionCode, number>>;
}

export interface ProposalWarning {
  code: ProposalWarningCode;
  plan_id: string | null;
  position_id: string | null;
  person_id: string | null;
  /** English sentence, kept for stored proposals and older clients. */
  message: string;
  params?: ProposalTextParams;
}

export interface StaffingProposalResult {
  rule_version: StaffingProposalRuleVersion;
  seed: string;
  choices: ProposalChoice[];
  vacancies: ProposalVacancy[];
  warnings: ProposalWarning[];
  summary: { slots: number; existing: number; proposed: number; vacant: number };
}

// --------------------------------------------------------- persisted API --

export type StaffingProposalStatus = 'draft' | 'committed' | 'superseded';

export interface StaffingProposalPlanSummary {
  id: string;
  title: string;
  service_date: string;
  local_date: string;
  staffing_revision: number;
}

export interface StaffingProposalNames {
  teams: Record<string, string>;
  positions: Record<string, string>;
}

export interface StaffingProposal {
  id: string;
  status: StaffingProposalStatus;
  revision: number;
  rule_version: StaffingProposalRuleVersion;
  seed: string;
  input_hash: string;
  author_id: string;
  created_at: string;
  expires_at: string;
  expired: boolean;
  committed_at: string | null;
  superseded_by: string | null;
  lookback_days: number;
  team_ids: string[];
  plans: StaffingProposalPlanSummary[];
  names: StaffingProposalNames;
  rotations: Array<{ id: string; name: string; revision: number; team_id: string }>;
  edits: StaffingProposalEdits;
  result: StaffingProposalResult;
  /** Human description of the actual ordering policy (shown verbatim). */
  policy: string[];
  commit_result: StaffingProposalCommitResult | null;
}

export interface StaffingProposalCommitResult {
  proposal_id: string;
  committed_at: string;
  assignment_ids: string[];
  affected_plan_ids: string[];
  /** Always `prepared`; release is a separate F08/F01 action. */
  visibility: 'prepared';
}

// ------------------------------------------------------------- rotations --

export interface TeamRotationSlot {
  week_index: number;
  position_id: string;
  person_id: string;
}

export interface TeamRotationException {
  local_date: string;
  position_id: string;
  person_id: string | null;
  note: string | null;
}

export interface TeamRotation {
  id: string;
  organization_id: string;
  team_id: string;
  name: string;
  cycle_weeks: number;
  anchor_date: string;
  substitute_policy: RotationSubstitutePolicy;
  revision: number;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  slots: TeamRotationSlot[];
  exceptions: TeamRotationException[];
}

export interface RotationPreviewEntry {
  plan_id: string;
  plan_title: string;
  service_date: string;
  local_date: string;
  week_index: number;
  position_id: string;
  person_id: string | null;
  person_name: string | null;
  source: 'pattern' | 'exception' | 'skipped';
  /** Why the rotation's person would not be used as-is. */
  issue: 'not_position_member' | 'blockout' | 'overlapping_commitment' | null;
}
