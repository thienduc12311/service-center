import type {
  AdminActivityQuery,
  AdminChurchApplication,
  AdminCreateChurchInput,
  AdminOrganizationDetail,
  AdminOrganizationSummary,
  AdminOverview,
  ChurchApplicationRow,
  ChurchApplicationStatus,
  OrganizationPlatformControls,
  OrganizationPlatformControlsRow,
  OrganizationRow,
  PlatformAccessGrant,
  PlatformAuditAction,
  PlatformAuditLogRow,
  PlatformAuditPage,
  PlatformSettings,
  PlatformSettingsRow,
  UpdateChurchApplicationInput,
  UpdatePlatformSettingsInput,
} from '@service-center/shared';
import { adminDb, raw, unwrap } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import { config } from '../config.js';
import {
  mapAdminChurchApplication,
  mapAdminOrganizationMember,
  mapAdminOrganizationSummary,
  mapAdminStorageBucket,
  mapOrganizationPlatformControls,
  mapPlatformAccessGrant,
  mapPlatformAuditEntry,
  mapPlatformSettings,
  type AdminChurchApplicationRow,
  type AdminOrganizationMemberRow,
  type AdminOrganizationSummaryRow,
  type AdminStorageBucketRow,
  type PlatformAccessGrantRow,
  type PlatformAuditRowWithNames,
} from '../model/platform-admin.model.js';
import { churchApplicationApprovedEmail, churchApplicationRejectedEmail } from './email/templates/church-application.js';
import { sendPlatformEmails } from './platform-email.js';

/**
 * Super-admin work. Every function here uses the service-role client and is
 * only reachable through `requirePlatformAdmin` (membership in
 * private.platform_admins plus a two-factor session). The database functions
 * check the actor again and write platform_audit_log in the same transaction.
 */

/** The signed-in super admin. */
export interface PlatformActor {
  userId: string;
}

/** How long "enter as owner" lasts unless asked otherwise. */
export const DEFAULT_PLATFORM_ACCESS_HOURS = 8;

interface ProfileName {
  id: string;
  full_name: string | null;
  email: string | null;
}

const profilesById = async (ids: readonly string[]): Promise<Map<string, ProfileName>> => {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = (await unwrap(adminDb.from('profiles').select('id, full_name, email').in('id', unique))) ?? [];
  return new Map(rows.map((row) => [row.id, row]));
};

/** A taken slug reads as a conflict a person can fix. */
const withSlugConflict = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    if (error instanceof HttpError && error.status === 409 && error.code === 'conflict') {
      throw new HttpError(409, 'That URL slug is already taken', 'slug_taken');
    }
    throw error;
  }
};

// ------------------------------------------------------------ admins -------

export const isPlatformAdmin = async (userId: string): Promise<boolean> =>
  (await unwrap(raw(adminDb).rpc('is_platform_admin', { p_user: userId }))) === true;

/** Removes expired "enter as owner" windows; returns how many. */
export const purgeExpiredPlatformAccess = async (): Promise<number> => {
  const purged = (await unwrap(raw(adminDb).rpc('purge_expired_platform_access'))) as number | null;
  return purged ?? 0;
};

/** One request a super admin made while inside a church (non-GET only). */
export interface PlatformAccessRequest {
  organizationId: string;
  method: string;
  path: string;
  status: number;
}

export const recordPlatformAccessRequest = async (actor: PlatformActor, request: PlatformAccessRequest): Promise<void> => {
  const action: PlatformAuditAction = 'church.request';
  await unwrap(
    raw(adminDb).rpc('record_platform_audit', {
      p_actor: actor.userId,
      p_action: action,
      p_organization: request.organizationId,
      p_application: null,
      p_details: { method: request.method, path: request.path, status: request.status },
    }),
  );
};

// ---------------------------------------------------------- churches -------

export const listOrganizationSummaries = async (): Promise<AdminOrganizationSummary[]> => {
  const rows = (await unwrap(raw(adminDb).rpc('admin_organization_summaries'))) as AdminOrganizationSummaryRow[] | null;
  return (rows ?? []).map(mapAdminOrganizationSummary);
};

