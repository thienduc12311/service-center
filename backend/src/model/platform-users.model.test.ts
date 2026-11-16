import { describe, expect, it } from 'vitest';
import { isRowBlocked, mapAdminUserDeletionChurch, mapAdminUserSummary, type AdminUserSummaryRow } from './platform-users.model.js';

const row = (overrides: Partial<AdminUserSummaryRow> = {}): AdminUserSummaryRow => ({
  user_id: 'u1',
  email: 'uma@example.test',
  full_name: 'Uma',
  created_at: '2026-11-01T00:00:00Z',
  last_sign_in_at: null,
  email_confirmed_at: '2026-11-01T00:00:00Z',
  banned_until: null,
  blocked_at: null,
  block_reason: null,
  blocked_by: null,
  blocked_by_name: null,
  is_platform_admin: false,
  memberships: null,
  ...overrides,
});

const now = new Date('2026-11-15T00:00:00Z');

describe('isRowBlocked', () => {
  it('is blocked with a block record or a future ban, not a past one', () => {
    expect(isRowBlocked(row(), now)).toBe(false);
    expect(isRowBlocked(row({ blocked_at: '2026-11-10T00:00:00Z' }), now)).toBe(true);
    expect(isRowBlocked(row({ banned_until: '2126-11-10T00:00:00Z' }), now)).toBe(true);
    expect(isRowBlocked(row({ banned_until: '2026-11-10T00:00:00Z' }), now)).toBe(false);
  });
});

describe('mapAdminUserSummary', () => {
  it('maps the block, confirmation and memberships', () => {
    const summary = mapAdminUserSummary(
      row({
        blocked_at: '2026-11-10T00:00:00Z',
        banned_until: '2126-11-10T00:00:00Z',
        block_reason: 'Spam',
        blocked_by: 'a1',
        blocked_by_name: 'Avery',
        memberships: [
          { organization_id: 'o1', organization_name: 'Grace', role: 'owner', status: 'active', joined_at: '2026-11-02T00:00:00Z' },
        ],
      }),
      now,
    );
    expect(summary.block).toEqual({ reason: 'Spam', blocked_at: '2026-11-10T00:00:00Z', blocked_by: 'a1', blocked_by_name: 'Avery' });
    expect(summary.email_confirmed).toBe(true);
    expect(summary.memberships).toHaveLength(1);
    expect(mapAdminUserSummary(row({ email_confirmed_at: null }), now)).toMatchObject({ block: null, email_confirmed: false, memberships: [] });
  });
});

describe('mapAdminUserDeletionChurch', () => {
  it('accepts the two outcomes and refuses anything else', () => {
    expect(mapAdminUserDeletionChurch({ organization_id: 'o1', organization_name: 'Grace', outcome: 'blocked' }).outcome).toBe('blocked');
    expect(() => mapAdminUserDeletionChurch({ organization_id: 'o1', organization_name: 'Grace', outcome: 'maybe' })).toThrow();
  });
});
