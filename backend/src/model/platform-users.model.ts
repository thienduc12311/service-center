import type {
  AdminDeletedOrganization,
  AdminOrganizationMember,
  AdminUserDeletionChurch,
  AdminUserMembership,
  AdminUserSummary,
  MyPlatformAdminInvitation,
  OrgRole,
  PlatformAdmin,
  PlatformAdminInvitation,
} from '@service-center/shared';

/**
 * Rows of the super-admin user-management functions (migration
 * 20261118000000) and their mapping to the shared API types.
 */

/** One element of `admin_user_summaries().memberships` (jsonb). */
export interface AdminUserMembershipJson {
  organization_id: string;
  organization_name: string;
  role: OrgRole;
  status: AdminOrganizationMember['status'];
  joined_at: string;
}

/** A row of `admin_user_summaries(p_user)`. */
export interface AdminUserSummaryRow {
  user_id: string;
  email: string | null;
  full_name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  banned_until: string | null;
  blocked_at: string | null;
  block_reason: string | null;
  blocked_by: string | null;
  blocked_by_name: string | null;
  is_platform_admin: boolean;
  memberships: AdminUserMembershipJson[] | null;
}

/** Banned by a super admin (a block row) or straight in Supabase Auth (a future `banned_until`). */
export const isRowBlocked = (row: AdminUserSummaryRow, now: Date = new Date()): boolean =>
  row.blocked_at !== null || (row.banned_until !== null && Date.parse(row.banned_until) > now.getTime());

const mapMembership = (json: AdminUserMembershipJson): AdminUserMembership => ({
  organization_id: json.organization_id,
  organization_name: json.organization_name,
  role: json.role,
  status: json.status,
  joined_at: json.joined_at,
});

export const mapAdminUserSummary = (row: AdminUserSummaryRow, now: Date = new Date()): AdminUserSummary => ({
  id: row.user_id,
  email: row.email,
  full_name: row.full_name,
  created_at: row.created_at,
  last_sign_in_at: row.last_sign_in_at,
  email_confirmed: row.email_confirmed_at !== null,
  block: isRowBlocked(row, now)
    ? {
        reason: row.block_reason,
        blocked_at: row.blocked_at,
        blocked_by: row.blocked_by,
        blocked_by_name: row.blocked_by_name,
      }
    : null,
  is_platform_admin: row.is_platform_admin,
  memberships: (row.memberships ?? []).map(mapMembership),
});

/** A row of `admin_user_deletion_plan(p_user)`. */
export interface AdminUserDeletionPlanRow {
  organization_id: string;
  organization_name: string;
  outcome: string;
}

const isDeletionOutcome = (value: string): value is AdminUserDeletionChurch['outcome'] =>
  value === 'deleted' || value === 'blocked';

export const mapAdminUserDeletionChurch = (row: AdminUserDeletionPlanRow): AdminUserDeletionChurch => {
  if (!isDeletionOutcome(row.outcome)) throw new Error(`Unknown account deletion outcome: ${row.outcome}`);
  return { organization_id: row.organization_id, organization_name: row.organization_name, outcome: row.outcome };
};

/** A row of `admin_delete_user(p_actor, p_user)`. */
export interface AdminDeletedOrganizationRow {
  organization_id: string;
  organization_name: string;
}

export const mapAdminDeletedOrganization = (row: AdminDeletedOrganizationRow): AdminDeletedOrganization => ({
  organization_id: row.organization_id,
  organization_name: row.organization_name,
});

/** A row of `admin_platform_admins()`. */
export interface PlatformAdminRow {
  user_id: string;
  email: string | null;
  full_name: string | null;
  note: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  has_mfa: boolean;
}

export const mapPlatformAdmin = (row: PlatformAdminRow): PlatformAdmin => ({
  user_id: row.user_id,
  email: row.email,
  full_name: row.full_name,
  note: row.note,
  created_at: row.created_at,
  last_sign_in_at: row.last_sign_in_at,
  has_mfa: row.has_mfa,
});

/** A row of `admin_platform_admin_invitations()`. */
export interface PlatformAdminInvitationListRow {
  id: string;
  email: string;
  invited_by: string | null;
  invited_by_name: string | null;
  created_at: string;
  expires_at: string;
}

export const mapPlatformAdminInvitation = (row: PlatformAdminInvitationListRow): PlatformAdminInvitation => ({
  id: row.id,
  email: row.email,
  invited_by: row.invited_by,
  invited_by_name: row.invited_by_name,
  created_at: row.created_at,
  expires_at: row.expires_at,
});

/** A row of `my_platform_admin_invitation(p_user)`. */
export interface MyPlatformAdminInvitationRow {
  id: string;
  email: string;
  invited_by_name: string | null;
  created_at: string;
  expires_at: string;
}

export const mapMyPlatformAdminInvitation = (row: MyPlatformAdminInvitationRow): MyPlatformAdminInvitation => ({
  id: row.id,
  email: row.email,
  invited_by_name: row.invited_by_name,
  created_at: row.created_at,
  expires_at: row.expires_at,
});
