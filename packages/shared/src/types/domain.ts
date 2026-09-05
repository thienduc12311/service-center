import type {
  ArrangementRow,
  AssignmentRow,
  BlockoutRow,
  OrgRole,
  OrganizationRow,
  PlanItemRow,
  PlanRow,
  PlanTimeRow,
  ProfileRow,
  SchedulingConflictRow,
  ServiceTypeRow,
  SongRow,
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

export interface TeamWithPositions extends TeamRow {
  positions: TeamPositionRow[];
  members: Array<{ user_id: string; position_id: string | null; profile: PersonSummary | null }>;
}

export interface SongWithArrangements extends SongRow {
  arrangements: ArrangementRow[];
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
