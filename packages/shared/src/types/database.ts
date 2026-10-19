import type { LabeledKey } from '../schemas/arrangement-curation.js';
import type { ImportJob, ImportJobRow } from '../schemas/imports.js';
import type { SongBulkPreview, SongCurationEventRow } from './song-curation.js';
/**
 * Shape of the Postgres schema as supabase-js expects it.
 *
 * Kept hand-written (rather than `supabase gen types`) so the whole workspace
 * has a single source of truth that also compiles without a running database.
 * Regenerate-and-diff with:
 *   supabase gen types typescript --local > /tmp/db.ts
 */

import type {
  AssignmentPreferenceOverrideRow,
  AvailabilityRequestRecipientRow,
  AvailabilityRequestRow,
  PersonAvailabilityReviewRow,
  ScheduleDelegationEventRow,
  ScheduleDelegationRow,
  SchedulingPreferenceRow,
  UserScheduleSettingsRow,
} from './availability.js';
import type {
  AssignmentConflictOverrideRow,
  AttendanceCalendarStateRow,
  AttendanceIntervalSource,
  ConflictKind,
  ConflictSeverity,
} from './attendance.js';
import type {
  AcceptPersonInvitationRow,
  PersonDeliveryReadiness,
  PersonIdentityReconciliationRow,
  PersonRosterEventRow,
  PersonTagCatalogRow,
  PersonTagGroupRow,
  RosterBulkAction,
  RosterBulkApplyResult,
  RosterBulkPreviewRow,
} from './roster.js';
import type { ApprovedSwapRow, OpportunityClaimRow, ReplacementOfferRow, ReplacementRequestRow, SignupOpportunityRow } from './opportunities.js';
import type {
  ConversationMemberStateRow,
  ConversationMessageMentionRow,
  ConversationMessageReportRow,
  ConversationMessageRow,
  ConversationRow,
  DiscussionAuditEventRow,
  MessageTemplateRow,
  NoteCategoryRow,
  OperationalMessageRecipientRow,
  OperationalMessageRow,
  PlanItemCommentMentionRow,
  PlanItemCommentRow,
  PlanNoteRow,
  PlanNoteTeamRow,
} from './collaboration.js';
import type {
  PlanGenerationBatchRow,
  PlanRescheduleOperationRow,
  PlanGenerationCommit,
  PlanTemplateApplicationRow,
  PlanTemplateRevisionRow,
  PlanTemplateRow,
  PlanTemplateSaveResult,
  TemplateApplyCommit,
  TemplateApplyPreviewResult,
  ReschedulePreview,
  RescheduleResult,
} from './plan-templates.js';
import type {
  EffectiveReminderPolicy,
  PersonReminderPreferencesRow,
  ReleaseBatchItemRow,
  ReleaseBatchRow,
  ReleaseBatchStatus,
  ReminderJobRow,
  ReminderPolicyRow,
} from './reminders.js';
import type {
  LiveRunCommandResult,
  LiveRunCorrectionRow,
  LiveRunRow,
  LiveRunStateRecord,
  LiveRunTransitionRow,
} from './live.js';
import type {
  AttachmentAudienceTargetRow,
  AttachmentLinkRow,
  AttachmentRow,
  AttachmentVersionRow,
  FileAbandonRpcResult,
  FileAudience,
  FileCategory,
  FileFinalizeRpcResult,
  FileKind,
  FileObjectRemovalRow,
  FileOwnerKind,
  FileSaveRpcResult,
  FileUploadIntentRpcResult,
} from './files.js';
import type { MediaRow, PlanStageLayoutRow, StageLayoutTemplateRow } from './media.js';
import type {
  ApiCredentialRow,
  WebhookDeliveredEventType,
  WebhookDeliveryAttemptRow,
  WebhookDeliveryRow,
  WebhookEndpointRow,
  WebhookEventRow,
} from './integrations.js';
import type { FilePlaybackRights } from './rehearsal.js';
import type {
  AttendanceBatchResult,
  AttendanceEventRow,
  AttendanceRecordRow,
  CalendarScopedFeedRow,
  PersonCalendarSharingRow,
  PlanPublicationRow,
  PublicSetListLinkRow,
  ReportExportRow,
} from './reports.js';

/** One mark as `record_attendance` receives it (F16). */
export interface AttendanceMarkRpc {
  person_id: string;
  team_id: string;
  status: string;
  expected_revision: number;
}

/** What a scoped feed may show its subscriber right now (F16). */
export interface ScopedFeedAccess {
  names: boolean;
  blockouts: boolean;
  personal_dates: boolean;
}

/** One row of `team_calendar_layers` (F16). */
export interface TeamCalendarLayerRpcRow {
  layer: string;
  source_id: string | null;
  person_id: string;
  person_name: string;
  on_date: string | null;
  starts_at: string | null;
  ends_at: string | null;
  all_day: boolean;
}

/**
 * Row types are exact — every read is precisely typed. Insert and Update are
 * deliberately permissive: request handlers build payloads by spreading
 * Zod-validated objects, which an exact type would reject for reasons that
 * have nothing to do with correctness.
 */
/** One row of `api_authenticate` (service role). */
export type ApiAuthenticateRpcRow = {
  outcome: 'ok' | 'invalid' | 'inactive' | 'rate_limited';
  credential_id: string | null;
  organization_id: string | null;
  scopes: string[] | null;
  rate_limit: number | null;
  remaining: number | null;
  reset_at: string | null;
};

/** One leased webhook delivery from `claim_webhook_deliveries` (service role). */
export type WebhookClaimRpcRow = {
  delivery_id: string;
  organization_id: string;
  endpoint_id: string;
  url: string;
  secret_ciphertext: string;
  event_id: string;
  event_type: WebhookDeliveredEventType;
  occurred_at: string;
  data: Record<string, unknown>;
  attempt: number;
  max_attempts: number;
};

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row> & Record<string, unknown>;
  Update: Partial<Row> & Record<string, unknown>;
  Relationships: [];
};

export type OrgRole = 'owner' | 'admin' | 'scheduler' | 'member';
export type MemberStatus = 'invited' | 'active' | 'inactive';
export type PlanStatus = 'draft' | 'published' | 'archived';
export type PlanTimeKind = 'service' | 'rehearsal' | 'other';
export type PlanItemType = 'song' | 'header' | 'item';
/** How often plans for a service type come round. Drives the suggested next service date. */
export type PlanRecurrence = 'weekly' | 'biweekly' | 'monthly' | 'occasionally';
export type AssignmentStatus = 'unconfirmed' | 'confirmed' | 'declined';
export type NotificationType =
  | 'assignment_scheduled'
  | 'assignment_reminder'
  | 'assignment_response'
  | 'plan_updated'
  | 'availability_request'
  /** F09: someone mentioned you in an item discussion. */
  | 'comment_mention'
  /** F09: a new comment in an item discussion you took part in. */
  | 'comment_reply'
  /** F09: a leader's targeted operational message. */
  | 'operational_message'
  /** F09: someone mentioned you in a team/plan conversation. */
  | 'conversation_mention'
  /** F09: someone replied to your conversation message. */
  | 'conversation_reply';
export type DevicePlatform = 'ios' | 'android' | 'web';
/** Where a delivery goes: the in-app feed, a device push, or email. */
export type DeliveryChannel = 'in_app' | 'push' | 'email';
/**
 * A delivery's outcome. `simulated` (no provider configured) and
 * `provider_accepted` are distinct; neither means the person saw it.
 * `ambiguous` means the provider call may or may not have landed.
 */
export type DeliveryStatus =
  | 'queued'
  | 'sending'
  | 'simulated'
  | 'provider_accepted'
  | 'delivered'
  | 'failed'
  | 'ambiguous'
  | 'skipped'
  | 'cancelled';
export type DeliveryTemplate =
  | 'assignment_request'
  | 'assignment_reminder'
  | 'scheduler_response'
  | 'availability_request'
  /** F08: a confirmed-service ("coming up") reminder; carries no respond link. */
  | 'service_reminder'
  /** F09: item discussion mention/reply. */
  | 'item_comment'
  /** F09: targeted operational message. */
  | 'operational_message'
  /** F09: conversation mention/reply. */
  | 'conversation_message';
