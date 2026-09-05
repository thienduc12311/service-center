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

export type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  logo_url: string | null;
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
      blockouts: Table<BlockoutRow>;
      attachments: Table<AttachmentRow>;
      chord_sheet_imports: Table<ChordSheetImportRow>;
      songbooks: Table<SongbookRow>;
      songbook_items: Table<SongbookItemRow>;
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
    };
    Enums: {
      org_role: OrgRole;
      member_status: MemberStatus;
      plan_status: PlanStatus;
      plan_time_kind: PlanTimeKind;
      plan_item_type: PlanItemType;
      assignment_status: AssignmentStatus;
      import_status: ImportStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}
