import { describe, expect, it } from 'vitest';
import {
  adminCreateChurchSchema,
  setOrganizationQuotaSchema,
  submitChurchApplicationSchema,
  updateChurchApplicationSchema,
  updatePlatformSettingsSchema,
} from './platform-admin.js';

const application = {
  church_name: '  Grace Atlanta ',
  leader_name: 'Pastor Lee',
  city: 'Atlanta',
  country: 'USA',
  timezone: 'America/New_York',
};

describe('submitChurchApplicationSchema', () => {
  it('trims text and turns empty optional fields into null', () => {
    const parsed = submitChurchApplicationSchema.parse({ ...application, website: '  ', note: '' });
    expect(parsed.church_name).toBe('Grace Atlanta');
    expect(parsed.website).toBeNull();
    expect(parsed.note).toBeNull();
    expect(parsed.expected_member_count).toBeNull();
  });

  it('requires the leader, city and country', () => {
    expect(submitChurchApplicationSchema.safeParse({ ...application, leader_name: ' ' }).success).toBe(false);
    expect(submitChurchApplicationSchema.safeParse({ ...application, city: undefined }).success).toBe(false);
    expect(submitChurchApplicationSchema.safeParse({ ...application, country: '' }).success).toBe(false);
  });

  it('refuses a time zone that does not exist', () => {
    expect(submitChurchApplicationSchema.safeParse({ ...application, timezone: 'Mars/Olympus' }).success).toBe(false);
  });
});

describe('updateChurchApplicationSchema', () => {
  it('needs at least one change', () => {
    expect(updateChurchApplicationSchema.safeParse({}).success).toBe(false);
    expect(updateChurchApplicationSchema.parse({ note: 'Sundays at 10' })).toEqual({ note: 'Sundays at 10' });
  });
});

describe('adminCreateChurchSchema', () => {
  it('normalizes the slug and owner email', () => {
    const parsed = adminCreateChurchSchema.parse({
      name: 'Grace',
      slug: ' Grace-ATL ',
      timezone: 'America/New_York',
      owner_email: ' Pastor@Example.COM ',
    });
    expect(parsed.slug).toBe('grace-atl');
    expect(parsed.owner_email).toBe('pastor@example.com');
  });
});

describe('quota inputs', () => {
  it('accepts null to return to the platform default', () => {
    expect(setOrganizationQuotaSchema.parse({ storage_quota_bytes: null })).toEqual({ storage_quota_bytes: null });
  });

  it('refuses quotas under 1 MB', () => {
    expect(setOrganizationQuotaSchema.safeParse({ storage_quota_bytes: 1000 }).success).toBe(false);
    expect(updatePlatformSettingsSchema.safeParse({ default_storage_quota_bytes: 0 }).success).toBe(false);
  });

  it('needs at least one setting', () => {
    expect(updatePlatformSettingsSchema.safeParse({}).success).toBe(false);
  });
});
