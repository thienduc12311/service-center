import { describe, expect, it } from 'vitest';
import {
  mapAdminOrganizationSummary,
  mapOrganizationStorage,
  mapPlatformAccessGrant,
  sessionAssurance,
  type AdminOrganizationSummaryRow,
} from './platform-admin.model.js';

const token = (claims: unknown): string =>
  ['header', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'signature'].join('.');

describe('sessionAssurance', () => {
  it('reads aal2 from a two-factor session', () => {
    expect(sessionAssurance(token({ sub: 'u', aal: 'aal2' }))).toBe('aal2');
  });

  it('treats a password session as aal1', () => {
    expect(sessionAssurance(token({ sub: 'u', aal: 'aal1' }))).toBe('aal1');
  });

  it('never lets an unreadable or missing claim pass as aal2', () => {
    expect(sessionAssurance(token({ sub: 'u' }))).toBe('aal1');
    expect(sessionAssurance(token({ aal: 'AAL2' }))).toBe('aal1');
    expect(sessionAssurance('not-a-jwt')).toBe('aal1');
    expect(sessionAssurance('a.%%%.c')).toBe('aal1');
  });
});

describe('mapOrganizationStorage', () => {
  it('accepts bigint strings and computes the fraction used', () => {
    expect(mapOrganizationStorage({ used_bytes: '167772160', quota_bytes: 209715200 })).toEqual({
      used_bytes: 167772160,
      quota_bytes: 209715200,
      fraction_used: 0.8,
    });
  });

  it('reports 0 used of an unknown quota as 0', () => {
    expect(mapOrganizationStorage({ used_bytes: 0, quota_bytes: 0 }).fraction_used).toBe(0);
  });
});

describe('mapAdminOrganizationSummary', () => {
  const row: AdminOrganizationSummaryRow = {
    organization_id: 'org-1',
    name: 'Grace',
    slug: 'grace',
    created_at: '2026-11-01T00:00:00Z',
    status: 'active',
    disabled_reason: null,
    disabled_at: null,
    owner_id: null,
    owner_name: null,
    owner_email: null,
    accounts: 3,
    invited: 1,
    people: 12,
    storage_used_bytes: '1048576',
    storage_quota_bytes: '209715200',
    quota_is_custom: false,
    last_activity_at: null,
  };

  it('maps a church without an owner and converts byte counts', () => {
    const summary = mapAdminOrganizationSummary(row);
    expect(summary.owner).toBeNull();
    expect(summary.storage_used_bytes).toBe(1048576);
    expect(summary.storage_quota_bytes).toBe(209715200);
  });

  it('groups the owner fields', () => {
    expect(
      mapAdminOrganizationSummary({ ...row, owner_id: 'u-1', owner_name: 'Ada', owner_email: 'ada@example.com' }).owner,
    ).toEqual({ user_id: 'u-1', full_name: 'Ada', email: 'ada@example.com' });
  });
});

describe('mapPlatformAccessGrant', () => {
  it('passes known outcomes through', () => {
    expect(mapPlatformAccessGrant({ outcome: 'already_member', expires_at: null })).toEqual({
      outcome: 'already_member',
      expires_at: null,
    });
  });

  it('refuses an outcome it does not understand', () => {
    expect(() => mapPlatformAccessGrant({ outcome: 'surprise', expires_at: null })).toThrow();
  });
});
