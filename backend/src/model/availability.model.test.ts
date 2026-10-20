import { describe, expect, it } from 'vitest';
import {
  busyElsewhereWarnings,
  copyIdempotencyUuid,
  toDelegatedEntry,
  toDelegationSummary,
  toPreferenceWarnings,
  toRequestRecipient,
  type DelegationWithPeople,
} from './availability.model.js';

const now = new Date('2027-05-01T12:00:00Z');

describe('toPreferenceWarnings', () => {
  it('keeps known codes and drops anything unexpected', () => {
    const warnings = toPreferenceWarnings([
      { person_id: 'p', code: 'frequency', detail: 'x', preference_team_id: 't' },
      { person_id: 'p', code: 'not_a_code', detail: 'y', preference_team_id: null },
    ]);
    expect(warnings.map((w) => w.code)).toEqual(['frequency']);
  });

  it('keeps well-formed structured params and drops anything else', () => {
    const [monthly, frequency, stale, legacy] = toPreferenceWarnings([
      { person_id: 'p', code: 'monthly_max', detail: 'Already serving 2 of at most 2 this month', preference_team_id: null, params: { served: 2, max: 2, extra: 'x' } },
      { person_id: 'p', code: 'frequency', detail: 'x', preference_team_id: null, params: { frequency: 'every_fortnight', week: -1 } },
      { person_id: 'p', code: 'availability_stale', detail: 'x', preference_team_id: null, params: { reviewed_on: '2027-01-31' } },
      // Rows from a database without the structured-notices migration.
      { person_id: 'p', code: 'avoided_week', detail: 'Asked not to serve in week 2 of the month', preference_team_id: null },
    ]);
    expect(monthly?.params).toEqual({ served: 2, max: 2 });
    expect(frequency?.params).toEqual({});
    expect(stale?.params).toEqual({ reviewed_on: '2027-01-31' });
    expect(legacy).toMatchObject({ params: {}, detail: 'Asked not to serve in week 2 of the month' });
  });
});

describe('busyElsewhereWarnings', () => {
  const times = [{ starts_at: '2027-05-09T14:00:00Z', ends_at: '2027-05-09T15:30:00Z' }];

  it('warns once per person whose busy interval overlaps a requested time', () => {
    const warnings = busyElsewhereWarnings([
      { person_id: 'a', starts_at: '2027-05-09T13:00:00Z', ends_at: '2027-05-09T14:30:00Z' },
      { person_id: 'a', starts_at: '2027-05-09T15:00:00Z', ends_at: '2027-05-09T16:00:00Z' },
      { person_id: 'b', starts_at: '2027-05-09T15:30:00Z', ends_at: '2027-05-09T16:00:00Z' },
    ], times);
    expect(warnings).toEqual([{ person_id: 'a', code: 'busy_elsewhere', detail: 'Busy at this time in another organization', params: {}, preference_team_id: null }]);
  });

  it('treats touching boundaries as free (half-open intervals)', () => {
    expect(busyElsewhereWarnings([{ person_id: 'b', starts_at: '2027-05-09T15:30:00Z', ends_at: '2027-05-09T16:00:00Z' }], times)).toEqual([]);
  });
});

describe('toRequestRecipient', () => {
  it('judges a review from before the request as stale', () => {
    const recipient = toRequestRecipient(
      { person_id: 'p', responded_at: null, response_kind: null, person: { first_name: 'Sam', last_name: 'Lee' } },
      { reviewed_at: '2027-04-28T00:00:00Z' }, '2027-04-29T00:00:00Z', now,
    );
    expect(recipient).toMatchObject({ name: 'Sam Lee', freshness: 'stale' });
  });
});

describe('toDelegationSummary', () => {
  const row: DelegationWithPeople = {
    id: 'd', organization_id: 'o', target_person_id: 'sam', delegate_person_id: 'riley', granted_by: 'u',
    can_respond: true, can_view_schedule: false, can_manage_availability: false, can_signup: false,
    expires_at: '2027-04-30T00:00:00Z', revoked_at: null, revoked_by: null, created_at: '2027-04-01T00:00:00Z',
    target: { first_name: 'Sam', last_name: null }, delegate: { first_name: 'Riley', last_name: 'K' },
  };

  it('reports direction from the caller and expiry as inactive', () => {
    expect(toDelegationSummary(row, 'sam', now)).toMatchObject({ direction: 'given', active: false, delegate_name: 'Riley K' });
    expect(toDelegationSummary({ ...row, expires_at: null }, 'riley', now)).toMatchObject({ direction: 'received', active: true });
  });
});

describe('toDelegatedEntry', () => {
  it('keeps only well-formed times from JSON', () => {
    const entry = toDelegatedEntry({
      assignment_id: 'a', status: 'unconfirmed', plan_id: 'p', plan_title: 'Sunday', service_date: '2027-05-09T00:00:00Z',
      location: null, team_name: 'Band', position_name: 'Keys',
      times: [{ id: 't', kind: 'service', name: '10am', starts_at: 's', ends_at: 'e' }, { bogus: true }],
    });
    expect(entry.times).toHaveLength(1);
  });
});

describe('copyIdempotencyUuid', () => {
  it('is a stable, valid UUID for the same digest', () => {
    const digest = 'a3f1c2d4e5b6978877665544332211ffeeddccbb';
    expect(copyIdempotencyUuid(digest)).toBe(copyIdempotencyUuid(digest));
    expect(copyIdempotencyUuid(digest)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
