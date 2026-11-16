import { z } from 'zod';
import type {
  AdminChurchApplication,
  AdminOrganizationMember,
  AdminOrganizationSummary,
  AdminStorageBucketUsage,
  ChurchApplication,
  ChurchApplicationRow,
  DisabledOrganization,
  OrgRole,
  OrganizationPlatformControls,
  OrganizationPlatformControlsRow,
  OrganizationPlatformStatus,
  OrganizationStorageUsage,
  PlatformAccessGrant,
  PlatformAuditEntry,
  PlatformAuditLogRow,
  PlatformSettings,
  PlatformSettingsRow,
} from '@service-center/shared';
import { storageFractionUsed } from '@service-center/shared';

/**
 * Database rows of the super-admin dashboard and church applications, and
 * their mapping to the shared API types. PostgREST returns bigint columns as
 * numbers or strings depending on size, so byte counts go through `bytes`.
 */

/** A bigint from PostgREST: a number, or a numeric string past 2^53. */
type BigintValue = number | string;

const bytes = (value: BigintValue | null | undefined): number => {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** A row of `admin_organization_summaries()`. */
export interface AdminOrganizationSummaryRow {
  organization_id: string;
  name: string;
  slug: string;
  created_at: string;
  status: OrganizationPlatformStatus;
  disabled_reason: string | null;
  disabled_at: string | null;
  owner_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  accounts: number;
  invited: number;
  people: number;
  storage_used_bytes: BigintValue;
  storage_quota_bytes: BigintValue;
  quota_is_custom: boolean;
  last_activity_at: string | null;
}

export const mapAdminOrganizationSummary = (row: AdminOrganizationSummaryRow): AdminOrganizationSummary => ({
  id: row.organization_id,
  name: row.name,
  slug: row.slug,
  created_at: row.created_at,
  status: row.status,
  disabled_reason: row.disabled_reason,
  disabled_at: row.disabled_at,
  owner: row.owner_id ? { user_id: row.owner_id, full_name: row.owner_name, email: row.owner_email } : null,
  accounts: row.accounts,
  invited: row.invited,
  people: row.people,
  storage_used_bytes: bytes(row.storage_used_bytes),
  storage_quota_bytes: bytes(row.storage_quota_bytes),
  quota_is_custom: row.quota_is_custom,
  last_activity_at: row.last_activity_at,
});

/** A row of `admin_organization_storage(p_org)`. */
export interface AdminStorageBucketRow {
  bucket_id: string;
  object_count: number;
  used_bytes: BigintValue;
}

export const mapAdminStorageBucket = (row: AdminStorageBucketRow): AdminStorageBucketUsage => ({
  bucket_id: row.bucket_id,
  object_count: row.object_count,
  used_bytes: bytes(row.used_bytes),
});

/** An `organization_members` row joined to its profile, read with the service role. */
export interface AdminOrganizationMemberRow {
  user_id: string;
  role: OrgRole;
  status: AdminOrganizationMember['status'];
  created_at: string;
  profile: { full_name: string | null; email: string | null } | null;
}

export const mapAdminOrganizationMember = (row: AdminOrganizationMemberRow): AdminOrganizationMember => ({
  user_id: row.user_id,
  full_name: row.profile?.full_name ?? null,
  email: row.profile?.email ?? null,
  role: row.role,
  status: row.status,
  joined_at: row.created_at,
});

/** The applicant's view: who reviewed it is not theirs to know. */
export const mapChurchApplication = (row: Omit<ChurchApplicationRow, 'reviewed_by'>): ChurchApplication => ({
  id: row.id,
  status: row.status,
  church_name: row.church_name,
  leader_name: row.leader_name,
  contact_phone: row.contact_phone,
  website: row.website,
  address_line1: row.address_line1,
  address_line2: row.address_line2,
  city: row.city,
  state_province: row.state_province,
  postal_code: row.postal_code,
  country: row.country,
  expected_member_count: row.expected_member_count,
  timezone: row.timezone,
  note: row.note,
  rejection_reason: row.rejection_reason,
  reviewed_at: row.reviewed_at,
  organization_id: row.organization_id,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

/** A `church_applications` row joined to the applicant's profile, read with the service role. */
export interface AdminChurchApplicationRow extends ChurchApplicationRow {
  applicant: { full_name: string | null; email: string | null } | null;
}

export const mapAdminChurchApplication = (row: AdminChurchApplicationRow): AdminChurchApplication => ({
  ...mapChurchApplication(row),
  applicant_id: row.applicant_id,
  applicant_name: row.applicant?.full_name ?? null,
  applicant_email: row.applicant?.email ?? null,
  reviewed_by: row.reviewed_by,
});

export const mapOrganizationPlatformControls = (row: OrganizationPlatformControlsRow): OrganizationPlatformControls => ({
  organization_id: row.organization_id,
  status: row.status,
  disabled_reason: row.disabled_reason,
  disabled_at: row.disabled_at,
  storage_quota_bytes: row.storage_quota_bytes === null ? null : bytes(row.storage_quota_bytes),
  updated_at: row.updated_at,
});

export const mapPlatformSettings = (row: PlatformSettingsRow): PlatformSettings => ({
  default_storage_quota_bytes: bytes(row.default_storage_quota_bytes),
  allow_self_serve_church_creation: row.allow_self_serve_church_creation,
  updated_at: row.updated_at,
});

/** A `platform_audit_log` row with the names it refers to, read with the service role. */
export interface PlatformAuditRowWithNames extends PlatformAuditLogRow {
  actor: { full_name: string | null } | null;
  organization_name: string | null;
}

export const mapPlatformAuditEntry = (row: PlatformAuditRowWithNames): PlatformAuditEntry => ({
  id: row.id,
  actor_id: row.actor_id,
  actor_name: row.actor?.full_name ?? null,
  action: row.action,
  organization_id: row.organization_id,
  organization_name: row.organization_name,
  application_id: row.application_id,
  details: row.details,
  created_at: row.created_at,
});

/** A row of `grant_platform_access(...)`. */
export interface PlatformAccessGrantRow {
  outcome: string;
  expires_at: string | null;
}

const GRANT_OUTCOMES: ReadonlySet<PlatformAccessGrant['outcome']> = new Set(['granted', 'extended', 'already_member']);
const isGrantOutcome = (value: string): value is PlatformAccessGrant['outcome'] =>
  (GRANT_OUTCOMES as ReadonlySet<string>).has(value);

export const mapPlatformAccessGrant = (row: PlatformAccessGrantRow): PlatformAccessGrant => {
  if (!isGrantOutcome(row.outcome)) throw new Error(`Unknown platform access outcome: ${row.outcome}`);
  return { outcome: row.outcome, expires_at: row.expires_at };
};

/** A row of `my_organization_storage(p_org)`. */
export interface OrganizationStorageRow {
  used_bytes: BigintValue;
  quota_bytes: BigintValue;
}

export const mapOrganizationStorage = (row: OrganizationStorageRow): OrganizationStorageUsage => {
  const used = bytes(row.used_bytes);
  const quota = bytes(row.quota_bytes);
  return { used_bytes: used, quota_bytes: quota, fraction_used: storageFractionUsed(used, quota) };
};

/** A row of `my_disabled_organizations()`. */
export interface DisabledOrganizationRow {
  organization_id: string;
  organization_name: string;
  role: OrgRole;
  disabled_reason: string | null;
  disabled_at: string;
}

export const mapDisabledOrganization = (row: DisabledOrganizationRow): DisabledOrganization => ({
  organization_id: row.organization_id,
  organization_name: row.organization_name,
  role: row.role,
  disabled_reason: row.disabled_reason,
  disabled_at: row.disabled_at,
});

/** Supabase authenticator assurance level carried in the access token. */
export type SessionAssurance = 'aal1' | 'aal2';

const accessTokenClaimsSchema = z.object({ aal: z.enum(['aal1', 'aal2']).optional() });

/**
 * Reads the assurance level from an access token whose signature the auth
 * server already verified (`requireAuth`). Anything unreadable counts as
 * `aal1`, so a malformed claim can never pass the two-factor check.
 */
export const sessionAssurance = (accessToken: string): SessionAssurance => {
  const payload = accessToken.split('.')[1];
  if (!payload) return 'aal1';
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return 'aal1';
  }
  const claims = accessTokenClaimsSchema.safeParse(decoded);
  return claims.success && claims.data.aal === 'aal2' ? 'aal2' : 'aal1';
};