export type ResponseTransition = 'response' | 'withdrawal';
/** Column layout a printed chord chart uses. Constrained in the database too. */
export type ChartColumns = 1 | 2;

/**
 * F01 operational capabilities. Owners/admins hold all of them; a scheduler
 * holds all of them organization-wide while their access mode is `legacy`.
 */
export type AccessCapability =
  | 'plans.edit'
  | 'scheduling.manage'
  | 'scheduling.override_conflicts'
  | 'teams.manage'
  | 'people.view_private'
  | 'people.manage'
  | 'songs.manage'
  | 'media.manage';
/** Where a grant applies. A folder grant covers every service type beneath it. */
export type AccessScopeType = 'organization' | 'folder' | 'service_type' | 'team';
/** `legacy`: a scheduler keeps organization-wide management. `scoped`: explicit grants only. */
export type AccessMode = 'legacy' | 'scoped';
/** `prepared` requests are a scheduler's private draft; `released` ones reach their person. */
export type AssignmentVisibility = 'prepared' | 'released';
export type AssignmentAttendanceMode = 'all' | 'selected';
/** Who sees released team rosters: everyone in the organization, or teams (and related teams) only. */
export type AssignmentRosterVisibility = 'organization' | 'teams';
export type EligibilityStatus = 'clear' | 'not_clear' | 'pending';

export type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  logo_url: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state_province: string | null;
  postal_code: string | null;
  country: string | null;
  denomination: string | null;
  /** Self-reported congregation size — distinct from the count of people actually in the system. */
  member_count: number | null;
  /** Where plan lists open when a member has not chosen a landing folder. */
  default_folder_id: string | null;
  assignment_visibility: AssignmentRosterVisibility;
  /** F09: conversation messages older than this are purged. Null keeps them. */
  conversation_retention_days?: number | null;
  created_at: string;
  updated_at: string;
}

