import type {
  AccessCapability,
  AccessGrantRow,
  AccessMode,
  AccessMoveChangeRow,
  AccessScopeType,
  ArrangementRow,
  AssignmentRow,
  AssignmentStatus,
  AssignmentTimeResponseRow,
  BlockoutRow,
  DeliveryChannel,
  DeliveryStatus,
  DeliveryTemplate,
  DevicePlatform,
  MemberStatus,
  NotificationRow,
  OrgRole,
  OrganizationMemberRow,
  OrganizationRow,
  PersonInvitationRow,
  PersonRow,
  PlanItemRow,
  PlanRow,
  PlanTimeRow,
  ProfileRow,
  SchedulingConflictRow,
  ServiceTypeFolderRow,
  ServiceTypeRow,
  SongRow,
  SongbookRow,
  TeamPositionRow,
  TeamRow,
} from './database.js';
import type { ChartNotation } from '../lib/chordpro.js';

/** One rule of effective access: a capability at a scope, and where it comes from. */
export interface EffectiveAccessEntry {
  capability: AccessCapability;
  /** Folder grants are also listed expanded to each service type beneath them. */
  scope_type: AccessScopeType;
  scope_id: string | null;
  source: 'role:owner' | 'role:admin' | 'role:scheduler_legacy' | 'grant' | 'grant:folder';
  grant_id: string | null;
}

/** What one member may do in one organization, as resolved by the database. */
export interface EffectiveAccess {
  organization_id: string;
  user_id: string;
  role: OrgRole;
  access_mode: AccessMode;
  /** Only owners/admins review and change access; no grant confers this. */
  can_administer_access: boolean;
  entries: EffectiveAccessEntry[];
}

export interface CurrentUserMembership {
  organization: OrganizationRow;
  role: OrgRole;
  access: EffectiveAccess;
}

/** The signed-in user plus every organization they belong to. */
export interface CurrentUser {
  profile: ProfileRow;
  memberships: CurrentUserMembership[];
}

export type CapabilityDenial =
  | 'not_a_member'
  | 'membership_inactive'
  | 'scoped_scheduler_without_grant'
  | 'grant_outside_scope'
  | 'no_matching_grant';

/** Why a member is allowed or denied one capability at one scope. */
export interface CapabilityExplanation {
  allowed: boolean;
  capability: AccessCapability;
  role: OrgRole | null;
  access_mode: AccessMode | null;
  reasons: Array<Pick<EffectiveAccessEntry, 'source' | 'scope_type' | 'scope_id' | 'grant_id'>>;
  denial: CapabilityDenial | null;
}

/** One member in the administrator's access review. */
export interface AccessMember {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  role: OrgRole;
  access_mode: AccessMode;
  grants: AccessGrantRow[];
}

/** The grants held at one service type, team, folder or the organization. */
export interface ScopeAccess {
  scope_type: AccessScopeType;
  scope_id: string | null;
  grants: Array<Pick<AccessGrantRow, 'id' | 'user_id' | 'capability' | 'created_at'> & { full_name: string | null }>;
}

export type AccessMoveChange = AccessMoveChangeRow;

export interface ServiceTypeFolderNode extends ServiceTypeFolderRow {
  children: ServiceTypeFolderNode[];
  service_type_ids: string[];
}

export interface FolderTree {
  folders: ServiceTypeFolderNode[];
  /** Service types not in any folder. */
  unfiled_service_type_ids: string[];
  landing_folder_id: string | null;
}

export interface TeamCandidate {
  person_id: string | null;
  profile_id: string | null;
  display_name: string | null;
  source: 'membership' | 'tag';
  /** False on a secure team without current eligibility evidence. */
  eligible: boolean;
}

export interface TeamEligibilityEntry {
  user_id: string;
  eligible: boolean;
  status: 'clear' | 'not_clear' | 'pending' | null;
  expires_at: string | null;
}

/** The team settings that drive F01 policies, for the team settings view. */
export interface TeamPolicySettings {
  team_id: string;
  tag_rules: string[];
  /** Teams whose members may see this team's roster when rosters are restricted to teams. */
  related_team_ids: string[];
  service_type_ids: string[];
}

