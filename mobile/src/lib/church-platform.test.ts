import { describe, expect, it } from 'vitest';
import {
  ApiError,
  LocalizedError,
  emptyChurchApplicationDraft,
  type CurrentUser,
  type OrganizationStorageUsage,
} from '@service-center/shared';
import {
  deviceTimeZone,
  explainDirectUploadError,
  isChurchApplicationDraftComplete,
  isOrganizationDisabledError,
  platformAccessFor,
  storageBarFraction,
  storagePercentUsed,
  storageQuotaLevel,
} from './church-platform';

const GRACE = '00000000-0000-4000-8000-0000000000c1';
const HOPE = '00000000-0000-4000-8000-0000000000c2';

const user = {
  profile: { id: 'u1' },
  memberships: [
    { organization: { id: GRACE, name: 'Grace' }, role: 'owner', platform_access_expires_at: '2026-11-15T20:00:00Z' },
    { organization: { id: HOPE, name: 'Hope' }, role: 'member', platform_access_expires_at: null },
  ],
  disabled_organizations: [],
} as unknown as CurrentUser;

const usage = (fraction: number): OrganizationStorageUsage => ({
  used_bytes: Math.round(fraction * 1000),
  quota_bytes: 1000,
  fraction_used: fraction,
});

describe('church application draft', () => {
  it('needs church name, leader, city, country and time zone', () => {
    const draft = emptyChurchApplicationDraft('America/New_York');
    expect(isChurchApplicationDraftComplete(draft)).toBe(false);
    const complete = { ...draft, church_name: 'Grace', leader_name: 'Pat', city: 'Atlanta', country: 'US' };
    expect(isChurchApplicationDraftComplete(complete)).toBe(true);
    expect(isChurchApplicationDraftComplete({ ...complete, city: '   ' })).toBe(false);
    expect(isChurchApplicationDraftComplete({ ...complete, timezone: '' })).toBe(false);
  });
});

describe('platformAccessFor', () => {
  it('describes the active church only when a Service Center admin entered it', () => {
    expect(platformAccessFor(user, GRACE)).toEqual({ churchName: 'Grace', expiresAt: '2026-11-15T20:00:00Z' });
    expect(platformAccessFor(user, HOPE)).toBeNull();
    expect(platformAccessFor(user, null)).toBeNull();
    expect(platformAccessFor(null, GRACE)).toBeNull();
  });
});

describe('storage quota', () => {
  it('is ok below 80%, a warning from 80% and full from 100%', () => {
    expect(storageQuotaLevel(undefined)).toBe('ok');
    expect(storageQuotaLevel(usage(0.79))).toBe('ok');
    expect(storageQuotaLevel(usage(0.8))).toBe('warning');
    expect(storageQuotaLevel(usage(1))).toBe('full');
    expect(storageQuotaLevel(usage(1.2))).toBe('full');
  });

  it('rounds the percent down and caps the bar', () => {
    expect(storagePercentUsed(usage(0.796))).toBe(79);
    expect(storagePercentUsed(usage(0.85))).toBe(85);
    expect(storageBarFraction(usage(1.3))).toBe(1);
    expect(storageBarFraction(usage(0.5))).toBe(0.5);
  });
});

describe('explainDirectUploadError', () => {
  const original = new Error('new row violates row-level security policy');

  it('explains the quota when the church is out of space', async () => {
    const explained = await explainDirectUploadError(original, async () => usage(1));
    expect(explained).toBeInstanceOf(LocalizedError);
    expect((explained as LocalizedError).translatable.key).toBe('errors:codes.storage_quota_exceeded');
  });

  it('keeps the original error under the quota or when usage cannot be read', async () => {
    expect(await explainDirectUploadError(original, async () => usage(0.95))).toBe(original);
    expect(
      await explainDirectUploadError(original, async () => {
        throw new Error('offline');
      }),
    ).toBe(original);
  });
});

describe('isOrganizationDisabledError', () => {
  it('matches only the 403 organization_disabled code', () => {
    expect(isOrganizationDisabledError(new ApiError(403, 'Disabled', 'organization_disabled'))).toBe(true);
    expect(isOrganizationDisabledError(new ApiError(403, 'Forbidden', 'forbidden'))).toBe(false);
    expect(isOrganizationDisabledError(new Error('organization_disabled'))).toBe(false);
  });
});

describe('deviceTimeZone (API-D4)', () => {
  it('keeps a valid IANA zone and falls back to UTC otherwise', () => {
    expect(deviceTimeZone('America/Chicago')).toBe('America/Chicago');
    expect(deviceTimeZone('UTC')).toBe('UTC');
    expect(deviceTimeZone('Not/AZone')).toBe('UTC');
    expect(deviceTimeZone('')).toBe('UTC');
    expect(typeof deviceTimeZone()).toBe('string');
  });
});
