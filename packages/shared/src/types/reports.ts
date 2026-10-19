/**
 * F16 — actual attendance, operational reports and exports, scoped calendar
 * feeds/layers and public plan publication.
 *
 * Attendance is what actually happened at one plan time. It is never derived
 * from, and never changes, a request's answer (confirmation is planned
 * participation). Reports always say which of the two they count.
 */
import type { AssignmentStatus, PlanStatus, PlanTimeKind } from './database.js';

// ================================================================ attendance

export type AttendanceStatus = 'present' | 'absent' | 'unknown';

export type AttendanceRecordRow = {
  id: string;
  organization_id: string;
  plan_id: string;
  /** Null once the time itself was deleted; the time_* columns keep history readable. */
  plan_time_id: string | null;
  person_id: string;
  status: AttendanceStatus;
  time_kind: PlanTimeKind;
  time_name: string | null;
  time_starts_at: string;
  time_ends_at: string;
  revision: number;
  marked_team_id: string | null;
  marked_by: string | null;
  marked_by_name: string | null;
  marked_at: string;
  created_at: string;
};

export type AttendanceEventRow = {
  id: number;
  record_id: string;
  organization_id: string;
  batch_id: string | null;
  revision: number;
  previous_status: AttendanceStatus | null;
  status: AttendanceStatus;
  team_id: string | null;
  reason: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  occurred_at: string;
};

/** One request that puts the Person at this time (several positions = several entries, one row). */
export interface AttendanceSheetRole {
  assignment_id: string;
  team_id: string;
  team_name: string;
  position_name: string | null;
  /** The request's answer, shown for context only. */
  response: AssignmentStatus;
  /** Whether the caller schedules this team on the plan (UX hint; the database decides). */
  can_mark: boolean;
}

/** One Person scheduled at the time, deduplicated across positions. */
export interface AttendanceSheetRow {
  person_id: string;
  person_name: string;
  archived: boolean;
  roles: AttendanceSheetRole[];
  /** Null = nothing recorded yet (counts as unmarked, never as present). */
  record: Pick<AttendanceRecordRow, 'id' | 'status' | 'revision' | 'marked_by_name' | 'marked_at' | 'marked_team_id'> | null;
  /** The team to record through: the first role the caller may mark, or null. */
  mark_team_id: string | null;
}

export interface AttendanceCounts {
  /** Distinct People scheduled at this time (released, not declined). */
  scheduled_people: number;
  present: number;
  absent: number;
  unknown: number;
  unmarked: number;
}

export interface AttendanceTimeOption {
  id: string;
  kind: PlanTimeKind;
  name: string | null;
  starts_at: string;
  ends_at: string;
}

export interface AttendanceSheet {
  plan_id: string;
  time: AttendanceTimeOption;
  times: AttendanceTimeOption[];
  rows: AttendanceSheetRow[];
  counts: AttendanceCounts;
  /** Records for people no longer scheduled at this time (history is kept). */
  orphaned_records: Array<AttendanceRecordRow & { person_name: string }>;
  /** Rows on teams the caller does not schedule are left out; this counts them. */
  hidden_people: number;
  can_mark_any: boolean;
}

export interface AttendanceBatchRecord {
  person_id: string;
  record_id: string;
  status: AttendanceStatus;
  revision: number;
}

export interface AttendanceBatchResult {
  batch_id: string;
  replayed: boolean;
  applied: number;
  unchanged: number;
  records: AttendanceBatchRecord[];
}

export interface AttendanceHistoryEntry extends AttendanceEventRow {
  team_name: string | null;
}

// ================================================================== reports

export type ReportKind = 'staffing' | 'participation' | 'song_usage' | 'run_times' | 'schedule';

/** Filters exactly as applied (echoed in every format). */
export interface ReportFiltersApplied {
  from: string;
  to: string;
  timezone: string;
  service_type_ids: string[];
  team_ids: string[];
  plan_statuses: PlanStatus[];
  assignment_statuses: AssignmentStatus[];
  include_archived_people: boolean;
  include_rehearsals: boolean;
}

export interface ReportMetricDefinition {
  key: string;
  label: string;
  definition: string;
}

export interface ReportEnvelope<TKind extends ReportKind, TRows, TSummary> {
  kind: TKind;
  title: string;
  generated_at: string;
  filters: ReportFiltersApplied;
  definitions: ReportMetricDefinition[];
  /** What the caller's access left out (never the rows themselves). */
  scope_note: string | null;
  truncated: boolean;
  summary: TSummary;
  rows: TRows[];
}

export interface StaffingReportRow {
  plan_id: string;
  plan_title: string;
  service_date: string;
  service_type: string | null;
  team_id: string;
  team_name: string;
  position_name: string;
  needed: number;
  confirmed: number;
  pending: number;
  declined: number;
  vacancies: number;
}

