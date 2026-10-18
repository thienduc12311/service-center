/**
 * F10 saved plan templates, reusable sections and bounded plan generation.
 *
 * A template is not a plan: its content lives in immutable revisions, plans
 * receive copies, and provenance rows only point at the revision used.
 */
import type { AssignmentStatus, PlanItemType, PlanTimeKind } from './database.js';
import type { PlanSummary, PlanDetail } from './domain.js';

/** `plan`: a named plan template. `section`: reusable order items only. */
export type PlanTemplateKind = 'plan' | 'section';
export type PlanTemplateComponent = 'times' | 'notes' | 'items' | 'needs' | 'roster';
/** `replace` empties the chosen components first; roster is always appended. */
export type TemplateApplyMode = 'append' | 'replace';

export const PLAN_TEMPLATE_COMPONENTS: readonly PlanTemplateComponent[] = ['times', 'notes', 'items', 'needs', 'roster'];

/** Wall-clock intent relative to the plan's local service date. */
export interface PlanTemplateTime {
  kind: PlanTimeKind;
  name: string | null;
  /** Days from the service date (-1: the evening before). */
  day_offset: number;
  /** `HH:MM` in the organization's timezone. */
  local_start: string;
  duration_minutes: number;
}

export interface PlanTemplateItem {
  item_type: PlanItemType;
  title: string;
  song_id: string | null;
  arrangement_id: string | null;
  key_override: string | null;
  length_seconds: number;
  description: string | null;
}

export interface PlanTemplateNeed {
  position_id: string;
  needed: number;
}

/** Applied as a new prepared, unconfirmed request for every time. */
export interface PlanTemplateRosterEntry {
  person_id: string;
  team_id: string;
  position_id: string | null;
}

export interface PlanTemplateContent {
  version: 1;
  notes: string | null;
  times: PlanTemplateTime[];
  items: PlanTemplateItem[];
  needs: PlanTemplateNeed[];
  roster: PlanTemplateRosterEntry[];
}