/** Returned once per device registration; keep the revocation secret in memory only. */
export interface DeviceRegistration {
  token: string;
  platform: DevicePlatform;
  device_name: string | null;
  lease_expires_at: string;
  revocation_secret: string;
}

export interface PersonSummary {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  phone: string | null;
  role: OrgRole;
}

/**
 * One row in the People list. Unifies real (has-login) members with roster
 * entries that don't have a login yet — `id` is the profile id in the
 * former case and the `people` row id in the latter, so it's always usable
 * as a stable list/react key.
 */
export interface RosterPerson {
  id: string;
  person_id: string | null;
  profile_id: string | null;
  has_login: boolean;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  role: OrgRole | null;
  status: MemberStatus | 'no_account';
  campus: string | null;
  invite_pending: boolean;
  /** F02: archived people are listed only on request and offered in no picker. */
  archived: boolean;
}

export interface PersonDetail extends PersonRow {
  profile: ProfileRow | null;
  membership: Pick<OrganizationMemberRow, 'role' | 'status'> | null;
  pending_invitation: Pick<PersonInvitationRow, 'id' | 'email' | 'role' | 'expires_at'> | null;
}

export interface InvitationPreview {
  organization_name: string;
  person_first_name: string;
  email: string;
  role: OrgRole;
  expires_at: string;
}

export interface AssignmentRespondPreview {
  snapshot_id: string;
  snapshot_version: number;
  plan_title: string;
  service_date: string;
  service_time: { starts_at: string; ends_at: string } | null;
  location: string | null;
  person_first_name: string;
  assignments: Array<{
    assignment_id: string;
    team_name: string;
    position_name: string | null;
    status: AssignmentRow['status'];
    request_revision: number;
    times: PlanTimeRow[];
    time_responses: AssignmentTimeResponseRow[];
  }>;
  expires_at: string;
}

export interface AssignmentRespondResult {
  status: Extract<AssignmentRow['status'], 'confirmed' | 'declined'>;
  assignments_updated: number;
}

export interface AssignmentResponseReviewItem {
  assignment_id: string;
  plan_id: string;
  plan_title: string;
  team_name: string;
  position_name: string | null;
  status: AssignmentStatus;
  request_revision: number;
  times: PlanTimeRow[];
  time_responses: AssignmentTimeResponseRow[];
}

export interface AssignmentResponseReview {
  snapshot_id: string;
  version: number;
  person_id: string;
  plan_id: string;
  expires_at: string;
  assignments: AssignmentResponseReviewItem[];
}

export interface AssignmentResponseCommitResult {
  snapshots: Array<{ snapshot_id: string; assignments_updated: number }>;
  effect_ids: string[];
}

export interface AssignmentReleasePreview {
  plan_id: string;
  assignments: Array<{
    assignment_id: string;
    person_id: string;
    person_name: string;
    team_name: string;
    position_name: string | null;
    request_revision: number;
    times: PlanTimeRow[];
  }>;
}

export interface CalendarFeedTokenResponse {
  url: string | null;
  webcal_url: string | null;
  token?: string;
  active?: boolean;
}

/** How this server's transports are configured. */
export type EmailTransportMode = 'resend' | 'simulated';
export type PushTransportMode = 'expo' | 'simulated';

/** Per-recipient, per-channel outcome of one delivery. */
export interface DeliveryOutcome {
  id: string;
  recipient_id: string | null;
  recipient_person_id: string;
  recipient_name: string | null;
  channel: DeliveryChannel;
  status: DeliveryStatus;
  attempts: number;
  /** Short machine code, e.g. `no_email_address`; never provider text. */
  error_code: string | null;
  /** Set only once a provider accepted the message (or the feed row exists). */
  accepted_at: string | null;
  delivered_at: string | null;
  completed_at: string | null;
  /** When a queued delivery will next be tried. */
  next_attempt_at: string | null;
  /** True when an administrator may retry it now (failed or ambiguous). */
  retryable: boolean;
}

/** Counts of outcomes for one channel. */
export type DeliveryStatusCounts = Partial<Record<DeliveryStatus, number>>;

