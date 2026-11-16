/**
 * Super-admin dashboard: user management and super-admin management.
 * See docs/plans/super-admin-dashboard.md and migration 20261118000000.
 */
import type { OrgRole } from './database.js';
import type { AdminOrganizationMember } from './platform-admin.js';

/** A church an account belongs to ("enter as owner" access is not listed). */
export interface AdminUserMembership {
  organization_id: string;
  organization_name: string;
  role: OrgRole;
  status: AdminOrganizationMember['status'];
  joined_at: string;
}

/** Why an account can't sign in. */
export interface AdminUserBlock {
  /** Null when the login was banned outside the dashboard. */
  reason: string | null;
  blocked_at: string | null;
  blocked_by: string | null;
  blocked_by_name: string | null;
}

/** One account on the Users page. */
export interface AdminUserSummary {
  id: string;
  email: string | null;
  full_name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed: boolean;
  /** Null while the account can sign in. */
  block: AdminUserBlock | null;
  is_platform_admin: boolean;
  memberships: AdminUserMembership[];
}

/** A church deleting the account would affect (only churches the person owns alone). */
export interface AdminUserDeletionChurch {
  organization_id: string;
  organization_name: string;
  /** `deleted`: nobody else is in it. `blocked`: other members would be left without an owner. */
  outcome: 'deleted' | 'blocked';
}

/** What deleting an account would do. */
export interface AdminUserDeletionPlan {
  /** False while the account is a super admin, is the caller, or a church is `blocked`. */
  can_delete: boolean;
  churches: AdminUserDeletionChurch[];
}

/** `GET /api/v1/admin/users/:id`. */
export interface AdminUserDetail {
  user: AdminUserSummary;
  deletion: AdminUserDeletionPlan;
}

/** A church deleted together with its only member's account. */
export interface AdminDeletedOrganization {
  organization_id: string;
  organization_name: string;
}

/** `DELETE /api/v1/admin/users/:id`. */
export interface AdminUserDeletionResult {
  deleted_organizations: AdminDeletedOrganization[];
}

/** A super admin on the Super admins page. */
export interface PlatformAdmin {
  user_id: string;
  email: string | null;
  full_name: string | null;
  note: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  /** Finished setting up two-factor login. */
  has_mfa: boolean;
}

/** An open invitation to become a super admin. */
export interface PlatformAdminInvitation {
  id: string;
  email: string;
  invited_by: string | null;
  invited_by_name: string | null;
  created_at: string;
  expires_at: string;
}

/** `GET /api/v1/admin/admins`. */
export interface PlatformAdminRoster {
  admins: PlatformAdmin[];
  invitations: PlatformAdminInvitation[];
}

/** `GET /api/v1/admin/invitation`: the signed-in person's own open invitation. */
export interface MyPlatformAdminInvitation {
  id: string;
  email: string;
  invited_by_name: string | null;
  created_at: string;
  expires_at: string;
}