const getOrganizationSummary = async (organizationId: string): Promise<AdminOrganizationSummary> => {
  const summary = (await listOrganizationSummaries()).find((org) => org.id === organizationId);
  if (!summary) throw HttpError.notFound('Church not found');
  return summary;
};

export const getOverview = async (): Promise<AdminOverview> => {
  const summaries = await listOrganizationSummaries();
  const { count, error } = await adminDb
    .from('church_applications')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  if (error) throw new HttpError(500, error.message);
  const disabled = summaries.filter((org) => org.status === 'disabled').length;
  return {
    churches: { total: summaries.length, active: summaries.length - disabled, disabled },
    pending_applications: count ?? 0,
    accounts: summaries.reduce((sum, org) => sum + org.accounts, 0),
    storage_used_bytes: summaries.reduce((sum, org) => sum + org.storage_used_bytes, 0),
  };
};

export const getOrganizationDetail = async (
  actor: PlatformActor,
  organizationId: string,
): Promise<AdminOrganizationDetail> => {
  const summary = await getOrganizationSummary(organizationId);

  const memberRows = ((await unwrap(
    adminDb
      .from('organization_members')
      .select('user_id, role, status, created_at')
      .eq('organization_id', organizationId)
      .is('platform_access_expires_at', null)
      .order('created_at'),
  )) ?? []) as Array<Omit<AdminOrganizationMemberRow, 'profile'>>;
  const profiles = await profilesById(memberRows.map((row) => row.user_id));

  const storageRows = (await unwrap(
    raw(adminDb).rpc('admin_organization_storage', { p_org: organizationId }),
  )) as AdminStorageBucketRow[] | null;

  const myAccess = await unwrap(
    adminDb
      .from('organization_members')
      .select('platform_access_expires_at')
      .eq('organization_id', organizationId)
      .eq('user_id', actor.userId)
      .not('platform_access_expires_at', 'is', null)
      .maybeSingle(),
  );

  return {
    summary,
    members: memberRows.map((row) =>
      mapAdminOrganizationMember({ ...row, profile: profiles.get(row.user_id) ?? null }),
    ),
    storage: (storageRows ?? []).map(mapAdminStorageBucket),
    my_platform_access_expires_at: myAccess?.platform_access_expires_at ?? null,
  };
};

/**
 * The owner's account: an existing one by email, otherwise Supabase invites
 * them (the account exists from now on; they set a password from the email).
 */
const findOrInviteOwner = async (email: string): Promise<string> => {
  // ilike for case-insensitive equality; escape its wildcards.
  const pattern = email.replace(/[\\%_]/g, (match) => `\\${match}`);
  const existing = await unwrap(adminDb.from('profiles').select('id').ilike('email', pattern).limit(1).maybeSingle());
  if (existing) return existing.id;

  const { data, error } = await adminDb.auth.admin.inviteUserByEmail(email, { redirectTo: config.APP_URL });
  if (error || !data.user) {
    console.error(`[platform-admin] inviting the owner failed (${error?.status ?? 'no status'})`);
    throw new HttpError(502, 'Could not invite the owner; try again');
  }
  return data.user.id;
};

export const createChurch = async (
  actor: PlatformActor,
  input: AdminCreateChurchInput,
): Promise<AdminOrganizationSummary> => {
  const ownerId = await findOrInviteOwner(input.owner_email);
  const organization = await withSlugConflict(async () =>
    (await unwrap(
      raw(adminDb).rpc('admin_create_church', {
        p_actor: actor.userId,
        p_owner: ownerId,
        p_name: input.name,
        p_slug: input.slug,
        p_timezone: input.timezone,
        p_address_line1: input.address_line1,
        p_address_line2: input.address_line2,
        p_city: input.city,
        p_state_province: input.state_province,
        p_postal_code: input.postal_code,
        p_country: input.country,
        p_member_count: input.member_count,
      }),
    )) as OrganizationRow,
  );
  return getOrganizationSummary(organization.id);
};