export interface DeliveryOutcomeSummary {
  in_app: DeliveryStatusCounts;
  push: DeliveryStatusCounts;
  email: DeliveryStatusCounts;
}

/** A row in the administrator's delivery list. */
export interface DeliveryListItem extends DeliveryOutcome {
  template: DeliveryTemplate;
  plan_id: string | null;
  plan_title: string | null;
  created_at: string;
}

export interface DeliveryList {
  data: DeliveryListItem[];
  /** Pass as `before` to load the next page; null when there is no more. */
  next_before: string | null;
}

/** Transport configuration and queue health, for administrators. */
export interface DeliveryTransportStatus {
  email: EmailTransportMode;
  push: PushTransportMode;
  /** True when the authenticated worker entry point is configured. */
  worker_configured: boolean;
  /** This organization's deliveries waiting for (or held by) a worker. */
  pending: number;
  /** This organization's failed or ambiguous deliveries. */
  needs_attention: number;
}

export interface AssignmentNotificationSendResult {
  /**
   * People whose email a provider accepted. Kept for older clients; a
   * simulated send is not counted. Prefer `outcomes`/`summary`.
   */
  notified: number;
  /** Names of people with no email address on file. */
  skipped: string[];
  /** The logical action every outcome below belongs to; null when nobody was due. */
  effect_id: string | null;
  email_mode: EmailTransportMode;
  outcomes: DeliveryOutcome[];
  summary: DeliveryOutcomeSummary;
}

/** Result of importing another plan's contents into a plan. */
export interface ImportPlanContentsResult {
  plan: PlanDetail;
  /** The plan's content revision after the import. */
  content_revision: number;
}

export interface TeamWithPositions extends TeamRow {
  positions: TeamPositionRow[];
  members: Array<{
    person_id: string;
    user_id: string | null;
    position_id: string | null;
    profile: PersonSummary | null;
  }>;
}

export interface SongWithArrangements extends SongRow {
  arrangements: ArrangementRow[];
}

/**
 * A row of the song library table. `last_scheduled_at` is the service date of
 * the most recent plan the song appeared in — it is aggregated per page rather
 * than stored, so it never goes stale.
 */
export interface SongListItem extends SongWithArrangements {
  last_scheduled_at: string | null;
}

/**
 * One service a song was scheduled in, newest first — what the Schedule panel
 * on the song page lists. Aggregated per request from `plan_items`, so it
 * follows a plan being re-dated or deleted without any denormalised state.
 */
export interface SongScheduleEntry {
  plan_id: string;
  plan_title: string;
  service_date: string;
  service_type_name: string | null;
  /** The arrangement that was scheduled, when the plan item named one. */
  arrangement_id: string | null;
  arrangement_name: string | null;
  /** The key it was played in: the plan's override, else the arrangement's. */
  key: string | null;
}

/** `GET /api/v1/arrangements/:id/chart` — transposed and/or converted. */
export interface SongChart {
  chordpro: string;
  /** Null once the chart is key-independent (numbers, numerals, lyrics). */
  key: string | null;
  semitones: number;
  notation: ChartNotation;
}

export interface SongbookDetail extends SongbookRow {
  document_url?: string | null;
  items: Array<{
    id: string;
    sort_order: number;
    song: Pick<SongRow, 'id' | 'title' | 'author' | 'copyright' | 'default_key'>;
    arrangement: Pick<ArrangementRow, 'id' | 'name' | 'song_key' | 'chord_chart'> | null;
  }>;
}

export interface PlanItemDetail extends PlanItemRow {
  song: Pick<
    SongRow,
    'id' | 'title' | 'author' | 'copyright' | 'default_key' | 'default_bpm'
  > | null;
  arrangement: Pick<
    ArrangementRow,
    | 'id'
    | 'name'
    | 'song_key'
    | 'bpm'
    | 'sequence'
    | 'chord_chart'
    | 'chart_columns'
    | 'chart_font'
    | 'chart_font_size'
    | 'chart_chord_color'
  > | null;
}

