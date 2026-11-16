import { describe, expect, it } from 'vitest';
import type { AdminUserMembership, AdminUserSummary } from '@service-center/shared';
import {
  EMPTY_USER_FILTER,
  churchOptions,
  confirmationMatches,
  filterUsers,
  soleOwnedChurches,
  userDisplayName,
} from './users';

const membership = (overrides: Partial<AdminUserMembership> = {}): AdminUserMembership => ({
  organization_id: 'grace',
  organization_name: 'Grace Church',
  role: 'member',
  status: 'active',
  joined_at: '2026-11-01T00:00:00Z',
  ...overrides,
});

const user = (id: string, overrides: Partial<AdminUserSummary> = {}): AdminUserSummary => ({
  id,
  email: `${id}@example.test`,
  full_name: id.toUpperCase(),
  created_at: '2026-11-01T00:00:00Z',
  last_sign_in_at: null,
  email_confirmed: true,
  block: null,
  is_platform_admin: false,
  memberships: [],
  ...overrides,
});

const blocked = { reason: 'Spam', blocked_at: '2026-11-10T00:00:00Z', blocked_by: 'a', blocked_by_name: 'Avery' };

const users = [
  user('ann', { memberships: [membership({ role: 'owner' })] }),
  user('bob', { block: blocked, memberships: [membership()] }),
  user('cat', { is_platform_admin: true }),
  user('dan', { memberships: [membership({ organization_id: 'hope', organization_name: 'Hope Chapel', status: 'invited' })] }),
];

const ids = (list: readonly AdminUserSummary[]): string[] => list.map((entry) => entry.id);

describe('filterUsers', () => {
  it('searches name, email and church name, ignoring case', () => {
    expect(ids(filterUsers(users, { ...EMPTY_USER_FILTER, query: 'BOB' }))).toEqual(['bob']);
    expect(ids(filterUsers(users, { ...EMPTY_USER_FILTER, query: 'cat@example' }))).toEqual(['cat']);
    expect(ids(filterUsers(users, { ...EMPTY_USER_FILTER, query: 'hope' }))).toEqual(['dan']);
  });

  it('filters by status', () => {
    expect(ids(filterUsers(users, { ...EMPTY_USER_FILTER, status: 'blocked' }))).toEqual(['bob']);
    expect(ids(filterUsers(users, { ...EMPTY_USER_FILTER, status: 'active' }))).toEqual(['ann', 'cat', 'dan']);
    expect(ids(filterUsers(users, { ...EMPTY_USER_FILTER, status: 'super_admin' }))).toEqual(['cat']);
    // An invitation alone is not belonging to a church.
    expect(ids(filterUsers(users, { ...EMPTY_USER_FILTER, status: 'no_church' }))).toEqual(['cat', 'dan']);
  });

  it('filters by church, invitations included', () => {
    expect(ids(filterUsers(users, { ...EMPTY_USER_FILTER, churchId: 'grace' }))).toEqual(['ann', 'bob']);
    expect(ids(filterUsers(users, { ...EMPTY_USER_FILTER, churchId: 'hope' }))).toEqual(['dan']);
  });
});

describe('churchOptions', () => {
  it('lists each church once, by name', () => {
    expect(churchOptions(users)).toEqual([
      { id: 'grace', name: 'Grace Church' },
      { id: 'hope', name: 'Hope Chapel' },
    ]);
  });
});

describe('soleOwnedChurches', () => {
  it('finds churches with no other unblocked owner', () => {
    const [ann] = users;
    if (!ann) throw new Error('fixture');
    expect(soleOwnedChurches(ann, users).map((church) => church.organization_id)).toEqual(['grace']);
    const coOwner = user('eve', { memberships: [membership({ role: 'owner' })] });
    expect(soleOwnedChurches(ann, [...users, coOwner])).toEqual([]);
    expect(soleOwnedChurches(ann, [...users, { ...coOwner, block: blocked }])).toHaveLength(1);
  });
});

describe('userDisplayName', () => {
  it('falls back from name to email', () => {
    expect(userDisplayName({ full_name: ' Ann ', email: 'a@x.test' })).toBe('Ann');
    expect(userDisplayName({ full_name: '  ', email: 'a@x.test' })).toBe('a@x.test');
    expect(userDisplayName({ full_name: null, email: null })).toBe('Unnamed account');
  });
});

describe('confirmationMatches', () => {
  it('needs the exact email, ignoring case and surrounding spaces', () => {
    expect(confirmationMatches('Ann@Example.test', ' ann@example.test ')).toBe(true);
    expect(confirmationMatches('ann@example.test', 'ann@example')).toBe(false);
    expect(confirmationMatches('ann@example.test', '')).toBe(false);
    expect(confirmationMatches(null, '')).toBe(false);
  });
});
