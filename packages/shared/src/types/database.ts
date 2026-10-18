/**
 * Shape of the Postgres schema as supabase-js expects it.
 *
 * Kept hand-written (rather than `supabase gen types`) so the whole workspace
 * has a single source of truth that also compiles without a running database.
 * Regenerate-and-diff with:
 *   supabase gen types typescript --local > /tmp/db.ts
 */

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

/**
 * Row types are exact — every read is precisely typed. Insert and Update are
 * deliberately permissive: request handlers build payloads by spreading
 * Zod-validated objects, which an exact type would reject for reasons that
 * have nothing to do with correctness.
 */
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
  | 'plan_updated';
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
export type DeliveryTemplate = 'assignment_request' | 'assignment_reminder' | 'scheduler_response';
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

export type ArrangementRow = {
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
  created_at: string;
  updated_at: string;
}

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
  user_id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
  created_at: string;
}

export type AttachmentRow = {
  id: string;
  organization_id: string;
  song_id: string | null;
  arrangement_id: string | null;
  plan_id: string | null;
  storage_path: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_by: string | null;
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
      songs: Table<SongRow>;
      arrangements: Table<ArrangementRow>;
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
      attachments: Table<AttachmentRow>;
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
    };
    Views: {
      people_directory: { Row: PeopleDirectoryRow; Relationships: [] };
    };
    Functions: {
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
        };
        Returns: AssignmentRow[];
      };
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
      duplicate_plan: {
        Args: {
          p_source_plan_id: string;
          p_service_date: string;
          p_title?: string | null;
          p_copy_assignments?: boolean;
          p_idempotency_key?: string | null;
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
    };
    CompositeTypes: Record<string, never>;
  };
}