export interface AssignmentDetail extends AssignmentRow {
  person: PersonSummary | null;
  /** Who hears this request's answer. */
  response_owner: Pick<ProfileRow, 'id' | 'full_name'> | null;
  team: Pick<TeamRow, 'id' | 'name' | 'color'> | null;
  position: Pick<TeamPositionRow, 'id' | 'name'> | null;
  /** Explicit selection when attendance_mode is selected. */
  attendance_times: Array<{ plan_time_id: string }>;
  time_responses: AssignmentTimeResponseRow[];
}

/**
 * One position's staffing need on a plan. `team_id` is resolved from the
 * position rather than stored, so it can never disagree with the position.
 */
export interface PlanPositionNeed {
  position_id: string;
  team_id: string;
  needed: number;
}

export interface PlanSummary extends PlanRow {
  service_type: Pick<ServiceTypeRow, 'id' | 'name' | 'recurrence'> | null;
  times: PlanTimeRow[];
  counts: {
    items: number;
    songs: number;
    confirmed: number;
    unconfirmed: number;
    declined: number;
    /** Prepared requests the caller can see as a scheduler; never sent yet. */
    prepared: number;
  };
}

export interface PlanDetail extends PlanSummary {
  items: PlanItemDetail[];
  assignments: AssignmentDetail[];
  /** F02: positions added for this plan only, by team. Not part of any team's normal list. */
  plan_positions: TeamPositionRow[];
  /** Only positions a manager has actually asked for; absent means "none needed". */
  position_needs: PlanPositionNeed[];
  total_length_seconds: number;
}

/** One of the ready-made teams the "add teams you lead" step offers. */
export type TeamTemplateCategory = 'music' | 'technical' | 'kids' | 'hospitality' | 'other';

export interface TeamTemplate {
  category: TeamTemplateCategory;
  name: string;
  color: string;
  /** Seeded as the team's positions; every one of them is editable afterwards. */
  positions: readonly string[];
}

/** What `POST /api/v1/service-types/setup` hands back once the wizard finishes. */
export interface ServiceTypeSetupResult {
  service_type: ServiceTypeRow;
  plan: PlanDetail;
  teams: TeamRow[];
}

/** One entry in the calendar — a service or rehearsal block. */
export interface CalendarEvent {
  id: string;
  plan_id: string;
  title: string;
  kind: PlanTimeRow['kind'];
  starts_at: string;
  ends_at: string;
  status: PlanRow['status'];
  location: string | null;
  service_type: string | null;
  /** Present when the request asked for the current user's own schedule. */
  my_assignment_status?: AssignmentRow['status'];
}

/** An assignment as it appears in "My Schedule". */
export interface MyScheduleEntry {
  assignment: AssignmentRow;
  /** The person's own reason from their latest decline; only they and schedulers can read it. */
  response_note: string | null;
  plan: Pick<PlanRow, 'id' | 'title' | 'service_date' | 'location' | 'status'>;
  team: Pick<TeamRow, 'id' | 'name' | 'color'> | null;
  position: Pick<TeamPositionRow, 'id' | 'name'> | null;
  times: PlanTimeRow[];
  time_responses: AssignmentTimeResponseRow[];
}

export interface BlockoutWithPerson extends BlockoutRow {
  person: PersonSummary | null;
}

export type SchedulingConflict = SchedulingConflictRow;

export interface Paginated<T> {
  data: T[];
  page: number;
  per_page: number;
  total: number;
}

/**
 * One entry in the notification centre behind the bell icon. The plan title is
 * denormalised into `title`/`body` when the row is written, so the feed renders
 * without a join — `plan_id` is only there to make the row tappable.
 */
export interface NotificationFeedItem extends NotificationRow {
  /** Null when the plan has since been deleted. */
  plan: Pick<PlanRow, 'id' | 'title' | 'service_date'> | null;
}

/** `GET /api/v1/notifications` — newest first, with the badge count alongside. */
export interface NotificationFeed {
  items: NotificationFeedItem[];
  /** Unread across the whole organization, not just this page. */
  unread: number;
  /** `created_at` of the oldest row returned; pass as `before` for the next page. */
  next_cursor: string | null;
}

/** `GET /api/v1/notifications/unread-count` — cheap enough to poll for the badge. */
export interface UnreadNotificationCount {
  unread: number;
}
