import { describe, expect, it } from 'vitest';
import type { PersonRow, ProfileRow } from '@service-center/shared';
import { mergeRoster, personDisplayName, splitFullName, type ActiveMemberRow } from './people.js';

const profile = (overrides: Partial<ProfileRow> = {}): ProfileRow => ({
  id: 'profile-1',
  email: 'avery@example.com',
  full_name: 'Avery Smith',
  phone: null,
  avatar_url: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const person = (overrides: Partial<PersonRow> = {}): PersonRow => ({
  id: 'person-1',
  organization_id: 'org-1',
  profile_id: null,
  first_name: 'Jamie',
  last_name: 'Lee',
  avatar_url: null,
  email: 'jamie@example.com',
  phone: null,
  phone_carrier: null,
  address_line1: null,
  address_line2: null,
  city: null,
  state_province: null,
  postal_code: null,
  country: null,
  campus: null,
  person_type: 'adult',
  gender: null,
  birthdate: null,
  marital_status: null,
  anniversary_date: null,
  school: null,
  medical_note: null,
  created_by: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('mergeRoster', () => {
  it('lists a no-login person standalone, flagged with a pending invite', () => {
    const roster = mergeRoster([], [person()], [{ person_id: 'person-1' }]);

    expect(roster).toEqual([
      expect.objectContaining({
        id: 'person-1',
        person_id: 'person-1',
        profile_id: null,
        has_login: false,
        role: null,
        status: 'no_account',
        invite_pending: true,
      }),
    ]);
  });

  it('enriches an active member with their linked roster fields', () => {
    const member: ActiveMemberRow = { role: 'scheduler', status: 'active', profile: profile() };
    const roster = mergeRoster(
      [member],
      [person({ id: 'person-1', profile_id: 'profile-1', campus: 'Downtown' })],
      [],
    );

    expect(roster).toEqual([
      expect.objectContaining({
        id: 'profile-1',
        person_id: 'person-1',
        profile_id: 'profile-1',
        has_login: true,
        full_name: 'Avery Smith',
        role: 'scheduler',
        campus: 'Downtown',
        invite_pending: false,
      }),
    ]);
  });

  it('drops a roster row whose linked member is no longer active', () => {
    const roster = mergeRoster([], [person({ profile_id: 'someone-else' })], []);
    expect(roster).toEqual([]);
  });

  it('sorts by name, falling back to email when unnamed', () => {
    const roster = mergeRoster(
      [],
      [
        person({ id: 'p2', first_name: 'Zed', last_name: null, email: 'zed@example.com' }),
        person({ id: 'p1', first_name: 'Amy', last_name: null, email: 'amy@example.com' }),
      ],
      [],
    );
    expect(roster.map((r) => r.id)).toEqual(['p1', 'p2']);
  });
});

describe('personDisplayName', () => {
  it('joins first and last name', () => {
    expect(personDisplayName({ first_name: 'Jamie', last_name: 'Lee' })).toBe('Jamie Lee');
  });

  it('omits a missing last name', () => {
    expect(personDisplayName({ first_name: 'Jamie', last_name: null })).toBe('Jamie');
  });
});

describe('splitFullName', () => {
  it('splits a two-word name', () => {
    expect(splitFullName('Avery Smith')).toEqual({ first_name: 'Avery', last_name: 'Smith' });
  });

  it('keeps a middle name as part of the last name', () => {
    expect(splitFullName('Avery Jean Smith')).toEqual({ first_name: 'Avery', last_name: 'Jean Smith' });
  });

  it('falls back to "Unnamed" when there is nothing to split', () => {
    expect(splitFullName(null)).toEqual({ first_name: 'Unnamed', last_name: null });
    expect(splitFullName('   ')).toEqual({ first_name: 'Unnamed', last_name: null });
  });

  it('treats a single word as the first name', () => {
    expect(splitFullName('Cher')).toEqual({ first_name: 'Cher', last_name: null });
  });
});
