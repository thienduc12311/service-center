import type { ChurchCreationPolicy, DisabledOrganization, OrganizationStorageUsage } from '@service-center/shared';
import { adminDb, raw, unwrap, type Db } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import {
  mapDisabledOrganization,
  mapOrganizationStorage,
  type DisabledOrganizationRow,
  type OrganizationStorageRow,
} from '../model/platform-admin.model.js';

/**
 * What the platform controls mean for an ordinary member: whether churches
 * can be created without approval, the church's storage use, and which of
 * the caller's churches are disabled.
 */

export const getChurchCreationPolicy = async (db: Db): Promise<ChurchCreationPolicy> => {
  const rows = (await unwrap(raw(db).rpc('church_creation_policy'))) as Array<{ self_serve_allowed: boolean }> | null;
  return { self_serve_allowed: rows?.[0]?.self_serve_allowed === true };
};

/** As the caller: 404 unless they are an active member. */
export const getOrganizationStorage = async (db: Db, organizationId: string): Promise<OrganizationStorageUsage> => {
  const rows = (await unwrap(
    raw(db).rpc('my_organization_storage', { p_org: organizationId }),
  )) as OrganizationStorageRow[] | null;
  const row = rows?.[0];
  if (!row) throw HttpError.notFound('Church not found');
  return mapOrganizationStorage(row);
};

export const listMyDisabledOrganizations = async (db: Db): Promise<DisabledOrganization[]> => {
  const rows = (await unwrap(raw(db).rpc('my_disabled_organizations'))) as DisabledOrganizationRow[] | null;
  return (rows ?? []).map(mapDisabledOrganization);
};

/** Service role: deliveries for a disabled church are not sent. */
export const isOrganizationDisabled = async (organizationId: string): Promise<boolean> => {
  const row = await unwrap(
    adminDb.from('organization_platform_controls').select('status').eq('organization_id', organizationId).maybeSingle(),
  );
  return row?.status === 'disabled';
};

/** A platform access membership whose window has passed counts as gone. */
export const isExpiredPlatformAccess = (expiresAt: string | null, now: number = Date.now()): boolean =>
  expiresAt !== null && Date.parse(expiresAt) <= now;