export const setOrganizationQuota = async (
  actor: PlatformActor,
  organizationId: string,
  quotaBytes: number | null,
): Promise<OrganizationPlatformControls> => {
  const row = (await unwrap(
    raw(adminDb).rpc('set_organization_storage_quota', {
      p_actor: actor.userId,
      p_org: organizationId,
      p_quota_bytes: quotaBytes,
    }),
  )) as OrganizationPlatformControlsRow;
  return mapOrganizationPlatformControls(row);
};

/** Disabling suspends every member; enabling restores them. Data is never deleted. */
export const setOrganizationStatus = async (
  actor: PlatformActor,
  organizationId: string,
  change: { status: 'active' } | { status: 'disabled'; reason: string },
): Promise<OrganizationPlatformControls> => {
  const row = (await unwrap(
    raw(adminDb).rpc('set_organization_platform_status', {
      p_actor: actor.userId,
      p_org: organizationId,
      p_status: change.status,
      p_reason: change.status === 'disabled' ? change.reason : null,
    }),
  )) as OrganizationPlatformControlsRow;
  return mapOrganizationPlatformControls(row);
};

/** Enter the church as a temporary owner. */
export const grantPlatformAccess = async (
  actor: PlatformActor,
  organizationId: string,
  hours: number,
): Promise<PlatformAccessGrant> => {
  const rows = (await unwrap(
    raw(adminDb).rpc('grant_platform_access', { p_actor: actor.userId, p_org: organizationId, p_hours: hours }),
  )) as PlatformAccessGrantRow[] | null;
  const row = rows?.[0];
  if (!row) throw new HttpError(500, 'Granting access returned nothing');
  return mapPlatformAccessGrant(row);
};

/** Idempotent. */
export const revokePlatformAccess = async (actor: PlatformActor, organizationId: string): Promise<void> => {
  await unwrap(raw(adminDb).rpc('revoke_platform_access', { p_actor: actor.userId, p_org: organizationId }));
};

// ------------------------------------------------------- applications ------

const withApplicants = async (rows: readonly ChurchApplicationRow[]): Promise<AdminChurchApplication[]> => {
  const profiles = await profilesById(rows.map((row) => row.applicant_id));
  return rows.map((row) => {
    const applicant = profiles.get(row.applicant_id);
    const withProfile: AdminChurchApplicationRow = {
      ...row,
      applicant: applicant ? { full_name: applicant.full_name, email: applicant.email } : null,
    };
    return mapAdminChurchApplication(withProfile);
  });
};

const getApplicationRow = async (applicationId: string): Promise<ChurchApplicationRow> => {
  const row = await unwrap(adminDb.from('church_applications').select('*').eq('id', applicationId).maybeSingle());
  if (!row) throw HttpError.notFound('Application not found');
  return row;
};

export const getAdminApplication = async (applicationId: string): Promise<AdminChurchApplication> => {
  const [application] = await withApplicants([await getApplicationRow(applicationId)]);
  if (!application) throw HttpError.notFound('Application not found');
  return application;
};

/** Pending first, oldest first, so the queue reads in order of arrival. */
export const listApplications = async (status?: ChurchApplicationStatus): Promise<AdminChurchApplication[]> => {
  let query = adminDb.from('church_applications').select('*');
  if (status) query = query.eq('status', status);
  const rows = (await unwrap(query.order('created_at', { ascending: status === 'pending' }).limit(500))) ?? [];
  return withApplicants(rows);
};

