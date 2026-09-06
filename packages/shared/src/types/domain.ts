import type {
  ArrangementRow,
  AssignmentRow,
  BlockoutRow,
  ChordSheetImportRow,
  MemberStatus,
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
  ServiceTypeRow,
  SongRow,
  SongbookRow,
  TeamPositionRow,
  TeamRow,
} from './database.js';

/** The signed-in user plus every organization they belong to. */
export interface CurrentUser {
  profile: ProfileRow;
  memberships: Array<{
    organization: OrganizationRow;
    role: OrgRole;
  }>;
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
  plan_title: string;
  service_date: string;
  service_time: { starts_at: string; ends_at: string } | null;
  location: string | null;
  person_first_name: string;
  assignments: Array<{
    team_name: string;
    position_name: string | null;
    status: AssignmentRow['status'];
  }>;
  expires_at: string;
}

export interface AssignmentRespondResult {
  status: Extract<AssignmentRow['status'], 'confirmed' | 'declined'>;
  assignments_updated: number;
}

export interface CalendarFeedTokenResponse {
  url: string | null;
  webcal_url: string | null;
  token?: string;
  active?: boolean;
}

export interface AssignmentNotificationSendResult {
  notified: number;
  skipped: string[];
}

export interface TeamWithPositions extends TeamRow {
  positions: TeamPositionRow[];
  members: Array<{ user_id: string; position_id: string | null; profile: PersonSummary | null }>;
}

export interface SongWithArrangements extends SongRow {
  arrangements: ArrangementRow[];
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
  song: Pick<SongRow, 'id' | 'title' | 'author' | 'default_key'> | null;
  arrangement: Pick<ArrangementRow, 'id' | 'name' | 'song_key' | 'bpm' | 'chord_chart'> | null;
}

export interface AssignmentDetail extends AssignmentRow {
  person: PersonSummary | null;
  team: Pick<TeamRow, 'id' | 'name' | 'color'> | null;
  position: Pick<TeamPositionRow, 'id' | 'name'> | null;
}

export interface PlanSummary extends PlanRow {
  service_type: Pick<ServiceTypeRow, 'id' | 'name'> | null;
  times: PlanTimeRow[];
  counts: {
    items: number;
    songs: number;
    confirmed: number;
    unconfirmed: number;
    declined: number;
  };
}

export interface PlanDetail extends PlanSummary {
  items: PlanItemDetail[];
  assignments: AssignmentDetail[];
  total_length_seconds: number;
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
  plan: Pick<PlanRow, 'id' | 'title' | 'service_date' | 'location' | 'status'>;
  team: Pick<TeamRow, 'id' | 'name' | 'color'> | null;
  position: Pick<TeamPositionRow, 'id' | 'name'> | null;
  times: PlanTimeRow[];
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
 * How much of today's AI chord-sheet-import allowance an admin has left.
 * Returned by `GET /api/v1/imports/quota` and echoed in the 429 body when the
 * allowance runs out.
 */
export interface ImportQuota {
  /** Imports allowed per admin per day. */
  limit: number;
  used: number;
  remaining: number;
  /** ISO timestamp of the next reset — midnight in the organization's timezone. */
  resets_at: string;
}

/** An import row returned by a call that also charged the quota. */
export interface ImportWithQuota extends ChordSheetImportRow {
  quota: ImportQuota;
}