export type SongbookRow = {
  id: string;
  organization_id: string;
  title: string;
  description: string | null;
  source_type: 'manual' | 'document';
  source_storage_path: string | null;
  source_filename: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type SongbookItemRow = {
  id: string;
  songbook_id: string;
  song_id: string;
  arrangement_id: string | null;
  sort_order: number;
  created_at: string;
}

export type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export type OrganizationMemberRow = {
  id: string;
  organization_id: string;
  user_id: string;
  role: OrgRole;
  status: MemberStatus;
  access_mode: AccessMode;
  landing_folder_id: string | null;
  created_at: string;
  updated_at: string;
}

export type PersonType = 'adult' | 'child';
export type PersonGender = 'male' | 'female';
export type InvitationChannel = 'email';

export type PersonRow = {
  id: string;
  organization_id: string;
  profile_id: string | null;
  first_name: string;
  last_name: string | null;
  avatar_url: string | null;
  email: string | null;
  phone: string | null;
  phone_carrier: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state_province: string | null;
  postal_code: string | null;
  country: string | null;
  campus: string | null;
  person_type: PersonType;
  gender: PersonGender | null;
  birthdate: string | null;
  marital_status: string | null;
  anniversary_date: string | null;
  school: string | null;
  medical_note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** F02: set while the Person is archived (kept for history, hidden from pickers). */
  archived_at: string | null;
  archived_by: string | null;
}

export type PersonInvitationRow = {
  id: string;
  organization_id: string;
  person_id: string;
  email: string;
  role: OrgRole;
  channel: InvitationChannel;
  token_hash: string;
  expires_at: string;
  created_by: string | null;
  created_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
}

export type ServiceTypeRow = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  recurrence: PlanRecurrence;
  sort_order: number;
  folder_id: string | null;
  /** Archived service types are hidden from pickers; their plans stay readable. */
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export type TeamRow = {
  id: string;
  organization_id: string;
  service_type_id: string | null;
  name: string;
  description: string | null;
  color: string;
  sort_order: number;
  /** Visibility new requests get when the scheduler does not choose one. */
  default_visibility: AssignmentVisibility;
  /** Who hears answers by default, when they can schedule this team. */
  default_response_owner_id: string | null;
  /** Scheduling and membership need a current eligibility record of `eligibility_kind`. */
  requires_eligibility: boolean;
  eligibility_kind: string | null;
  created_at: string;
  updated_at: string;
}

export type TeamPositionRow = {
  id: string;
  team_id: string;
  name: string;
  sort_order: number;
  /** F02: set for a position that exists on one plan only (not in the team's normal list). */
  plan_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type TeamMembershipRow = {
  id: string;
  team_id: string;
  /** Canonical roster identity; a login is optional. */
  person_id: string;
  /** Compatibility reference to the linked Profile. */
  user_id: string | null;
  position_id: string | null;
  created_at: string;
}

export type SongRow = {
  merged_into_song_id?: string | null;
  merged_default_arrangement_id?: string | null;
  archived_at: string | null;
  revision: number;
  id: string;
  organization_id: string;
  title: string;
  author: string | null;
  ccli_number: string | null;
  copyright: string | null;
  /** Publisher the copyright is administered through, e.g. "Capitol CMG". */
  administration: string | null;
  default_key: string | null;
  default_bpm: number | null;
  meter: string | null;
  themes: string[];
  /** Free-form tag vocabularies from the Add Song form. */
  song_types: string[];
  style: string | null;
  speed: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ArrangementKeyRow = Omit<LabeledKey, 'file_ids'>;
export type ArrangementFileLinkRow = { id: string; arrangement_id: string; attachment_id: string; key_id: string | null };
export type LibraryOperationRow = { id: string; organization_id: string; actor_id: string; idempotency_key: string;
  kind: 'duplicate_arrangement' | 'save_key' | 'merge_song'; input: unknown; before_state: unknown; result: unknown; created_at: string };

export type ArrangementRow = {
  archived_at: string | null;
  revision: number;
  id: string;
  song_id: string;
  name: string;
  song_key: string | null;
  /** Fret the capo sits on; null when the arrangement is played open. */
  capo: number | null;
  bpm: number | null;
  meter: string | null;
  length_seconds: number | null;
  sequence: string[];
  chord_chart: string | null;
  chord_chart_format: string;
  /** Columns the printed chart is laid out in: 1 or 2. */
  chart_columns: ChartColumns;
  /** Null on any of these means "use the chart template's default". */
  chart_font: string | null;
  chart_font_size: number | null;
  chart_chord_color: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export type PlanRow = {
  id: string;
  organization_id: string;
  service_type_id: string | null;
  title: string;
  service_date: string;
  location: string | null;
  status: PlanStatus;
  notes: string | null;
  /** Bumped by every change to the plan's items, times or needs. */
  content_revision: number;
  /** Bumped by assignments, needs and plan-time changes for F05 previews. */
  staffing_revision: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type PlanTimeRow = {
  id: string;
  plan_id: string;
  kind: PlanTimeKind;
  name: string | null;
  starts_at: string;
  ends_at: string;
  ics_sequence: number;
  revision: number;
  sort_order: number;
  created_at: string;
}

export type PlanItemRow = {
  id: string;
  plan_id: string;
  item_type: PlanItemType;
  title: string;
  song_id: string | null;
  arrangement_id: string | null;
  key_override: string | null;
  length_seconds: number;
  description: string | null;
  sort_order: number;
  /** F11: this plan's section order for the song; null inherits the arrangement's. */
  sequence_override: string[] | null;
  /** F11: a named Person responsible for the item (never with a position). */
  leader_person_id: string | null;
  /** F11: a team position whose current assignee on this plan leads the item. */
  leader_position_id: string | null;
  /** F11: before, during or after the service time. */
  service_segment: PlanItemSegment;
  /** F14: a reusable media bundle linked to a regular item (absent from older responses). */
  media_id?: string | null;
  created_at: string;
  updated_at: string;
}

/** F11: an item edit and the plan's content revision after it. */
export interface PlanItemSaveResult {
  item: PlanItemRow;
  content_revision: number;
}

/** F11: the plan's content revision after a reorder or removal. */
export interface PlanOrderSaveResult {
  content_revision: number;
}

/** F11: where an item sits relative to the service it belongs to. */
export type PlanItemSegment = 'pre' | 'service' | 'post';

/** How many people one plan needs in a given team position. */
export type PlanPositionNeedRow = {
  id: string;
  plan_id: string;
  position_id: string;
  needed: number;
  created_at: string;
  updated_at: string;
}

export type AssignmentRow = {
  id: string;
  plan_id: string;
  /** Canonical roster identity. */
  person_id: string;
  /** Compatibility reference; null until this Person has a login. */
  user_id: string | null;
  team_id: string;
  position_id: string | null;
  status: AssignmentStatus;
  /** Scheduler-authored; the assignee cannot change it. */
  notes: string | null;
  notified_at: string | null;
  responded_at: string | null;
  created_by: string | null;
  /** Independent of the answer status and the plan's publication. */
  visibility: AssignmentVisibility;
  released_at: string | null;
  released_by: string | null;
  /** Who receives answer updates; defaults to whoever scheduled it. */
  response_owner_id: string | null;
  attendance_mode: AssignmentAttendanceMode;
  /** Changes only when the promised request scope changes. */
  request_revision: number;
  created_at: string;
  updated_at: string;
}

/**
 * Append-only history of assignment status changes, written by a database
 * trigger. Readable only by the assignee and the organization's schedulers,
 * which is why decline reasons live here rather than on the assignment.
 */
export type AssignmentResponseRow = {
  id: string;
  organization_id: string;
  assignment_id: string;
  assignee_id: string | null;
  assignee_person_id: string;
  /** Null when the change came from a respond link rather than a signed-in user. */
  actor_id: string | null;
  previous_status: AssignmentStatus;
  status: AssignmentStatus;
  response_note: string | null;
  created_at: string;
}

export type AssignmentNotificationRow = {
  id: string;
  organization_id: string;
  plan_id: string;
  person_id: string;
  user_id: string | null;
  snapshot_id: string | null;
  email: string;
  token_hash: string;
  expires_at: string;
  /**
   * F08: the last provider-accepted token, kept usable until the replacement
   * (`token_hash`) is itself accepted. Answers through either consume the row.
   */
  previous_token_hash: string | null;
  previous_snapshot_id: string | null;
  previous_expires_at: string | null;
  /** The delivery whose email carries `token_hash`. */
  issued_delivery_id: string | null;
  sent_at: string | null;
  responded_at: string | null;
  created_by: string | null;
  created_at: string;
}

export type NotificationRow = {
  id: string;
  organization_id: string;
  /** The recipient, not whoever caused the event. */
  user_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  plan_id: string | null;
  assignment_id: string | null;
  read_at: string | null;
  created_by: string | null;
  created_at: string;
  /** Set when a delivery wrote the row, so a retry never adds a second copy. */
  dedupe_key: string | null;
  /** F09: deep link to an item discussion. */
  plan_item_id?: string | null;
  /** F09: deep link to a targeted message. */
  operational_message_id?: string | null;
  /** F09: deep link to a conversation. */
  conversation_id?: string | null;
}

/** One logical side effect of an action, unique per organization by effect_key. */
export type DeliveryEffectRow = {
  id: string;
  organization_id: string;
  effect_key: string;
  template: DeliveryTemplate;
  plan_id: string | null;
  assignment_ids: string[];
  responder_id: string | null;
  responder_person_id: string | null;
  response_status: AssignmentStatus | null;
  response_transition: ResponseTransition | null;
  /** Set for `availability_request` effects (F03). */
  availability_request_id: string | null;
  /** F08: the release batch whose consolidated request this is. */
  release_batch_id: string | null;
  /** F08: the reminder job this effect materialized. */
  reminder_job_id: string | null;
  /** F09: the item comment this effect announces. */
  comment_id?: string | null;
  /** F09: the targeted message this effect delivers. */
  operational_message_id?: string | null;
  /** F09: the conversation message this effect announces. */
  conversation_message_id?: string | null;
  created_by: string | null;
  created_at: string;
}

/** Outbox row: one per effect recipient and channel. */
export type DeliveryRow = {
  id: string;
  organization_id: string;
  effect_id: string;
  recipient_id: string | null;
  recipient_person_id: string;
  channel: DeliveryChannel;
  status: DeliveryStatus;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  provider_call_started_at: string | null;
  provider_message_id: string | null;
  accepted_at: string | null;
  delivered_at: string | null;
  completed_at: string | null;
  last_error_code: string | null;
  manual_retries: number;
  created_at: string;
  updated_at: string;
}

export type AssignmentAttendanceTimeRow = {
  assignment_id: string;
  plan_time_id: string;
  created_at: string;
}

export type AssignmentTimeResponseRow = {
  assignment_id: string;
  plan_time_id: string;
  status: Exclude<AssignmentStatus, 'unconfirmed'>;
  response_note: string | null;
  actor_id: string | null;
  responded_at: string;
}

export type AssignmentRequestSnapshotRow = {
  id: string;
  organization_id: string;
  person_id: string;
  plan_id: string;
  effect_id: string | null;
  version: number;
  expires_at: string;
  consumed_at: string | null;
  superseded_at: string | null;
  created_by: string | null;
  created_at: string;
}

export type AssignmentRequestSnapshotItemRow = {
  snapshot_id: string;
  assignment_id: string;
  expected_request_revision: number;
  expected_status: AssignmentStatus;
  plan_time_ids: string[];
}

export type DevicePushTokenRow = {
  id: string;
  user_id: string;
  token: string;
  platform: DevicePlatform;
  device_name: string | null;
  created_at: string;
  last_seen_at: string;
  /** Server-enforced upper bound for push delivery until the app renews. */
  lease_expires_at: string;
  /** SHA-256 only; the raw revocation secret is never persisted server-side. */
  revocation_secret_hash: string;
}

export type CalendarFeedTokenRow = {
  id: string;
  organization_id: string;
  user_id: string;
  token_hash: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export type BlockoutRow = {
  id: string;
  organization_id: string;
  /** Compatibility link for signed-in people; null for a Person without a Profile. */
  user_id: string | null;
  person_id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
  timezone: string | null;
  all_day: boolean;
  local_start_date: string | null;
  local_start_time: string | null;
  local_end_date: string | null;
  local_end_time: string | null;
  series_id: string | null;
  occurrence_key: string | null;
  revision: number;
  created_by: string | null;
  updated_by: string | null;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
}

export type BlockoutFrequency = 'weekly' | 'monthly';
export type BlockoutSeriesEndType = 'count' | 'until';

export type BlockoutSeriesRow = {
  id: string;
  organization_id: string;
  person_id: string;
  timezone: string;
  all_day: boolean;
  local_start_date: string;
  local_start_time: string | null;
  local_end_date: string;
  local_end_time: string | null;
  reason: string | null;
  frequency: BlockoutFrequency;
  interval_count: number;
  end_type: BlockoutSeriesEndType;
  until_date: string | null;
  occurrence_count: number | null;
  monthly_missing_date: 'skip';
  ambiguous_time_policy: 'earlier' | 'later';
  revision: number;
  idempotency_key: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type BlockoutSeriesExceptionRow = {
  id: string;
  series_id: string;
  occurrence_key: string;
  kind: 'updated' | 'deleted' | 'future_split';
  replacement_blockout_id: string | null;
  created_by: string;
  created_at: string;
}


export type SchedulingConflictRow = {
  user_id: string;
  conflict_type: 'blockout' | 'double_booked';
  detail: string | null;
  starts_at: string;
  ends_at: string;
  plan_id: string | null;
}

export type AccessGrantRow = {
  id: string;
  organization_id: string;
  user_id: string;
  capability: AccessCapability;
  scope_type: AccessScopeType;
  service_type_id: string | null;
  team_id: string | null;
  folder_id: string | null;
  created_by: string | null;
  created_at: string;
}

/** Audit of response-owner reassignment. */
export type AssignmentOwnerChangeRow = {
  id: string;
  organization_id: string;
  assignment_id: string;
  previous_owner_id: string | null;
  new_owner_id: string | null;
  changed_by: string | null;
  created_at: string;
}

export type ServiceTypeFolderRow = {
  id: string;
  organization_id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  /** Bumped by every move; a move sends the revision it previewed. */
  revision: number;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ServiceTypeTeamRow = {
  service_type_id: string;
  team_id: string;
  organization_id: string;
  created_at: string;
}

export type PersonTagRow = {
  organization_id: string;
  person_id: string;
  tag: string;
  created_by: string | null;
  created_at: string;
}

export type TeamTagRuleRow = {
  team_id: string;
  organization_id: string;
  tag: string;
  created_at: string;
}

/** Members of `team_id` may see `related_team_id`'s roster (one hop). */
export type TeamRelatedVisibilityRow = {
  team_id: string;
  related_team_id: string;
  organization_id: string;
  created_at: string;
}

/** Explicit eligibility evidence for secure teams; the latest record of a kind decides. */
export type PersonEligibilityRecordRow = {
  id: string;
  organization_id: string;
  user_id: string;
  kind: string;
  status: EligibilityStatus;
  provider: string;
  provider_reference: string | null;
  verified_at: string;
  expires_at: string;
  recorded_by: string | null;
  created_at: string;
}

/** The non-private roster projection every member may read. */
export type PeopleDirectoryRow = Pick<
  PersonRow,
    | 'id' | 'organization_id' | 'profile_id' | 'first_name' | 'last_name' | 'avatar_url' | 'campus' | 'person_type'
  | 'created_at' | 'updated_at' | 'archived_at'
>;

/** A person's private record as API roles may select it (no medical note). */
export type PersonSelectableRow = Omit<PersonRow, 'medical_note'>;

/** Profile columns API roles may select; contact comes from `member_contacts`. */
export type PublicProfileRow = Pick<ProfileRow, 'id' | 'full_name' | 'avatar_url' | 'created_at' | 'updated_at'>;

/** One row of effective access as resolved by the database. */
export type EffectiveAccessRow = {
  capability: AccessCapability;
  scope_type: AccessScopeType;
  scope_id: string | null;
  /** `role:owner`, `role:admin`, `role:scheduler_legacy`, `grant` or `grant:folder`. */
  source: string;
  grant_id: string | null;
}

export type AccessMoveChangeRow = {
  user_id: string;
  capability: AccessCapability;
  service_type_id: string;
  change: 'gain' | 'lose';
}

export type StaffingMatrixViewRow = {
  id: string;
  organization_id: string;
  owner_id: string;
  name: string;
  filters: unknown;
  created_at: string;
  updated_at: string;
}

export type StaffingMatrixCommitRow = {
  id: string;
  organization_id: string;
  actor_id: string;
  idempotency_key: string;
  operation_id: string;
  result: unknown;
  created_at: string;
}

export type TeamRotationRow = {
  id: string;
  organization_id: string;
  team_id: string;
  name: string;
  cycle_weeks: number;
  anchor_date: string;
  substitute_policy: 'vacancy' | 'fairness';
  revision: number;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type TeamRotationSlotRow = {
  rotation_id: string;
  week_index: number;
  position_id: string;
  person_id: string;
}

export type TeamRotationExceptionRow = {
  id: string;
  rotation_id: string;
  local_date: string;
  position_id: string;
  person_id: string | null;
  note: string | null;
}

export type TeamRotationVersionRow = {
  rotation_id: string;
  revision: number;
  definition: unknown;
  saved_by: string | null;
  saved_at: string;
}

export type StaffingProposalRow = {
  id: string;
  organization_id: string;
  author_id: string;
  status: 'draft' | 'committed' | 'superseded';
  revision: number;
  rule_version: string;
  seed: string;
  lookback_days: number;
  plan_ids: string[];
  team_ids: string[];
  base_revisions: unknown;
  rotation_versions: unknown;
  snapshot: unknown;
  input_hash: string;
  edits: unknown;
  result: unknown;
  expires_at: string;
  superseded_by: string | null;
  commit_key: string | null;
  committed_at: string | null;
  commit_result: unknown;
  created_at: string;
  updated_at: string;
}

export type Database = {
  public: {
    Tables: {
      organizations: Table<OrganizationRow>;
      profiles: Table<ProfileRow>;
      organization_members: Table<OrganizationMemberRow>;
      people: Table<PersonRow>;
      person_invitations: Table<PersonInvitationRow>;
      service_types: Table<ServiceTypeRow>;
      teams: Table<TeamRow>;
      team_positions: Table<TeamPositionRow>;
      team_memberships: Table<TeamMembershipRow>;
      structured_import_jobs: Table<ImportJob & { source: unknown }>;
      structured_import_rows: Table<ImportJobRow>;
      songs: Table<SongRow>;
      song_bulk_previews: Table<SongBulkPreview>;
      song_curation_events: Table<SongCurationEventRow>;
      arrangements: Table<ArrangementRow>;
      arrangement_keys: Table<ArrangementKeyRow>;
      arrangement_file_links: Table<ArrangementFileLinkRow>;
      library_operations: Table<LibraryOperationRow>;
      plans: Table<PlanRow>;
      plan_times: Table<PlanTimeRow>;
      plan_items: Table<PlanItemRow>;
      plan_position_needs: Table<PlanPositionNeedRow>;
      assignments: Table<AssignmentRow>;
      assignment_attendance_times: Table<AssignmentAttendanceTimeRow>;
      assignment_time_responses: Table<AssignmentTimeResponseRow>;
      assignment_request_snapshots: Table<AssignmentRequestSnapshotRow>;
      assignment_request_snapshot_items: Table<AssignmentRequestSnapshotItemRow>;
      assignment_responses: Table<AssignmentResponseRow>;
      assignment_notifications: Table<AssignmentNotificationRow>;
      calendar_feed_tokens: Table<CalendarFeedTokenRow>;
      notifications: Table<NotificationRow>;
      delivery_effects: Table<DeliveryEffectRow>;
      deliveries: Table<DeliveryRow>;
      device_push_tokens: Table<DevicePushTokenRow>;
      blockouts: Table<BlockoutRow>;
      blockout_series: Table<BlockoutSeriesRow>;
      blockout_series_exceptions: Table<BlockoutSeriesExceptionRow>;
      attachments: Table<AttachmentRow>;
      attachment_versions: Table<AttachmentVersionRow>;
      attachment_links: Table<AttachmentLinkRow>;
      attachment_audience_targets: Table<AttachmentAudienceTargetRow>;
      songbooks: Table<SongbookRow>;
      songbook_items: Table<SongbookItemRow>;
      access_grants: Table<AccessGrantRow>;
      assignment_owner_changes: Table<AssignmentOwnerChangeRow>;
      service_type_folders: Table<ServiceTypeFolderRow>;
      service_type_teams: Table<ServiceTypeTeamRow>;
      person_tags: Table<PersonTagRow>;
      team_tag_rules: Table<TeamTagRuleRow>;
      team_related_visibility: Table<TeamRelatedVisibilityRow>;
      person_eligibility_records: Table<PersonEligibilityRecordRow>;
      person_roster_events: Table<PersonRosterEventRow>;
      person_tag_groups: Table<PersonTagGroupRow>;
      person_tag_catalog: Table<PersonTagCatalogRow>;
      person_identity_reconciliations: Table<PersonIdentityReconciliationRow>;
      scheduling_preferences: Table<SchedulingPreferenceRow>;
      assignment_preference_overrides: Table<AssignmentPreferenceOverrideRow>;
      person_availability_reviews: Table<PersonAvailabilityReviewRow>;
      availability_requests: Table<AvailabilityRequestRow>;
      availability_request_recipients: Table<AvailabilityRequestRecipientRow>;
      schedule_delegations: Table<ScheduleDelegationRow>;
      schedule_delegation_events: Table<ScheduleDelegationEventRow>;
      user_schedule_settings: Table<UserScheduleSettingsRow>;
      assignment_conflict_overrides: Table<AssignmentConflictOverrideRow>;
      attendance_calendar_states: Table<AttendanceCalendarStateRow>;
      staffing_matrix_views: Table<StaffingMatrixViewRow>;
      staffing_matrix_commits: Table<StaffingMatrixCommitRow>;
      team_rotations: Table<TeamRotationRow>;
      team_rotation_slots: Table<TeamRotationSlotRow>;
      team_rotation_exceptions: Table<TeamRotationExceptionRow>;
      team_rotation_versions: Table<TeamRotationVersionRow>;
      staffing_proposals: Table<StaffingProposalRow>;
      signup_opportunities: Table<SignupOpportunityRow>;
      release_batches: Table<ReleaseBatchRow>;
      release_batch_items: Table<ReleaseBatchItemRow>;
      reminder_policies: Table<ReminderPolicyRow>;
      person_reminder_preferences: Table<PersonReminderPreferencesRow>;
      reminder_jobs: Table<ReminderJobRow>;
      opportunity_claims: Table<OpportunityClaimRow>;
      replacement_requests: Table<ReplacementRequestRow>;
      replacement_offers: Table<ReplacementOfferRow>;
      approved_swaps: Table<ApprovedSwapRow>;
      note_categories: Table<NoteCategoryRow>;
      plan_notes: Table<PlanNoteRow>;
      plan_note_teams: Table<PlanNoteTeamRow>;
      plan_item_comments: Table<PlanItemCommentRow>;
      plan_item_comment_mentions: Table<PlanItemCommentMentionRow>;
      discussion_audit_events: Table<DiscussionAuditEventRow>;
      message_templates: Table<MessageTemplateRow>;
      operational_messages: Table<OperationalMessageRow>;
      operational_message_recipients: Table<OperationalMessageRecipientRow>;
      conversations: Table<ConversationRow>;
      conversation_messages: Table<ConversationMessageRow>;
      conversation_message_mentions: Table<ConversationMessageMentionRow>;
      conversation_member_states: Table<ConversationMemberStateRow>;
      conversation_message_reports: Table<ConversationMessageReportRow>;
      plan_templates: Table<PlanTemplateRow>;
      plan_template_revisions: Table<PlanTemplateRevisionRow>;
      plan_template_applications: Table<PlanTemplateApplicationRow>;
      plan_generation_batches: Table<PlanGenerationBatchRow>;
      plan_reschedule_operations: Table<PlanRescheduleOperationRow>;
      live_runs: Table<LiveRunRow>;
      live_run_transitions: Table<LiveRunTransitionRow>;
      live_run_corrections: Table<LiveRunCorrectionRow>;
      media: Table<MediaRow>;
      stage_layout_templates: Table<StageLayoutTemplateRow>;
      plan_stage_layouts: Table<PlanStageLayoutRow>;
      attendance_records: Table<AttendanceRecordRow>;
      attendance_events: Table<AttendanceEventRow>;
      report_exports: Table<ReportExportRow>;
      calendar_scoped_feeds: Table<CalendarScopedFeedRow>;
      person_calendar_sharing: Table<PersonCalendarSharingRow>;
      plan_publications: Table<PlanPublicationRow>;
      public_set_list_links: Table<PublicSetListLinkRow>;
      api_credentials: Table<ApiCredentialRow>;
      webhook_endpoints: Table<WebhookEndpointRow>;
      webhook_events: Table<WebhookEventRow>;
      webhook_deliveries: Table<WebhookDeliveryRow>;
      webhook_delivery_attempts: Table<WebhookDeliveryAttemptRow>;
    };
    Views: {
      people_directory: { Row: PeopleDirectoryRow; Relationships: [] };
    };
    Functions: {
      structured_import_context: { Args: { p_org: string; p_kind: string; p_rows: unknown }; Returns: unknown };
      save_structured_import: { Args: { p_org: string; p_source: unknown; p_source_hash: string; p_preview_hash: string; p_rows: unknown; p_key: string }; Returns: ImportJob };
      commit_structured_import: { Args: { p_org: string; p_job: string; p_revision: number }; Returns: ImportJob };
      list_curated_songs: { Args: { p_org: string; p_query?: unknown }; Returns: unknown };
      preview_song_bulk: { Args: { p_org: string; p_rows: unknown; p_patch: unknown }; Returns: SongBulkPreview };
      commit_song_bulk: { Args: { p_org: string; p_preview: string }; Returns: SongBulkPreview };
      archive_library_record: { Args: { p_org: string; p_kind: string; p_id: string; p_revision: number; p_archived: boolean }; Returns: unknown };
      preview_roster_bulk_change: {
        Args: {
          p_org: string;
          p_person_ids: string[];
          p_action: RosterBulkAction;
          p_tag?: string | null;
          p_team?: string | null;
          p_position?: string | null;
        };
        Returns: RosterBulkPreviewRow[];
      };
      apply_roster_bulk_change: {
        Args: {
          p_org: string;
          p_person_ids: string[];
          p_action: RosterBulkAction;
          p_tag: string | null;
          p_team: string | null;
          p_position: string | null;
          p_expected_changes: number;
          p_idempotency_key: string;
        };
        Returns: RosterBulkApplyResult;
      };
      create_organization: {
        Args: { p_name: string; p_slug: string; p_timezone?: string };
        Returns: OrganizationRow;
      };
      respond_to_own_assignment: {
        Args: {
          p_assignment_id: string;
          p_status: AssignmentStatus;
          p_expected_status: AssignmentStatus;
          p_reason?: string | null;
        };
        Returns: AssignmentRow[];
      };
      preview_assignment_responses: {
        Args: { p_organization_id: string; p_assignment_ids: string[] };
        Returns: AssignmentRequestSnapshotRow[];
      };
      respond_to_assignment_snapshots: {
        Args: { p_organization_id: string; p_responses: unknown; p_idempotency_key: string };
        Returns: unknown;
      };
      schedule_plan_assignments: {
        Args: {
          p_plan_id: string;
          p_assignments: Array<{
            person_id?: string | null;
            user_id?: string | null;
            team_id: string;
            position_id: string | null;
            notes: string | null;
            visibility?: AssignmentVisibility | null;
            attendance_mode?: AssignmentAttendanceMode | null;
            time_ids?: string[] | null;
          }>;
          p_notify: boolean;
          p_effect_key?: string | null;
          p_visibility?: AssignmentVisibility | null;
          p_response_owner?: string | null;
          p_conflict_override_reason?: string | null;
        };
        Returns: AssignmentRow[];
      };
      claim_signup_opportunity: { Args: { p_opportunity: string; p_expected_version: number; p_idempotency_key: string }; Returns: OpportunityClaimRow };
      list_signup_opportunities: { Args: { p_organization: string; p_plan?: string | null }; Returns: unknown };
      expire_f07_allocations: { Args: { p_organization: string; p_limit?: number }; Returns: number };
      decide_signup_claim: { Args: { p_claim: string; p_expected_version: number; p_action: 'approve' | 'reject' }; Returns: OpportunityClaimRow };
      cancel_signup_claim: { Args: { p_claim: string; p_expected_version: number }; Returns: OpportunityClaimRow };
      create_replacement_request: { Args: { p_assignment: string; p_expected_revision: number; p_idempotency_key: string; p_expires_at: string }; Returns: ReplacementRequestRow };
      cancel_replacement_request: { Args: { p_request: string; p_expected_version: number }; Returns: ReplacementRequestRow };
      issue_replacement_offer: { Args: { p_request: string; p_candidate: string; p_expected_version: number; p_idempotency_key: string }; Returns: ReplacementOfferRow };
      act_on_replacement_offer: { Args: { p_offer: string; p_expected_version: number; p_action: 'accept'|'decline'|'approve'|'reject' }; Returns: ReplacementOfferRow };
      create_approved_swap: { Args: { p_first: string; p_second: string; p_first_revision: number; p_second_revision: number; p_expires_at: string; p_idempotency_key: string }; Returns: ApprovedSwapRow };
      act_on_approved_swap: { Args: { p_swap: string; p_expected_version: number; p_action: 'consent'|'approve'|'cancel'|'reject' }; Returns: ApprovedSwapRow };
      release_plan_assignments: {
        Args: { p_plan_id: string; p_assignment_ids: string[]; p_notify: boolean; p_effect_key: string | null };
        Returns: AssignmentRow[];
      };
      release_plan_assignments_versioned: {
        Args: {
          p_plan_id: string;
          p_assignment_ids: string[];
          p_expected_revisions: Array<{ assignment_id: string; request_revision: number }>;
          p_notify: boolean;
          p_effect_key: string | null;
        };
        Returns: AssignmentRow[];
      };
      staffing_matrix_operation_id: {
        Args: { p_actions: unknown; p_base_revisions: unknown };
        Returns: string;
      };
      commit_staffing_matrix: {
        Args: {
          p_organization_id: string;
          p_operation_id: string;
          p_actions: unknown;
          p_base_revisions: unknown;
          p_idempotency_key: string;
        };
        Returns: unknown;
      };
      set_assignment_response_owner: {
        Args: { p_assignment_ids: string[]; p_owner: string };
        Returns: AssignmentRow[];
      };
      has_capability: {
        Args: { p_org: string; p_cap: AccessCapability; p_service_type?: string | null; p_team?: string | null };
        Returns: boolean;
      };
      user_can_schedule_assignment: {
        Args: { p_user: string; p_assignment: string };
        Returns: boolean;
      };
      my_effective_access: {
        Args: { p_org: string };
        Returns: EffectiveAccessRow[];
      };
      member_effective_access: {
        Args: { p_org: string; p_user: string };
        Returns: EffectiveAccessRow[];
      };
      explain_capability: {
        Args: {
          p_org: string;
          p_user: string;
          p_cap: AccessCapability;
          p_service_type?: string | null;
          p_team?: string | null;
        };
        Returns: unknown;
      };
      replace_scope_grants: {
        Args: { p_org: string; p_scope_type: AccessScopeType; p_scope_id: string | null; p_grants: Array<{ user_id: string; capability: AccessCapability }> };
        Returns: AccessGrantRow[];
      };
      my_profile: {
        Args: Record<string, never>;
        Returns: ProfileRow | null;
      };
      member_contacts: {
        Args: { p_org: string; p_user_ids: string[] };
        Returns: Array<{ user_id: string; email: string | null; phone: string | null }>;
      };
      person_medical_note: {
        Args: { p_person: string };
        Returns: string | null;
      };
      preview_folder_move: {
        Args: { p_folder: string; p_new_parent: string | null };
        Returns: AccessMoveChangeRow[];
      };
      preview_service_type_move: {
        Args: { p_service_type: string; p_folder: string | null };
        Returns: AccessMoveChangeRow[];
      };
      move_service_type_folder: {
        Args: { p_folder: string; p_new_parent: string | null; p_expected_revision: number | null; p_acknowledge_changes?: boolean };
        Returns: ServiceTypeFolderRow;
      };
      move_service_type: {
        Args: { p_service_type: string; p_folder: string | null; p_acknowledge_changes?: boolean };
        Returns: ServiceTypeRow;
      };
      set_landing_folder: {
        Args: { p_org: string; p_folder: string | null };
        Returns: null;
      };
      copy_service_type: {
        Args: { p_service_type: string; p_name: string; p_include_teams?: boolean };
        Returns: string;
      };
      team_candidates: {
        Args: { p_team: string };
        Returns: Array<{ person_id: string | null; profile_id: string | null; display_name: string | null; source: 'membership' | 'tag'; eligible: boolean }>;
      };
      team_eligibility_status: {
        Args: { p_team: string };
        Returns: Array<{ user_id: string; eligible: boolean; status: EligibilityStatus | null; expires_at: string | null }>;
      };
      enqueue_plan_notifications: {
        Args: {
          p_plan_id: string;
          p_template: DeliveryTemplate;
          p_assignment_ids: string[];
          p_effect_key: string;
        };
        Returns: string;
      };
      respond_via_assignment_link: {
        Args: { p_token_hash: string; p_status: AssignmentStatus };
        Returns: Array<{ outcome: 'ok' | 'not_found' | 'used' | 'expired' | 'stale'; assignments_updated: number; effect_id: string | null }>;
      };
      replace_plan_times: {
        Args: { p_plan_id: string; p_times: unknown; p_expected_revision?: number | null };
        Returns: PlanTimeRow[];
      };
      assignment_attendance_for: {
        Args: { p_assignment_ids: string[] };
        Returns: Array<{
          assignment_id: string;
          plan_time_id: string | null;
          kind: PlanTimeKind;
          name: string | null;
          starts_at: string;
          ends_at: string;
          source: AttendanceIntervalSource;
        }>;
      };
      check_assignment_conflicts: {
        Args: { p_organization_id: string; p_candidates: unknown; p_exclude_assignment_ids?: string[] };
        Returns: Array<{
          candidate_key: string;
          person_id: string;
          kind: ConflictKind;
          severity: ConflictSeverity;
          plan_time_id: string | null;
          interval_source: AttendanceIntervalSource;
          starts_at: string;
          ends_at: string;
          other_plan_id: string | null;
          other_assignment_id: string | null;
          other_plan_time_id: string | null;
          other_time_kind: PlanTimeKind | null;
          detail: string;
          redacted: boolean;
          override_permitted: boolean;
        }>;
      };
      set_assignment_attendance: {
        Args: {
          p_plan_id: string;
          p_changes: Array<{
            assignment_id: string;
            expected_request_revision: number;
            attendance_mode: AssignmentAttendanceMode;
            time_ids: string[];
          }>;
          p_conflict_override_reason?: string | null;
          p_notify?: boolean;
          p_effect_key?: string | null;
        };
        Returns: AssignmentRow[];
      };
      preview_plan_time_changes: {
        Args: { p_plan_id: string; p_times: unknown };
        Returns: unknown;
      };
      apply_plan_time_changes: {
        Args: {
          p_plan_id: string;
          p_times: unknown;
          p_expected_revision: number | null;
          p_impact_hash?: string | null;
          p_orphan_resolutions?: Array<{ assignment_id: string; action: 'all' | 'remove' }>;
          p_notify?: boolean;
          p_effect_key?: string | null;
        };
        Returns: unknown;
      };
      scheduling_conflicts_for_people: {
        Args: {
          p_organization_id: string;
          p_person_ids: string[];
          p_plan_time_ids: string[];
          p_exclude_assignment_ids?: string[];
        };
        Returns: Array<{
          person_id: string;
          conflict_type: 'blockout' | 'double_booked';
          detail: string | null;
          starts_at: string;
          ends_at: string;
          plan_id: string | null;
          assignment_id: string | null;
          plan_time_id: string;
        }>;
      };
      claim_deliveries: {
        Args: { p_worker: string; p_limit: number; p_lease_seconds: number; p_effect_id?: string | null };
        Returns: DeliveryRow[];
      };
      begin_delivery_provider_call: {
        Args: { p_delivery_id: string; p_worker: string };
        Returns: boolean;
      };
      complete_delivery: {
        Args: {
          p_delivery_id: string;
          p_worker: string;
          p_status: DeliveryStatus;
          p_error_code?: string | null;
          p_provider_message_id?: string | null;
          p_retry_after_seconds?: number | null;
        };
        Returns: DeliveryRow | null;
      };
      retry_delivery: {
        Args: { p_delivery_id: string };
        Returns: DeliveryRow;
      };
      create_release_batch: {
        Args: {
          p_org: string;
          p_items: Array<{ assignment_id: string; request_revision: number }>;
          p_notify: boolean;
          p_scheduled_for: string | null;
          p_idempotency_key: string;
        };
        Returns: ReleaseBatchRow;
      };
      cancel_release_batch: {
        Args: { p_batch: string };
        Returns: ReleaseBatchRow;
      };
      run_due_release_batches: {
        Args: { p_limit?: number };
        Returns: Array<{ batch_id: string; status: ReleaseBatchStatus; effect_id: string | null }>;
      };
      materialize_due_reminders: {
        Args: { p_limit?: number };
        Returns: Array<{ job_id: string; outcome: 'enqueued' | 'deferred' | 'cancelled' | 'skipped'; effect_id: string | null }>;
      };
      plan_reminder_jobs: {
        Args: { p_plan: string };
        Returns: ReminderJobRow[];
      };
      reminder_job_is_current: {
        Args: { p_job: string };
        Returns: boolean;
      };
      effective_reminder_policies: {
        Args: { p_org: string; p_service_type: string | null; p_team: string | null };
        Returns: EffectiveReminderPolicy[];
      };
      issue_assignment_link: {
        Args: {
          p_delivery: string;
          p_snapshot: string;
          p_token_hash: string;
          p_expires_at: string;
          p_email: string;
        };
        Returns: string;
      };
      duplicate_plan: {
        Args: {
          p_source_plan_id: string;
          p_service_date: string;
          p_title?: string | null;
          p_copy_assignments?: boolean;
          p_idempotency_key?: string | null;
          p_conflict_override_reason?: string | null;
        };
        Returns: string;
      };
      create_plan: {
        Args: {
          p_organization_id: string;
          p_plan: {
            title: string;
            service_type_id?: string | null;
            service_date: string;
            location?: string | null;
            status?: PlanStatus;
            notes?: string | null;
          };
          p_times?: Array<{ kind: PlanTimeKind; name?: string | null; starts_at: string; ends_at: string }>;
          p_copy_from?: string | null;
          p_copy_assignments?: boolean;
          p_idempotency_key?: string | null;
          p_conflict_override_reason?: string | null;
        };
        Returns: string;
      };
      import_plan_contents: {
        Args: {
          p_target_plan_id: string;
          p_source_plan_id: string;
          p_items: boolean;
          p_needs: boolean;
          p_assignments: boolean;
          p_expected_revision?: number | null;
          p_idempotency_key?: string | null;
          p_conflict_override_reason?: string | null;
        };
        Returns: number;
      };
      scheduling_conflicts: {
        Args: {
          p_organization_id: string;
          p_starts_at: string;
          p_ends_at: string;
          p_user_ids?: string[] | null;
        };
        Returns: SchedulingConflictRow[];
      };
      accept_person_invitation: {
        Args: { p_token_hash: string; p_new_user_id: string };
        Returns: AcceptPersonInvitationRow[];
      };
      create_guest_person: {
        Args: { p_org: string; p_first_name: string; p_last_name?: string | null; p_email?: string | null };
        Returns: string;
      };
      create_plan_position: {
        Args: { p_plan: string; p_team: string; p_name: string; p_needed?: number };
        Returns: TeamPositionRow;
      };
      delete_plan_position: {
        Args: { p_position: string };
        Returns: undefined;
      };
      person_delivery_readiness: {
        Args: { p_org: string; p_person_ids: string[] };
        Returns: PersonDeliveryReadiness[];
      };
      user_can_read_item_thread: {
        Args: { p_user: string; p_plan: string };
        Returns: boolean;
      };
      operational_message_recipient_current: {
        Args: { p_message: string; p_person: string };
        Returns: boolean;
      };
      user_can_access_conversation: {
        Args: { p_user: string; p_conversation: string };
        Returns: boolean;
      };
      purge_expired_conversation_messages: {
        Args: { p_limit?: number };
        Returns: number;
      };
      save_plan_template: {
        Args: {
          p_organization_id: string;
          p_template_id?: string | null;
          p_expected_revision?: number | null;
          p_kind?: string | null;
          p_service_type_id?: string | null;
          p_name?: string | null;
          p_description?: string | null;
          p_content?: unknown;
          p_source_plan_id?: string | null;
          p_source_components?: string[] | null;
        };
        Returns: PlanTemplateSaveResult;
      };
      set_plan_template_archived: {
        Args: { p_template_id: string; p_archived: boolean };
        Returns: undefined;
      };
      preview_plan_template_apply: {
        Args: {
          p_plan_id: string;
          p_revision_id: string;
          p_mode: string;
          p_components: string[];
          p_times?: unknown;
          p_insert_at?: number | null;
        };
        Returns: TemplateApplyPreviewResult;
      };
      update_plan_item: {
        Args: { p_plan_id: string; p_item_id: string; p_patch: unknown; p_expected_revision?: number | null };
        Returns: PlanItemSaveResult;
      };
      reorder_plan_items: {
        Args: { p_plan_id: string; p_item_ids: string[]; p_expected_revision?: number | null };
        Returns: PlanOrderSaveResult;
      };
      delete_plan_item: {
        Args: { p_plan_id: string; p_item_id: string; p_expected_revision?: number | null };
        Returns: PlanOrderSaveResult;
      };
      create_file_upload_intent: {
        Args: {
          p_owner_kind: FileOwnerKind;
          p_owner_id: string;
          p_attachment: string | null;
          p_expected_revision: number | null;
          p_filename: string;
          p_mime_type: string;
          p_size_bytes: number;
          p_title: string | null;
          p_category: FileCategory;
          p_audience: FileAudience;
          p_team_ids: string[];
          p_position_ids: string[];
          p_idempotency_key: string;
        };
        Returns: FileUploadIntentRpcResult;
      };
      finalize_file_version: {
        Args: { p_version: string };
        Returns: FileFinalizeRpcResult;
      };
      abandon_file_version: {
        Args: { p_version: string };
        Returns: FileAbandonRpcResult;
      };
      save_file_content: {
        Args: {
          p_owner_kind: FileOwnerKind | null;
          p_owner_id: string | null;
          p_attachment: string | null;
          p_expected_revision: number | null;
          p_kind: FileKind;
          p_title: string;
          p_external_url: string | null;
          p_document_body: string | null;
          p_category: FileCategory;
          p_audience: FileAudience;
          p_team_ids: string[];
          p_position_ids: string[];
          p_idempotency_key: string | null;
        };
        Returns: FileSaveRpcResult;
      };
      update_file: {
        Args: {
          p_attachment: string;
          p_expected_revision: number;
          p_title: string;
          p_category: FileCategory;
          p_audience: FileAudience;
          p_team_ids: string[];
          p_position_ids: string[];
          p_move_owner_kind: FileOwnerKind | null;
          p_move_owner_id: string | null;
        };
        Returns: FileSaveRpcResult;
      };
      set_file_archived: {
        Args: { p_attachment: string; p_expected_revision: number; p_archived: boolean };
        Returns: FileSaveRpcResult;
      };
      delete_file: {
        Args: { p_attachment: string; p_expected_revision: number };
        Returns: undefined;
      };
      link_file_to_plan: {
        Args: { p_plan: string; p_item: string | null; p_attachment: string; p_pin: boolean };
        Returns: AttachmentLinkRow;
      };
      set_file_link_pin: {
        Args: { p_link: string; p_version: string | null; p_follow: boolean };
        Returns: AttachmentLinkRow;
      };
      unlink_file: {
        Args: { p_link: string };
        Returns: undefined;
      };
      set_file_playback_rights: {
        Args: { p_attachment: string; p_expected_revision: number; p_rights: FilePlaybackRights };
        Returns: AttachmentRow;
      };
      // F16
      record_attendance: {
        Args: { p_plan_time_id: string; p_marks: AttendanceMarkRpc[]; p_reason: string | null; p_idempotency_key: string };
        Returns: AttendanceBatchResult;
      };
      request_report_export: {
        Args: { p_org: string; p_kind: string; p_filters: Record<string, unknown>; p_idempotency_key: string };
        Returns: ReportExportRow;
      };
      retry_report_export: {
        Args: { p_export: string };
        Returns: ReportExportRow;
      };
      claim_report_exports: {
        Args: { p_limit: number; p_lease_seconds: number };
        Returns: ReportExportRow[];
      };
      report_requester_access: {
        Args: { p_org: string; p_user: string };
        Returns: EffectiveAccessRow[];
      };
      team_calendar_layers: {
        Args: { p_team: string; p_from: string; p_to: string; p_layers: string[] };
        Returns: TeamCalendarLayerRpcRow[];
      };
      scoped_feed_access_for: {
        Args: { p_user: string; p_org: string; p_scope: string; p_service_type: string | null; p_team: string | null };
        Returns: ScopedFeedAccess | null;
      };
      team_calendar_layers_for: {
        Args: { p_user: string; p_team: string; p_from: string; p_to: string; p_layers: string[] };
        Returns: TeamCalendarLayerRpcRow[];
      };
      can_set_person_calendar_sharing: {
        Args: { p_person: string };
        Returns: boolean;
      };
      publish_plan: {
        Args: { p_plan: string; p_fields: string[]; p_mode: string; p_expected_revision: number; p_new_slug: boolean };
        Returns: PlanPublicationRow;
      };
      revoke_plan_publication: {
        Args: { p_plan: string; p_expected_revision: number };
        Returns: PlanPublicationRow;
      };
      create_api_credential: {
        Args: {
          p_org: string;
          p_name: string;
          p_scopes: string[];
          p_key_prefix: string;
          p_secret_hash: string;
          p_expires_at: string | null;
          p_rate_limit_per_minute: number;
          p_idempotency_key: string;
        };
        Returns: Array<{ credential_id: string; replayed: boolean }>;
      };
      revoke_api_credential: { Args: { p_credential: string }; Returns: undefined };
      api_authenticate: {
        Args: { p_key_prefix: string; p_secret_hash: string };
        Returns: ApiAuthenticateRpcRow[];
      };
      api_organization: { Args: { p_credential: string }; Returns: Array<{ id: string; name: string; timezone: string }> };
      api_service_types: {
        Args: { p_credential: string; p_after: string | null; p_limit: number };
        Returns: Array<{ id: string; name: string; description: string | null; updated_at: string }>;
      };
      api_plans: {
        Args: {
          p_credential: string;
          p_from: string;
          p_to: string;
          p_service_type: string | null;
          p_after_date: string | null;
          p_after_id: string | null;
          p_limit: number;
        };
        Returns: Array<{
          id: string;
          service_type_id: string | null;
          title: string;
          service_date: string;
          location: string | null;
          updated_at: string;
        }>;
      };
      api_plan: { Args: { p_credential: string; p_plan: string }; Returns: unknown };
      api_songs: {
        Args: { p_credential: string; p_query: string | null; p_after: string | null; p_limit: number };
        Returns: Array<{
          id: string;
          title: string;
          author: string | null;
          ccli_number: string | null;
          default_key: string | null;
          themes: string[];
          updated_at: string;
        }>;
      };
      create_webhook_endpoint: {
        Args: {
          p_org: string;
          p_url: string;
          p_description: string | null;
          p_event_types: string[];
          p_secret_ciphertext: string;
          p_secret_hint: string;
          p_idempotency_key: string;
        };
        Returns: Array<{ endpoint_id: string; replayed: boolean }>;
      };
      set_webhook_endpoint_enabled: {
        Args: { p_endpoint: string; p_enabled: boolean; p_expected_revision: number };
        Returns: undefined;
      };
      revoke_webhook_endpoint: { Args: { p_endpoint: string }; Returns: undefined };
      send_webhook_test: { Args: { p_endpoint: string }; Returns: string };
      retry_webhook_delivery: { Args: { p_delivery: string }; Returns: undefined };
      claim_webhook_deliveries: {
        Args: { p_limit: number; p_lease_seconds: number };
        Returns: WebhookClaimRpcRow[];
      };
      complete_webhook_delivery: {
        Args: {
          p_delivery: string;
          p_attempt: number;
          p_outcome: string;
          p_status_code: number | null;
          p_error_code: string | null;
          p_started_at: string;
          p_duration_ms: number | null;
          p_retry_after_seconds: number | null;
        };
        Returns: string;
      };
      prune_webhook_history: { Args: { p_limit?: number }; Returns: number };
      set_public_set_list_link: {
        Args: { p_service_type: string; p_kind: string; p_action: string };
        Returns: PublicSetListLinkRow;
      };
      set_plan_item_media: {
        Args: { p_plan_id: string; p_item_id: string; p_media_id: string | null; p_expected_revision: number | null };
        Returns: PlanItemSaveResult;
      };
      can_add_file: {
        Args: { p_owner_kind: FileOwnerKind; p_owner_id: string };
        Returns: boolean;
      };
      writable_file_ids: {
        Args: { p_ids: string[] };
        Returns: string[];
      };
      expire_file_uploads: {
        Args: { p_limit?: number };
        Returns: number;
      };
      claim_file_object_removals: {
        Args: { p_limit?: number };
        Returns: FileObjectRemovalRow[];
      };
      complete_file_object_removals: {
        Args: { p_removed: number[]; p_failed: number[]; p_error: string | null };
        Returns: undefined;
      };
      create_live_run: {
        Args: {
          p_plan_id: string;
          p_plan_time_id: string;
          p_countdown_policy: string;
          p_idempotency_key: string;
          p_client_id: string;
        };
        Returns: LiveRunCommandResult;
      };
      live_run_action: {
        Args: {
          p_run_id: string;
          p_action: string;
          p_expected_revision: number | null;
          p_client_id: string;
          p_action_id: string | null;
          p_target_index?: number | null;
          p_reason?: string | null;
          p_countdown_policy?: string | null;
        };
        Returns: LiveRunCommandResult;
      };
      live_run_state: {
        Args: { p_run_id: string };
        Returns: LiveRunStateRecord | null;
      };
      live_server_now: {
        Args: Record<string, never>;
        Returns: string;
      };
      can_edit_plan: {
        Args: { p_plan: string };
        Returns: boolean;
      };
      correct_live_run_time: {
        Args: {
          p_run_id: string;
          p_transition_id: number;
          p_corrected_at: string;
          p_reason: string;
          p_expected_revision: number;
        };
        Returns: LiveRunCommandResult;
      };
      apply_plan_template: {
        Args: {
          p_plan_id: string;
          p_revision_id: string;
          p_mode: string;
          p_components: string[];
          p_preview_hash: string;
          p_times?: unknown;
          p_insert_at?: number | null;
          p_expected_revision?: number | null;
          p_idempotency_key?: string | null;
          p_conflict_override_reason?: string | null;
        };
        Returns: TemplateApplyCommit;
      };
      preview_plan_generation: {
        Args: { p_organization_id: string; p_revision_id: string; p_components: string[]; p_plans: unknown };
        Returns: unknown;
      };
      generate_plans_from_template: {
        Args: {
          p_organization_id: string;
          p_revision_id: string;
          p_components: string[];
          p_plans: unknown;
          p_preview_hash: string;
          p_idempotency_key: string;
          p_series?: unknown;
          p_conflict_override_reason?: string | null;
        };
        Returns: PlanGenerationCommit;
      };
      preview_plan_reschedule: {
        Args: {
          p_organization_id: string;
          p_mode: string;
          p_moves?: unknown;
          p_order?: unknown;
          p_reset_responses?: boolean;
          p_notify?: boolean;
        };
        Returns: ReschedulePreview;
      };
      reschedule_plans: {
        Args: {
          p_organization_id: string;
          p_mode: string;
          p_preview_hash: string;
          p_idempotency_key: string;
          p_moves?: unknown;
          p_order?: unknown;
          p_reset_responses?: boolean;
          p_notify?: boolean;
          p_conflict_override_reason?: string | null;
        };
        Returns: RescheduleResult;
      };
      resolve_person_reconciliation: {
        Args: { p_id: string; p_action: 'keep_separate' | 'merge' };
        Returns: PersonIdentityReconciliationRow;
      };
    };
    Enums: {
      org_role: OrgRole;
      member_status: MemberStatus;
      plan_status: PlanStatus;
      plan_time_kind: PlanTimeKind;
      plan_item_type: PlanItemType;
      assignment_status: AssignmentStatus;
      notification_type: NotificationType;
      delivery_channel: DeliveryChannel;
      delivery_status: DeliveryStatus;
      delivery_template: DeliveryTemplate;
      access_capability: AccessCapability;
      release_batch_status: ReleaseBatchStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}
