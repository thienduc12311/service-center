import type { DeliveryChannel, DeliveryStatus, DeliveryTemplate, PlanTimeRow } from './database.js';

/**
 * F08 — consolidated/scheduled release, reminder policies, durable reminder
 * jobs and per-Person delivery history.
 */
export type ReminderKind = 'pending_response' | 'confirmed_service';
export type ReminderJobStatus = 'scheduled' | 'enqueued' | 'cancelled' | 'skipped';
export type ReleaseBatchStatus = 'scheduled' | 'released' | 'cancelled' | 'failed';
/** Where an effective reminder policy came from (most specific wins). */
export type ReminderPolicySource = 'team' | 'service_type' | 'organization' | 'default';

export type ReleaseBatchRow = {
  id: string;
  organization_id: string;
  created_by: string | null;
  idempotency_key: string;
  request_hash: string;
  notify: boolean;
  scheduled_for: string;
  status: ReleaseBatchStatus;
  item_count: number;
  plan_count: number;
  effect_id: string | null;
  released_at: string | null;
  cancelled_at: string | null;
  /** `scope_changed`, `actor_not_permitted` or `internal_error`. */
  failure_code: string | null;
  created_at: string;
  updated_at: string;
}

export type ReleaseBatchItemRow = {
  batch_id: string;
  assignment_id: string;
  plan_id: string;
  expected_request_revision: number;
}

export type ReminderPolicyRow = {
  id: string;
  organization_id: string;
  service_type_id: string | null;
  team_id: string | null;
  kind: ReminderKind;
  enabled: boolean;
  offset_minutes: number;
  channels: DeliveryChannel[];
  /** Local wall-clock `HH:MM:SS` in the organization's time zone. */
  quiet_start: string | null;
  quiet_end: string | null;
  max_per_day: number;
  revision: number;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export type PersonReminderPreferencesRow = {
  person_id: string;
  organization_id: string;
  email: boolean;
  push: boolean;
  in_app: boolean;
  updated_at: string;
}

export type ReminderJobRow = {
  id: string;
  organization_id: string;
  plan_id: string;
  person_id: string;
  kind: ReminderKind;
  channel: DeliveryChannel;
  policy_id: string | null;
  policy_revision: number;
  request_version: string;
  assignment_ids: string[];
  occurrence_time_id: string | null;
  occurrence_starts_at: string;
  semantic_key: string;
  due_at: string;
  timezone: string;
  quiet_start: string | null;
  quiet_end: string | null;
  max_per_day: number;
  status: ReminderJobStatus;
  status_reason: string | null;
  effect_id: string | null;
  created_at: string;
  updated_at: string;
}

/** The policy in effect for one kind at a scope, and where it came from. */
export interface EffectiveReminderPolicy {
  kind: ReminderKind;
  policy_id: string | null;
  source: ReminderPolicySource;
  revision: number;
  enabled: boolean;
  offset_minutes: number;
  channels: DeliveryChannel[];
  quiet_start: string | null;
  quiet_end: string | null;
  max_per_day: number;
}

/** A scope's effective policies plus the explicit rows set at exactly that scope. */
export interface ReminderPolicyScopeView {
  service_type_id: string | null;
  team_id: string | null;
  effective: EffectiveReminderPolicy[];
  explicit: ReminderPolicyRow[];
  /** Whether the caller may change this scope's policies. */
  can_edit: boolean;
}

export interface ReminderPreferences {
  person_id: string;
  email: boolean;
  push: boolean;
  in_app: boolean;
}

/** One request in a multi-plan release review. */
export interface ReleaseReviewAssignment {
  assignment_id: string;
  request_revision: number;
  team_name: string;
  position_name: string | null;
  times: PlanTimeRow[];
  untimed: boolean;
}

export interface ReleaseReviewPlan {
  plan_id: string;
  plan_title: string;
  service_date: string;
  assignments: ReleaseReviewAssignment[];
}

/** Channels a recipient can or cannot be reached on, shown before release. */
export interface ReleaseReviewChannels {
  email: boolean;
  in_app: boolean;
  push: boolean;
}

/** One message per Person per batch, with a separate action per plan. */
export interface ReleaseReviewRecipient {
  person_id: string;
  person_name: string;
  channels: ReleaseReviewChannels;
  /** Channels that will be skipped, e.g. `no_email_address`, `no_login`. */
  skipped: string[];
  plans: ReleaseReviewPlan[];
}

export interface ReleaseBatchPreview {
  recipients: ReleaseReviewRecipient[];
  plan_count: number;
  assignment_count: number;
}

/** Prepared requests across upcoming plans that the caller may release. */
export interface PreparedRequestListItem {
  assignment_id: string;
  request_revision: number;
  plan_id: string;
  plan_title: string;
  service_date: string;
  person_id: string;
  person_name: string;
  team_name: string;
  position_name: string | null;
}

export interface ReleaseBatchSummary extends ReleaseBatchRow {
  plan_titles: string[];
}

export interface ReleaseBatchResult {
  batch: ReleaseBatchRow;
  /** The released rows (empty while scheduled). */
  released_assignment_ids: string[];
}

/** A scheduled/enqueued/cancelled reminder intent shown on a plan. */
export interface PlanReminderJob {
  id: string;
  person_id: string;
  person_name: string;
  kind: ReminderKind;
  channel: DeliveryChannel;
  status: ReminderJobStatus;
  status_reason: string | null;
  due_at: string;
  occurrence_starts_at: string;
  policy_source: 'policy' | 'default';
}

/** One delivery in a plan's per-Person/channel history. */
export interface PlanDeliveryHistoryItem {
  id: string;
  person_id: string;
  person_name: string;
  channel: DeliveryChannel;
  status: DeliveryStatus;
  template: DeliveryTemplate;
  error_code: string | null;
  attempts: number;
  created_at: string;
  accepted_at: string | null;
  completed_at: string | null;
  next_attempt_at: string | null;
  retryable: boolean;
  /** Retry is administrator-only; leaders see the history. */
  can_retry: boolean;
}

export interface PlanDeliveryHistory {
  reminders: PlanReminderJob[];
  deliveries: PlanDeliveryHistoryItem[];
}
