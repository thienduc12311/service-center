/**
 * Shape of the Postgres schema as supabase-js expects it.
 *
 * Kept hand-written (rather than `supabase gen types`) so the whole workspace
 * has a single source of truth that also compiles without a running database.
 * Regenerate-and-diff with:
 *   supabase gen types typescript --local > /tmp/db.ts
 */

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
export type AssignmentStatus = 'unconfirmed' | 'confirmed' | 'declined';
export type ImportStatus = 'pending' | 'processing' | 'succeeded' | 'failed';
export type NotificationType =
  | 'assignment_scheduled'
  | 'assignment_reminder'
  | 'assignment_response'
  | 'plan_updated';
export type DevicePlatform = 'ios' | 'android' | 'web';

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
  sort_order: number;
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
  created_at: string;
  updated_at: string;
}

export type TeamPositionRow = {
  id: string;
  team_id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type TeamMembershipRow = {
  id: string;
  team_id: string;
  user_id: string;
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
  default_key: string | null;
  default_bpm: number | null;
  meter: string | null;
  themes: string[];
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
  bpm: number | null;
  meter: string | null;
  length_seconds: number | null;
  sequence: string[];
  chord_chart: string | null;
  chord_chart_format: string;
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

export type AssignmentRow = {
  id: string;
  plan_id: string;
  user_id: string;
  team_id: string;
  position_id: string | null;
  status: AssignmentStatus;
  notes: string | null;
  notified_at: string | null;
  responded_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type AssignmentNotificationRow = {
  id: string;
  organization_id: string;
  plan_id: string;
  user_id: string;
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
}

export type DevicePushTokenRow = {
  id: string;
  user_id: string;
  token: string;
  platform: DevicePlatform;
  device_name: string | null;
  created_at: string;
  last_seen_at: string;
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

export type ChordSheetImportRow = {
  id: string;
  organization_id: string;
  created_by: string | null;
  storage_path: string;
  original_filename: string | null;
  status: ImportStatus;
  provider: string | null;
  raw_text: string | null;
  parsed_chordpro: string | null;
  detected_title: string | null;
  detected_key: string | null;
  confidence: number | null;
  error_message: string | null;
  song_id: string | null;
  arrangement_id: string | null;
  processing_started_at: string | null;
  processing_finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export type AiImportUsageRow = {
  organization_id: string;
  user_id: string;
  /** The organization's local date the counter belongs to. */
  usage_date: string;
  import_count: number;
  created_at: string;
  updated_at: string;
}

/** One row back from `ai_import_quota_status` / `consume_ai_import_quota`. */
export type ImportQuotaRow = {
  allowed: boolean;
  used: number;
  remaining: number;
  quota_limit: number;
  usage_date: string;
  resets_at: string;
}

export type SchedulingConflictRow = {
  user_id: string;
  conflict_type: 'blockout' | 'double_booked';
  detail: string | null;
  starts_at: string;
  ends_at: string;
  plan_id: string | null;
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
      assignments: Table<AssignmentRow>;
      assignment_notifications: Table<AssignmentNotificationRow>;
      calendar_feed_tokens: Table<CalendarFeedTokenRow>;
      notifications: Table<NotificationRow>;
      device_push_tokens: Table<DevicePushTokenRow>;
      blockouts: Table<BlockoutRow>;
      attachments: Table<AttachmentRow>;
      chord_sheet_imports: Table<ChordSheetImportRow>;
      songbooks: Table<SongbookRow>;
      songbook_items: Table<SongbookItemRow>;
      ai_import_usage: Table<AiImportUsageRow>;
    };
    Views: Record<string, never>;
    Functions: {
      create_organization: {
        Args: { p_name: string; p_slug: string; p_timezone?: string };
        Returns: OrganizationRow;
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
        Returns: Array<{ out_organization_id: string; out_person_id: string; out_role: OrgRole }>;
      };
      ai_import_quota_status: {
        Args: { p_organization_id: string; p_limit: number };
        Returns: ImportQuotaRow[];
      };
      consume_ai_import_quota: {
        Args: { p_organization_id: string; p_limit: number };
        Returns: ImportQuotaRow[];
      };
    };
    Enums: {
      org_role: OrgRole;
      member_status: MemberStatus;
      plan_status: PlanStatus;
      plan_time_kind: PlanTimeKind;
      plan_item_type: PlanItemType;
      assignment_status: AssignmentStatus;
      import_status: ImportStatus;
      notification_type: NotificationType;
    };
    CompositeTypes: Record<string, never>;
  };
}
