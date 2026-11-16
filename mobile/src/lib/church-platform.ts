/**
 * Super-admin platform rules as the app shows them: church applications,
 * disabled churches, Service Center admin access and the media quota. Pure,
 * so screens and tests share one reading. See docs/plans/super-admin-dashboard.md.
 */
import {
  ApiError,
  LocalizedError,
  ORGANIZATION_DISABLED,
  STORAGE_QUOTA_WARNING_FRACTION,
  storageQuotaState,
  type ChurchApplicationDraft,
  type CurrentUser,
  type OrganizationStorageUsage,
} from '@service-center/shared';

/** The fields the server refuses to accept blank. */
export type ChurchApplicationRequiredField = 'church_name' | 'leader_name' | 'city' | 'country' | 'timezone';

export const CHURCH_APPLICATION_REQUIRED_FIELDS: readonly ChurchApplicationRequiredField[] = [
  'church_name',
  'leader_name',
  'city',
  'country',
  'timezone',
];

/** True once every required field has more than whitespace. */
export const isChurchApplicationDraftComplete = (draft: ChurchApplicationDraft): boolean =>
  CHURCH_APPLICATION_REQUIRED_FIELDS.every((field) => draft[field].trim().length > 0);

/** The device's IANA zone, the application form's default. */
export const deviceTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** The active church entered as a temporary owner by a Service Center admin. */
export interface PlatformAccess {
  churchName: string;
  expiresAt: string;
}

export const platformAccessFor = (
  user: CurrentUser | null,
  organizationId: string | null,
): PlatformAccess | null => {
  const membership = user?.memberships.find((entry) => entry.organization.id === organizationId);
  if (!membership?.platform_access_expires_at) return null;
  return { churchName: membership.organization.name, expiresAt: membership.platform_access_expires_at };
};

export type StorageQuotaLevel = 'ok' | 'warning' | 'full';

/** `ok` until the usage is known. */
export const storageQuotaLevel = (usage: OrganizationStorageUsage | null | undefined): StorageQuotaLevel =>
  usage ? storageQuotaState(usage.fraction_used, STORAGE_QUOTA_WARNING_FRACTION) : 'ok';

/** Whole percent used, rounded down so 79.6% never reads as the 80% warning. */
export const storagePercentUsed = (usage: OrganizationStorageUsage): number =>
  Math.max(0, Math.floor(usage.fraction_used * 100));

/** The bar's fill, 0–1 (usage can overshoot the quota by one last file). */
export const storageBarFraction = (usage: OrganizationStorageUsage): number =>
  Math.min(1, Math.max(0, usage.fraction_used));

/**
 * Direct Supabase Storage uploads (the church logo) that the quota refuses
 * come back as a storage policy error, not `storage_quota_exceeded`. When the
 * church is out of space, explain that instead; otherwise keep the original
 * error. If the usage itself can't be read, the original error is still shown.
 */
export const explainDirectUploadError = async (
  error: unknown,
  loadUsage: () => Promise<OrganizationStorageUsage>,
): Promise<unknown> => {
  const usage = await loadUsage().then(
    (value): OrganizationStorageUsage | null => value,
    (): null => null,
  );
  return usage && usage.fraction_used >= 1
    ? new LocalizedError({ key: 'errors:codes.storage_quota_exceeded' })
    : error;
};

/** A request into a church a super admin disabled. */
export const isOrganizationDisabledError = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 403 && error.code === ORGANIZATION_DISABLED;
