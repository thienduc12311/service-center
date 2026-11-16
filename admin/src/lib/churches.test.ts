import { describe, expect, it } from 'vitest';
import type { AdminOrganizationSummary } from '@service-center/shared';
import {
  churchesNearQuota,
  DEFAULT_CHURCH_SORT,
  filterChurches,
  nextChurchSort,
  serviceCenterChurchUrl,
  sortChurches,
} from './churches';

const MB = 1_048_576;

const church = (overrides: Partial<AdminOrganizationSummary>): AdminOrganizationSummary => ({
  id: 'id',
  name: 'Church',
  slug: 'church',
  created_at: '2026-01-01T00:00:00Z',
  status: 'active',
  disabled_reason: null,
  disabled_at: null,
  owner: null,
  accounts: 0,
  invited: 0,
  people: 0,
  storage_used_bytes: 0,
  storage_quota_bytes: 200 * MB,
  quota_is_custom: false,
  last_activity_at: null,
  ...overrides,
});

const grace = church({
  id: 'grace',
  name: 'Grace Church',
  slug: 'grace',
  owner: { user_id: 'u1', full_name: 'Anna Lee', email: 'anna@grace.org' },
  accounts: 12,
  storage_used_bytes: 190 * MB,
  last_activity_at: '2026-11-10T00:00:00Z',
});
const nguonSong = church({
  id: 'ns',
  name: 'Nguồn Sống',
  slug: 'nguon-song',
  status: 'disabled',
  owner: { user_id: 'u2', full_name: null, email: 'pastor@ns.org' },
  accounts: 40,
  storage_used_bytes: 20 * MB,
  created_at: '2026-05-01T00:00:00Z',
});
const bethel = church({
  id: 'bethel',
  name: 'Bethel',
  slug: 'bethel',
  accounts: 3,
  storage_used_bytes: 170 * MB,
  last_activity_at: '2026-11-14T00:00:00Z',
});
const all = [grace, nguonSong, bethel];

describe('filterChurches', () => {
  it('matches name, slug and owner email, ignoring accents', () => {
    expect(filterChurches(all, { query: 'nguon', status: 'all' })).toEqual([nguonSong]);
    expect(filterChurches(all, { query: 'BETH', status: 'all' })).toEqual([bethel]);
    expect(filterChurches(all, { query: 'anna@', status: 'all' })).toEqual([grace]);
  });

  it('filters by status', () => {
    expect(filterChurches(all, { query: '', status: 'disabled' })).toEqual([nguonSong]);
    expect(filterChurches(all, { query: '', status: 'active' })).toEqual([grace, bethel]);
  });
});

describe('sortChurches', () => {
  it('sorts by name by default', () => {
    expect(sortChurches(all, DEFAULT_CHURCH_SORT).map((c) => c.id)).toEqual(['bethel', 'grace', 'ns']);
  });

  it('sorts numbers in either direction', () => {
    expect(sortChurches(all, { key: 'accounts', direction: 'desc' }).map((c) => c.id)).toEqual(['ns', 'grace', 'bethel']);
    expect(sortChurches(all, { key: 'storage', direction: 'asc' }).map((c) => c.id)).toEqual(['ns', 'bethel', 'grace']);
  });

  it('keeps missing values last', () => {
    expect(sortChurches(all, { key: 'last_activity', direction: 'desc' }).map((c) => c.id)).toEqual(['bethel', 'grace', 'ns']);
    expect(sortChurches(all, { key: 'last_activity', direction: 'asc' }).map((c) => c.id)).toEqual(['grace', 'bethel', 'ns']);
    expect(sortChurches(all, { key: 'owner', direction: 'desc' }).map((c) => c.id)).toEqual(['ns', 'grace', 'bethel']);
  });

  it('does not change its input', () => {
    const input = [...all];
    sortChurches(input, { key: 'accounts', direction: 'asc' });
    expect(input).toEqual(all);
  });
});

describe('nextChurchSort', () => {
  it('flips the current column and starts others in their natural order', () => {
    expect(nextChurchSort({ key: 'name', direction: 'asc' }, 'name')).toEqual({ key: 'name', direction: 'desc' });
    expect(nextChurchSort({ key: 'name', direction: 'asc' }, 'storage')).toEqual({ key: 'storage', direction: 'desc' });
  });
});

describe('churchesNearQuota', () => {
  it('lists churches at 80% or more, fullest first', () => {
    expect(churchesNearQuota(all).map((c) => c.id)).toEqual(['grace', 'bethel']);
  });
});

describe('serviceCenterChurchUrl', () => {
  it('points the main app at the church', () => {
    expect(serviceCenterChurchUrl('https://app.example.com', 'abc')).toBe('https://app.example.com/?organization=abc');
    expect(serviceCenterChurchUrl('http://localhost:5173/', 'abc')).toBe('http://localhost:5173/?organization=abc');
  });
});