export interface StaffingFollowUp {
  plan_id: string;
  plan_title: string;
  service_date: string;
  person_id: string;
  person_name: string;
  team_name: string;
  position_name: string;
  response: Exclude<AssignmentStatus, 'confirmed'>;
  released_at: string | null;
}

export interface StaffingSummary {
  plans: number;
  needed: number;
  confirmed: number;
  pending: number;
  declined: number;
  vacancies: number;
  follow_ups: StaffingFollowUp[];
}

export interface ParticipationReportRow {
  person_id: string;
  person_name: string;
  archived: boolean;
  teams: string[];
  /** Request records (two positions on one plan = 2). */
  assignments: number;
  /** Distinct plans the Person was asked onto (two positions on one plan = 1). */
  person_plans: number;
  confirmed: number;
  pending: number;
  declined: number;
  /** Actual attendance: distinct plan times with a record of that status. */
  present: number;
  absent: number;
  unknown: number;
  last_service_date: string | null;
}

export interface ParticipationTeamTotal {
  team_id: string;
  team_name: string;
  assignments: number;
  people: number;
  person_plans: number;
}

export interface ParticipationSummary {
  assignments: number;
  people: number;
  person_plans: number;
  present: number;
  absent: number;
  teams: ParticipationTeamTotal[];
}

export interface SongUsageReportRow {
  song_id: string;
  title: string;
  author: string | null;
  /** Times the song appears in plan orders (twice in one plan = 2). */
  occurrences: number;
  /** Distinct plans that include it (twice in one plan = 1). */
  plans: number;
  keys: string[];
  first_used: string;
  last_used: string;
}

export interface SongUsageSummary {
  occurrences: number;
  songs: number;
  plans: number;
}

export interface RunTimesReportRow {
  run_id: string;
  plan_id: string;
  plan_title: string;
  service_date: string;
  time_name: string | null;
  time_starts_at: string;
  planned_seconds: number;
  actual_seconds: number;
  difference_seconds: number;
  items: number;
  items_over: number;
  corrected: boolean;
}

export interface RunTimesSummary {
  runs: number;
  planned_seconds: number;
  actual_seconds: number;
  average_difference_seconds: number;
}

export interface ScheduleReportRow {
  plan_id: string;
  plan_title: string;
  service_date: string;
  service_type: string | null;
  team_name: string;
  position_name: string;
  person_id: string;
  person_name: string;
  response: AssignmentStatus;
  times: string[];
}

export interface ScheduleSummary {
  plans: number;
  assignments: number;
  people: number;
}

export type StaffingReport = ReportEnvelope<'staffing', StaffingReportRow, StaffingSummary>;
export type ParticipationReport = ReportEnvelope<'participation', ParticipationReportRow, ParticipationSummary>;
export type SongUsageReport = ReportEnvelope<'song_usage', SongUsageReportRow, SongUsageSummary>;
export type RunTimesReport = ReportEnvelope<'run_times', RunTimesReportRow, RunTimesSummary>;
export type ScheduleReport = ReportEnvelope<'schedule', ScheduleReportRow, ScheduleSummary>;
export type AnyReport = StaffingReport | ParticipationReport | SongUsageReport | RunTimesReport | ScheduleReport;

/** Normalized, already-scoped inputs to the pure report builders. */
export interface ReportPlanSource {
  id: string;
  title: string;
  service_date: string;
  status: PlanStatus;
  service_type_id: string | null;
  service_type_name: string | null;
}

export interface ReportAssignmentSource {
  id: string;
  plan_id: string;
  person_id: string;
  team_id: string;
  team_name: string;
  position_name: string | null;
  status: AssignmentStatus;
  released_at: string | null;
  /** Plan times this request covers (F04 resolver), in time order. */
  time_ids: string[];
}

export interface ReportPersonSource {
  id: string;
  name: string;
  archived: boolean;
}

export interface ReportNeedSource {
  plan_id: string;
  team_id: string;
  team_name: string;
  position_name: string;
  needed: number;
}

export interface ReportAttendanceSource {
  plan_id: string;
  plan_time_id: string | null;
  person_id: string;
  status: AttendanceStatus;
  time_kind: PlanTimeKind;
}

export interface ReportTimeSource {
  id: string;
  plan_id: string;
  kind: PlanTimeKind;
  name: string | null;
  starts_at: string;
}

export interface ReportSongItemSource {
  plan_id: string;
  item_id: string;
  song_id: string;
  title: string;
  author: string | null;
  key: string | null;
}

export interface ReportRunSource {
  run_id: string;
  plan_id: string;
  time_name: string | null;
  time_starts_at: string;
  planned_seconds: number;
  actual_seconds: number;
  items: number;
  items_over: number;
  corrected: boolean;
}

// ================================================================== exports

export type ReportExportStatus = 'queued' | 'running' | 'ready' | 'failed' | 'expired';

