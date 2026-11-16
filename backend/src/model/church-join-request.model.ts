import type {
  ChurchJoinRequest,
  ChurchJoinRequestRow,
  ChurchLookup,
  ChurchSlugLookupRow,
  MyChurchJoinRequest,
  MyChurchJoinRequestRow,
} from '@service-center/shared';

/**
 * Join requests as the database returns them, and their mapping to the shared
 * API types. See supabase/migrations/20261117000000_church_join_requests.sql.
 */

/** What owners read from `church_join_requests` (`decided_by` is not granted). */
export type OwnerChurchJoinRequestRow = Omit<ChurchJoinRequestRow, 'decided_by'>;

export const OWNER_JOIN_REQUEST_COLUMNS =
  'id, organization_id, requester_id, status, message, requester_name, requester_email, decline_reason, ' +
  'person_id, invitation_id, decided_at, created_at, updated_at';

export const mapChurchLookup = (row: ChurchSlugLookupRow, slug: string): ChurchLookup => ({
  id: row.id,
  name: row.name,
  slug,
});

export const mapMyChurchJoinRequest = (row: MyChurchJoinRequestRow): MyChurchJoinRequest => ({
  id: row.id,
  organization_id: row.organization_id,
  organization_name: row.organization_name,
  organization_slug: row.organization_slug,
  status: row.status,
  message: row.message,
  decline_reason: row.decline_reason,
  decided_at: row.decided_at,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

export const mapChurchJoinRequest = (row: OwnerChurchJoinRequestRow): ChurchJoinRequest => ({
  id: row.id,
  requester_id: row.requester_id,
  requester_name: row.requester_name,
  requester_email: row.requester_email,
  status: row.status,
  message: row.message,
  decline_reason: row.decline_reason,
  person_id: row.person_id,
  invitation_id: row.invitation_id,
  decided_at: row.decided_at,
  created_at: row.created_at,
  updated_at: row.updated_at,
});