/** Fix the details before approving (only while pending). */
export const updateApplication = async (
  actor: PlatformActor,
  applicationId: string,
  changes: UpdateChurchApplicationInput,
): Promise<AdminChurchApplication> => {
  const updated = await unwrap(
    adminDb
      .from('church_applications')
      .update(changes)
      .eq('id', applicationId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle(),
  );
  if (!updated) {
    await getApplicationRow(applicationId);
    throw new HttpError(409, 'This application was already decided or withdrawn', 'application_not_pending');
  }
  const action: PlatformAuditAction = 'application.edited';
  await unwrap(
    raw(adminDb).rpc('record_platform_audit', {
      p_actor: actor.userId,
      p_action: action,
      p_organization: null,
      p_application: applicationId,
      p_details: { fields: Object.keys(changes) },
    }),
  );
  return getAdminApplication(applicationId);
};

const applicantEmail = async (applicantId: string): Promise<string | null> =>
  (await profilesById([applicantId])).get(applicantId)?.email ?? null;

/** Creates the church; the applicant becomes its owner and is emailed. */
export const approveApplication = async (
  actor: PlatformActor,
  applicationId: string,
  slug: string,
): Promise<AdminChurchApplication> => {
  await withSlugConflict(() =>
    unwrap(
      raw(adminDb).rpc('approve_church_application', {
        p_actor: actor.userId,
        p_application: applicationId,
        p_slug: slug,
      }),
    ),
  );
  const application = await getAdminApplication(applicationId);
  const to = application.applicant_email ?? (await applicantEmail(application.applicant_id));
  if (to) {
    await sendPlatformEmails([
      { to, ...churchApplicationApprovedEmail({ churchName: application.church_name, appUrl: config.APP_URL }) },
    ]);
  }
  return application;
};

/** The reason is shown and emailed to the applicant. */
export const rejectApplication = async (
  actor: PlatformActor,
  applicationId: string,
  reason: string,
): Promise<AdminChurchApplication> => {
  await unwrap(
    raw(adminDb).rpc('reject_church_application', {
      p_actor: actor.userId,
      p_application: applicationId,
      p_reason: reason,
    }),
  );
  const application = await getAdminApplication(applicationId);
  if (application.applicant_email) {
    await sendPlatformEmails([
      {
        to: application.applicant_email,
        ...churchApplicationRejectedEmail({
          churchName: application.church_name,
          reason,
          appUrl: `${config.APP_URL}/welcome`,
        }),
      },
    ]);
  }
  return application;
};

// ------------------------------------------------------------ settings -----

export const getSettings = async (): Promise<PlatformSettings> => {
  const row = await unwrap(adminDb.from('platform_settings').select('*').maybeSingle());
  if (!row) throw new HttpError(500, 'Platform settings are missing');
  return mapPlatformSettings(row);
};

export const updateSettings = async (
  actor: PlatformActor,
  changes: UpdatePlatformSettingsInput,
): Promise<PlatformSettings> => {
  const row = (await unwrap(
    raw(adminDb).rpc('update_platform_settings', {
      p_actor: actor.userId,
      p_default_storage_quota: changes.default_storage_quota_bytes ?? null,
      p_allow_self_serve_creation: changes.allow_self_serve_church_creation ?? null,
    }),
  )) as PlatformSettingsRow;
  return mapPlatformSettings(row);
};

// ------------------------------------------------------------ activity -----

export const listActivity = async (query: AdminActivityQuery): Promise<PlatformAuditPage> => {
  let request = adminDb.from('platform_audit_log').select('*');
  if (query.organization_id) request = request.eq('organization_id', query.organization_id);
  if (query.before) request = request.lt('id', query.before);
  // One extra row says whether there is another page.
  const rows = ((await unwrap(request.order('id', { ascending: false }).limit(query.limit + 1))) ?? []) as PlatformAuditLogRow[];
  const page = rows.slice(0, query.limit);

  const actors = await profilesById(page.flatMap((row) => (row.actor_id ? [row.actor_id] : [])));
  const organizationIds = [...new Set(page.flatMap((row) => (row.organization_id ? [row.organization_id] : [])))];
  const organizations =
    organizationIds.length === 0
      ? []
      : ((await unwrap(adminDb.from('organizations').select('id, name').in('id', organizationIds))) ?? []);
  const organizationNames = new Map(organizations.map((org) => [org.id, org.name]));

  const entries = page.map((row) => {
    const actor = row.actor_id ? actors.get(row.actor_id) : undefined;
    const withNames: PlatformAuditRowWithNames = {
      ...row,
      actor: actor ? { full_name: actor.full_name } : null,
      // A deleted church keeps its log lines; the name is gone with it.
      organization_name: row.organization_id ? organizationNames.get(row.organization_id) ?? null : null,
    };
    return mapPlatformAuditEntry(withNames);
  });
  const last = page.at(-1);
  return { entries, next_before: rows.length > query.limit && last ? last.id : null };
};