export type ReportExportRow = {
  id: string;
  organization_id: string;
  requested_by: string;
  kind: ReportKind;
  filters: Record<string, unknown>;
  idempotency_key: string;
  status: ReportExportStatus;
  attempts: number;
  next_attempt_at: string;
  lease_expires_at: string | null;
  error_code: string | null;
  row_count: number | null;
  size_bytes: number | null;
  storage_path: string | null;
  generated_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

/** What a client sees of an export: never the storage path. */
export type ReportExportSummary = Omit<ReportExportRow, 'storage_path' | 'idempotency_key' | 'lease_expires_at'>;

export interface ReportExportDownload {
  url: string;
  expires_at: string;
  filename: string;
}

export interface ReportExportWorkerResult {
  claimed: number;
  ready: number;
  failed: number;
  retried: number;
  expired: number;
}

// ============================================================ calendar feeds

export type CalendarFeedScope = 'service_type' | 'team';
export type CalendarLayer = 'blockouts' | 'birthdays' | 'anniversaries';

export type CalendarScopedFeedRow = {
  id: string;
  organization_id: string;
  user_id: string;
  scope_type: CalendarFeedScope;
  service_type_id: string | null;
  team_id: string | null;
  include_rehearsals: boolean;
  layers: CalendarLayer[];
  label: string | null;
  token_hash: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export type CalendarScopedFeedSummary = Omit<CalendarScopedFeedRow, 'token_hash'> & { scope_name: string | null };

/** Returned once, when a feed is created or rotated. */
export interface CalendarScopedFeedCreated {
  feed: CalendarScopedFeedSummary;
  url: string;
  webcal_url: string;
}

export interface CalendarLayerEvent {
  /** Stable: `blockout-<id>` or `<layer>-<person>-<date>`. */
  id: string;
  layer: CalendarLayer;
  person_id: string;
  person_name: string;
  /** All-day events carry `date`; timed blockouts carry instants. */
  date: string | null;
  starts_at: string | null;
  ends_at: string | null;
  all_day: boolean;
}

export type PersonCalendarSharingRow = {
  person_id: string;
  organization_id: string;
  share_birthday: boolean;
  share_anniversary: boolean;
  updated_by: string | null;
  updated_at: string;
};

// ============================================================== publication

export type PublicPlanField =
  | 'title'
  | 'date'
  | 'times'
  | 'location'
  | 'service_type'
  | 'order'
  | 'item_lengths'
  | 'songs'
  | 'song_authors'
  | 'song_keys';

export type PublishMode = 'now' | 'service_day';

export type PlanPublicationRow = {
  id: string;
  organization_id: string;
  plan_id: string;
  slug: string;
  fields: PublicPlanField[];
  publish_mode: PublishMode;
  published_at: string;
  revoked_at: string | null;
  revision: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PublicSetListLinkKind = 'upcoming' | 'recent';

export type PublicSetListLinkRow = {
  id: string;
  organization_id: string;
  service_type_id: string;
  kind: PublicSetListLinkKind;
  slug: string;
  revoked_at: string | null;
  created_by: string | null;
  created_at: string;
};

export type PublicationState = 'unpublished' | 'scheduled' | 'live' | 'revoked' | 'ineligible';

export interface PlanPublicationView {
  publication: PlanPublicationRow | null;
  state: PublicationState;
  /** When a service-day publication becomes visible. */
  visible_from: string | null;
  public_path: string | null;
  /** Exactly what an anonymous visitor would receive now (null if nothing). */
  preview: PublicPlanProjection | null;
  ineligible_reason: string | null;
}

export interface PublicPlanItem {
  kind: 'header' | 'song' | 'item';
  title: string;
  length_seconds?: number;
  song?: { title: string; author?: string | null; key?: string | null };
}

/** The only shape a public endpoint ever returns. Absent keys were not published. */
export interface PublicPlanProjection {
  organization: string;
  title?: string;
  date?: string;
  timezone: string;
  service_type?: string | null;
  location?: string | null;
  times?: Array<{ name: string | null; starts_at: string; ends_at: string }>;
  items?: PublicPlanItem[];
  songs?: Array<{ title: string; author?: string | null; key?: string | null }>;
}

/** Inputs to the pure projection (already loaded by the server). */
export interface PublicPlanSource {
  organization_name: string;
  timezone: string;
  plan: {
    title: string;
    service_date: string;
    status: PlanStatus;
    location: string | null;
    service_type_name: string | null;
  };
  times: Array<{ kind: PlanTimeKind; name: string | null; starts_at: string; ends_at: string }>;
  items: Array<{
    item_type: 'header' | 'song' | 'item';
    title: string;
    length_seconds: number;
    song: { title: string; author: string | null } | null;
    key: string | null;
  }>;
}

export interface ServiceTypePublicLinks {
  service_type_id: string;
  links: PublicSetListLinkRow[];
}
