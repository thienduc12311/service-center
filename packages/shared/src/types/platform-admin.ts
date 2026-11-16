/**
 * Super-admin dashboard and church applications.
 * See docs/plans/super-admin-dashboard.md and migrations 20261116000000/100.
 */
import type { OrgRole } from './database.js';

export type OrganizationPlatformStatus = 'active' | 'disabled';
export type ChurchApplicationStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

/** Everything platform_audit_log records. */
export type PlatformAuditAction =
  | 'church.created'
  | 'church.disabled'
  | 'church.enabled'
  | 'church.quota_changed'
  | 'church.access_granted'
  | 'church.access_extended'
  | 'church.access_revoked'
  | 'church.access_expired'
  | 'church.request'
  | 'application.approved'
  | 'application.rejected'
  | 'application.edited'
  | 'settings.updated'
  | 'user.blocked'
  | 'user.unblocked'
  | 'user.deleted'
  | 'admin.invited'
  | 'admin.invitation_revoked'
  | 'admin.granted'
  | 'admin.revoked';

/** A church application as its applicant sees it. */
export interface ChurchApplication {
  id: string;
  status: ChurchApplicationStatus;
  church_name: string;
  leader_name: string;
  contact_phone: string | null;
  website: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string;
  state_province: string | null;
  postal_code: string | null;
  country: string;
  expected_member_count: number | null;
  timezone: string;
  note: string | null;
  /** Set when rejected. */
  rejection_reason: string | null;
  reviewed_at: string | null;
  /** The church an approved application created. */
  organization_id: string | null;
  created_at: string;
  updated_at: string;
}

/** A church application in the super-admin queue. */
export interface AdminChurchApplication extends ChurchApplication {
  applicant_id: string;
  applicant_name: string | null;
  applicant_email: string | null;
  reviewed_by: string | null;
}

/** `GET /api/v1/organizations/creation-policy`. */
export interface ChurchCreationPolicy {
  /** False: the app offers "Apply for a church" instead of creating one. */
  self_serve_allowed: boolean;
}

/** `GET /api/v1/organization-storage`: the active church's media usage. */
export interface OrganizationStorageUsage {
  used_bytes: number;
  quota_bytes: number;
  /** 0–1+, for the usage bar and the 80% warning. */
  fraction_used: number;
}

/** A church the caller belongs to that a super admin disabled. */
export interface DisabledOrganization {
  organization_id: string;
  organization_name: string;
  role: OrgRole;
  /** Shown to owners only; null for everyone else. */
  disabled_reason: string | null;
  disabled_at: string;
}

/** `GET /api/v1/admin/session`: works before two-factor login so the admin app can ask for it. */
export interface AdminSession {
  user_id: string;
  email: string | null;
  /** Supabase authenticator assurance level of this session. */
  aal: 'aal1' | 'aal2';
  /** True when the session must complete (or enroll in) two-factor login first. */
  mfa_required: boolean;
}

export interface AdminOrganizationOwner {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

/** One church in the dashboard list. */
export interface AdminOrganizationSummary {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  status: OrganizationPlatformStatus;
  disabled_reason: string | null;
  disabled_at: string | null;
  owner: AdminOrganizationOwner | null;
  /** People with a login in the church (suspended members of a disabled church included). */
  accounts: number;
  /** Logins invited but not joined yet. */
  invited: number;
  /** Roster people, not archived (with or without a login). */
  people: number;
  storage_used_bytes: number;
  storage_quota_bytes: number;
  /** False when the platform default applies. */
  quota_is_custom: boolean;
  last_activity_at: string | null;
}

/** `GET /api/v1/admin/overview`. */
export interface AdminOverview {
  churches: { total: number; active: number; disabled: number };
  pending_applications: number;
  accounts: number;
  storage_used_bytes: number;
}

export interface AdminOrganizationMember {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: OrgRole;
  status: 'invited' | 'active' | 'inactive' | 'suspended';
  joined_at: string;
}

export interface AdminStorageBucketUsage {
  bucket_id: string;
  object_count: number;
  used_bytes: number;
}

/** `GET /api/v1/admin/organizations/:id`. */
export interface AdminOrganizationDetail {
  summary: AdminOrganizationSummary;
  members: AdminOrganizationMember[];
  storage: AdminStorageBucketUsage[];
  /** The caller's own temporary owner access here, when they entered the church. */
  my_platform_access_expires_at: string | null;
}

/** A church's platform state after a super admin changed it (disable, enable, quota). */
export interface OrganizationPlatformControls {
  organization_id: string;
  status: OrganizationPlatformStatus;
  disabled_reason: string | null;
  disabled_at: string | null;
  /** Null: the platform default applies. */
  storage_quota_bytes: number | null;
  updated_at: string;
}

/** `POST /api/v1/admin/organizations/:id/access`. */
export interface PlatformAccessGrant {
  /** `already_member`: the super admin is a real member already; nothing was added. */
  outcome: 'granted' | 'extended' | 'already_member';
  expires_at: string | null;
}

/** `GET /api/v1/admin/settings`. */
export interface PlatformSettings {
  default_storage_quota_bytes: number;
  allow_self_serve_church_creation: boolean;
  updated_at: string;
}

/** One line of the Activity page. */
export interface PlatformAuditEntry {
  id: number;
  actor_id: string | null;
  actor_name: string | null;
  /** A `PlatformAuditAction`; kept as text so an action added later still shows. */
  action: string;
  organization_id: string | null;
  organization_name: string | null;
  application_id: string | null;
  /** The account the action was about; it may since have been deleted. */
  target_user_id: string | null;
  /** Null once the account is deleted (`details.email` keeps who it was). */
  target_name: string | null;
  target_email: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

/** `GET /api/v1/admin/activity`: `next_before` pages further back; null at the start. */
export interface PlatformAuditPage {
  entries: PlatformAuditEntry[];
  next_before: number | null;
}