export type PlanTemplateRow = {
  id: string;
  organization_id: string;
  service_type_id: string | null;
  kind: PlanTemplateKind;
  name: string;
  description: string | null;
  current_revision: number;
  archived_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PlanTemplateRevisionRow = {
  id: string;
  template_id: string;
  organization_id: string;
  revision: number;
  content: PlanTemplateContent;
  source_plan_id: string | null;
  source_plan_revision: number | null;
  created_by: string | null;
  created_at: string;
};

export type PlanTemplateApplicationRow = {
  id: string;
  organization_id: string;
  plan_id: string;
  template_id: string | null;
  template_revision_id: string | null;
  template_name: string;
  template_kind: PlanTemplateKind;
  template_revision: number;
  batch_id: string | null;
  mode: TemplateApplyMode;
  components: PlanTemplateComponent[];
  idempotency_key: string | null;
  request_hash: string;
  result: TemplateWriteCounts;
  created_by: string | null;
  created_at: string;
};

export type PlanGenerationBatchRow = {
  id: string;
  organization_id: string;
  template_id: string | null;
  template_revision_id: string | null;
  idempotency_key: string;
  request_hash: string;
  series: unknown;
  plan_ids: string[];
  created_by: string | null;
  created_at: string;
};

/** What one template revision holds, for lists and pickers. */
export interface PlanTemplateCounts {
  times: number;
  items: number;
  needs: number;
  roster: number;
  has_notes: boolean;
}

export interface PlanTemplateSummary extends PlanTemplateRow {
  service_type: { id: string; name: string } | null;
  /** The current revision's id (what apply/generate should use by default). */
  current_revision_id: string | null;
  counts: PlanTemplateCounts;
}

export interface PlanTemplateRevisionInfo {
  id: string;
  revision: number;
  source_plan_id: string | null;
  created_by: string | null;
  created_at: string;
}

export interface PlanTemplateDetail extends PlanTemplateSummary {
  content: PlanTemplateContent;
  revisions: PlanTemplateRevisionInfo[];
}

export interface PlanTemplateSaveResult {
  template_id: string;
  revision: number;
}

export interface TemplatePreviewNotice {
  code: string;
  message: string;
}

export type TemplateItemSkipReason = 'song_missing';
export type TemplateNeedSkipReason = 'position_missing';
export type TemplateRosterSkipReason = 'person_unavailable' | 'position_missing' | 'not_permitted';

export interface TemplateItemsPreview {
  add: PlanTemplateItem[];
  skipped: Array<{ title: string; reason: TemplateItemSkipReason }>;
  remove_count: number;
  existing_count: number;
  insert_at: number;
}

export interface TemplateResolvedTime {
  kind: PlanTimeKind;
  name: string | null;
  starts_at: string;
  ends_at: string;
  local_date: string;
  local_start: string;
}

export interface TemplateTimesPreview {
  add: TemplateResolvedTime[];
  remove_count: number;
}

export interface TemplateNotesPreview {
  action: 'none' | 'set' | 'append';
  value: string | null;
}

export interface TemplateNeedsPreview {
  add: PlanTemplateNeed[];
  /** Positions the destination already sets; its value wins on append. */
  kept: Array<{ position_id: string; needed: number; template_needed: number }>;
  skipped: Array<{ position_id: string; reason: TemplateNeedSkipReason }>;
  remove_count: number;
}

export interface TemplateRosterPreview {
  add: PlanTemplateRosterEntry[];
  skipped: Array<PlanTemplateRosterEntry & { reason: TemplateRosterSkipReason }>;
  existing_count: number;
}

export interface TemplatePreviewTemplateRef {
  id: string;
  name: string;
  kind: PlanTemplateKind;
  revision: number;
  revision_id: string;
  latest_revision: number;
}

/** Exactly what applying would do; nothing has been written. */
export interface TemplateApplyPreview {
  template: TemplatePreviewTemplateRef;
  plan_id: string | null;
  destination_revision: number | null;
  anchor_date: string;
  timezone: string;
  mode: TemplateApplyMode;
  components: PlanTemplateComponent[];
  items?: TemplateItemsPreview;
  times?: TemplateTimesPreview;
  notes?: TemplateNotesPreview;
  needs?: TemplateNeedsPreview;
  roster?: TemplateRosterPreview;
  /** Any entry here refuses the apply. */
  blocking: TemplatePreviewNotice[];
  warnings: TemplatePreviewNotice[];
}

export interface TemplateApplyPreviewResult extends TemplateApplyPreview {
  /** Send back with the apply; a different outcome is a 409. */
  preview_hash: string;
}

export interface TemplateWriteCounts {
  items: number;
  times: number;
  needs: number;
  roster: number;
}

export interface TemplateApplyCommit {
  application_id: string;
  replayed: boolean;
  result: TemplateWriteCounts;
  content_revision: number;
}

export interface TemplateApplyResult extends TemplateApplyCommit {
  plan: PlanDetail;
}

// ------------------------------------------------------------ generation --

/** Why a proposed date is not part of the batch. */
export type GenerationDateStatus = 'included' | 'excluded';

export interface GenerationExistingPlan {
  id: string;
  title: string;
}

export interface GenerationPlanPreview {
  local_date: string;
  title: string;
  service_date: string;
  preview: TemplateApplyPreview;
  /** Plans of the same service type already on this local date. */
  existing_plans: GenerationExistingPlan[];
}

export interface GenerationExcludedDate {
  local_date: string;
  reason: 'excluded' | 'skipped';
}

/** A date whose local time cannot be resolved (DST gap or fold). */
export interface GenerationDateProblem {
  local_date: string;
  message: string;
}

export interface PlanGenerationPreview {
  template_id: string;
  service_type_id: string | null;
  revision_id: string;
  timezone: string;
  plans: GenerationPlanPreview[];
  excluded: GenerationExcludedDate[];
  /** Dates that need an edit before anything can be created. */
  problems: GenerationDateProblem[];
  /** Null while `problems` is not empty. */
  preview_hash: string | null;
  max_plans: number;
}

export interface PlanGenerationCommit {
  batch_id: string;
  plan_ids: string[];
  replayed: boolean;
}

export interface PlanGenerationResult extends PlanGenerationCommit {
  plans: PlanSummary[];
}

// ------------------------------------------------- F10 Pass C: reschedule --

export interface RescheduleTimeChange {
  id: string;
  kind: PlanTimeKind;
  name: string | null;
  sort_order: number;
  from_starts_at: string;
  starts_at: string;
  ends_at: string;
  /** `YYYY-MM-DD HH:MM` in the organization's timezone. */
  from_local: string;
  to_local: string;
}

export interface ReschedulePerson {
  assignment_id: string;
  person_id: string;
  team_id: string;
  status: AssignmentStatus;
  visibility: 'prepared' | 'released';
  /** True only when the scheduler chose to reset answers. */
  resets: boolean;
}

export interface RescheduleConflict {
  person_id: string;
  plan_id: string;
  plan_title: string;
}

export interface RescheduleCounts {
  confirmed: number;
  unconfirmed: number;
  declined: number;
  prepared: number;
  responses_reset: number;
  requests_resent: number;
  links_invalidated: number;
  reminder_jobs_recalculated: number;
  calendar_entries_moved: number;
  deliveries_pending: number;
}

export interface ReschedulePlanPreview {
  plan_id: string;
  title: string;
  content_revision: number;
  staffing_revision: number;
  from_local_date: string;
  to_local_date: string;
  from_service_date: string;
  service_date: string;
  times: RescheduleTimeChange[];
  people: ReschedulePerson[];
  conflicts: RescheduleConflict[];
  counts: RescheduleCounts;
  warnings: TemplatePreviewNotice[];
}

export interface ShiftReschedulePreview {
  mode: 'shift';
  timezone: string;
  reset_responses: boolean;
  notify: boolean;
  plans: ReschedulePlanPreview[];
  preview_hash: string;
}

export interface OrderMoveRoster {
  confirmed: number;
  unconfirmed: number;
  declined: number;
  prepared: number;
}

export interface OrderOnlyReschedulePreview {
  mode: 'order_only';
  items_mode: TemplateApplyMode;
  remove_from_source: boolean;
  source: { plan_id: string; title: string; content_revision: number; items: string[] };
  destination: {
    plan_id: string;
    title: string;
    content_revision: number;
    staffing_revision: number;
    items_removed: number;
    items_kept: number;
    roster_kept: OrderMoveRoster;
  };
  /** What an order-only move never touches. */
  unchanged: string[];
  warnings: TemplatePreviewNotice[];
  preview_hash: string;
}

export type ReschedulePreview = ShiftReschedulePreview | OrderOnlyReschedulePreview;

export interface RescheduleResult {
  operation_id: string;
  replayed: boolean;
  mode: 'shift' | 'order_only';
  plan_ids: string[];
  responses_reset: number;
  effect_ids: string[];
}

export type PlanRescheduleOperationRow = {
  id: string;
  organization_id: string;
  idempotency_key: string;
  request_hash: string;
  mode: 'shift' | 'order_only';
  plan_ids: string[];
  reset_responses: boolean;
  result: unknown;
  created_by: string | null;
  created_at: string;
};
