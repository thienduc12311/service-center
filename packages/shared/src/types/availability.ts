// F03 — availability preferences, freshness, availability requests,
// explicit delegation and opted-in cross-organization schedules.
// Row types mirror supabase/migrations/20261019000200..400; domain types are
// the composed shapes the API returns.

import type { AssignmentStatus, PlanTimeKind } from './database.js';

// ----------------------------------------------------------------- rows ---

export type SchedulingFrequency = 'every_week' | 'every_other_week' | 'every_third_week' | 'once_a_month';

export type SchedulingPreferenceRow = {
  id: string;
  organization_id: string;
  person_id: string;
  /** Null: applies to every team the person serves on. */
  team_id: string | null;
  frequency: SchedulingFrequency | null;
  max_per_month: number | null;
  /** Week of month, 1–5 (days 1–7 are week 1). */
  preferred_weeks: number[];
  avoided_weeks: number[];
  /** Local dates, YYYY-MM-DD. */
  preferred_dates: string[];
  avoided_dates: string[];
  /** Local start times of service times, HH:MM:SS. */
  preferred_times: string[];
  revision: number;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AvailabilityReviewKind = 'changed' | 'affirmed';

export type PersonAvailabilityReviewRow = {
  person_id: string;
  organization_id: string;
  reviewed_at: string;
  kind: AvailabilityReviewKind;
  reviewed_by: string | null;
};

export type AvailabilityRequestRow = {
  id: string;
  organization_id: string;
  team_id: string | null;
  message: string | null;
  window_start: string;
  window_end: string;
  respond_by: string | null;
  recipient_count: number;
  idempotency_key: string;
  created_by: string | null;
  created_at: string;
};

export type AvailabilityRequestRecipientRow = {
  request_id: string;
  organization_id: string;
  person_id: string;
  responded_at: string | null;
  response_kind: AvailabilityReviewKind | null;
};

export type AssignmentPreferenceOverrideRow = {
  id: string;
  organization_id: string;
  assignment_id: string;
  warning_codes: string[];
  reason: string | null;
  created_by: string | null;
  created_at: string;
};

export type ScheduleDelegationRow = {
  id: string;
  organization_id: string;
  target_person_id: string;
  delegate_person_id: string;
  granted_by: string | null;
  can_respond: boolean;
  can_view_schedule: boolean;
  can_manage_availability: boolean;
  /** Reserved for F07 signups; nothing consumes it yet. */
  can_signup: boolean;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  created_at: string;
};

export type ScheduleDelegationEventKind = 'granted' | 'revoked' | 'responded' | 'availability_changed';

export type ScheduleDelegationEventRow = {
  id: string;
  organization_id: string;
  delegation_id: string;
  actor_id: string | null;
  event: ScheduleDelegationEventKind;
  detail: Record<string, unknown>;
  created_at: string;
};

export type UserScheduleSettingsRow = {
  user_id: string;
  combined_schedule: boolean;
  share_busy_across_orgs: boolean;
  updated_at: string;
};

// -------------------------------------------------------------- domain ----

/** Typed, non-blocking scheduling warnings. Blockouts stay hard conflicts. */
export type PreferenceWarningCode =
  | 'frequency'
  | 'monthly_max'
  | 'avoided_date'
  | 'avoided_week'
  | 'outside_preferred_weeks'
  | 'outside_preferred_dates'
  | 'time_not_preferred'
  | 'availability_unknown'
  | 'availability_stale'
  | 'busy_elsewhere';

/**
 * The values behind a warning's English `detail`, so clients can word it in
 * the viewer's language. Which fields are set depends on `code`.
 */
export interface PreferenceWarningParams {
  /** `frequency`: the person's preferred rhythm. */
  frequency?: SchedulingFrequency;
  /** `monthly_max`: plans already served this month, and the stated maximum. */
  served?: number;
  max?: number;
  /** `avoided_week`: week of the month (1–5). */
  week?: number;
  /** `availability_stale`: last review, as a calendar date in the organization's zone. */
  reviewed_on?: string;
}

export interface PreferenceWarning {
  person_id: string;
  code: PreferenceWarningCode;
  /** English sentence, kept for older clients; translate `code` + `params` instead. */
  detail: string;
  params: PreferenceWarningParams;
  /** Which preference row produced it; null for all-teams/freshness/external. */
  preference_team_id: string | null;
}

/**
 * Whether a leader can rely on a person's availability: never reviewed,
 * reviewed long ago (or before the latest request), or current.
 */
export type AvailabilityFreshness = 'unknown' | 'stale' | 'current';

export interface AvailabilityReviewStatus {
  person_id: string;
  reviewed_at: string | null;
  kind: AvailabilityReviewKind | null;
  freshness: AvailabilityFreshness;
}

export interface AvailabilityAudienceMember {
  person_id: string;
  first_name: string;
  last_name: string | null;
  has_login: boolean;
  has_email: boolean;
  reviewed_at: string | null;
  review_kind: AvailabilityReviewKind | null;
  freshness: AvailabilityFreshness;
}

export interface AvailabilityRequestSummary extends AvailabilityRequestRow {
  team_name: string | null;
  responded_count: number;
}

export interface AvailabilityRequestRecipient {
  person_id: string;
  name: string;
  responded_at: string | null;
  response_kind: AvailabilityReviewKind | null;
  reviewed_at: string | null;
  freshness: AvailabilityFreshness;
}

export interface AvailabilityRequestDetail {
  request: AvailabilityRequestSummary;
  recipients: AvailabilityRequestRecipient[];
}

export interface CreateAvailabilityRequestResult {
  request_id: string;
  effect_id: string | null;
  replayed: boolean;
}

/** An open request addressed to the signed-in person. */
export interface MyAvailabilityRequest {
  request_id: string;
  message: string | null;
  window_start: string;
  window_end: string;
  respond_by: string | null;
  created_at: string;
}

export type DelegationDirection = 'given' | 'received';

export interface DelegationRights {
  can_respond: boolean;
  can_view_schedule: boolean;
  can_manage_availability: boolean;
  can_signup: boolean;
}

export interface DelegationSummary extends DelegationRights {
  id: string;
  direction: DelegationDirection;
  /** The person whose schedule it is. */
  target_person_id: string;
  target_name: string;
  /** The helper. */
  delegate_person_id: string;
  delegate_name: string;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  /** Active right now (not revoked, not expired). */
  active: boolean;
}

export interface DelegatedScheduleTime {
  id: string;
  kind: PlanTimeKind;
  name: string | null;
  starts_at: string;
  ends_at: string;
}

export interface DelegatedScheduleEntry {
  assignment_id: string;
  status: AssignmentStatus;
  plan_id: string;
  plan_title: string;
  service_date: string;
  location: string | null;
  team_name: string | null;
  position_name: string | null;
  times: DelegatedScheduleTime[];
}

export interface DelegatedSchedule {
  delegation: DelegationSummary;
  entries: DelegatedScheduleEntry[];
}

export interface DelegatedResponseResult {
  assignment_id: string;
  status: AssignmentStatus;
  transition: 'response' | 'withdrawal' | 'unchanged';
}

export type CombinedScheduleItemKind = 'assignment' | 'blockout';

export interface CombinedScheduleItem {
  kind: CombinedScheduleItemKind;
  item_id: string;
  title: string;
  status: AssignmentStatus | null;
  starts_at: string;
  ends_at: string;
  plan_id: string | null;
}

/** One organization's part of a combined schedule, read independently. */
export interface CombinedScheduleOrganization {
  organization_id: string;
  organization_name: string;
  status: 'ok' | 'error';
  error: string | null;
  items: CombinedScheduleItem[];
}

export interface CombinedSchedule {
  from: string;
  to: string;
  organizations: CombinedScheduleOrganization[];
}

export type CopyAvailabilityOutcome = 'copied' | 'already_copied' | 'not_member' | 'failed';

export interface CopyAvailabilityTargetResult {
  organization_id: string;
  outcome: CopyAvailabilityOutcome;
  copied: number;
  error: string | null;
}

export interface CopyAvailabilityResult {
  results: CopyAvailabilityTargetResult[];
}
