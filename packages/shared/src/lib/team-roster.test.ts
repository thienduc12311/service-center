import { describe, expect, it } from 'vitest';
import type { TeamRosterPerson } from '../types/domain.js';
import { formatDateOfBirth, rosterDetailLines, rosterDisplayName } from './team-roster.js';

const person = (patch: Partial<TeamRosterPerson> = {}): TeamRosterPerson => ({
  id: 'p', full_name: 'Ada Lovelace', email: 'ada@example.test', avatar_url: null,
  phone: '+1 (555) 010-0200', role: 'member', date_of_birth: '1990-04-05', ...patch,
});

describe('team roster display', () => {
  it('prefers the name, then email, never invents Unknown', () => {
    expect(rosterDisplayName(person())).toBe('Ada Lovelace');
    expect(rosterDisplayName(person({ full_name: ' ' }))).toBe('ada@example.test');
    expect(rosterDisplayName(person({ full_name: null, email: null }))).toBeNull();
    expect(rosterDisplayName(null)).toBeNull();
  });

  it('formats the date of birth without a timezone shift', () => {
    expect(formatDateOfBirth('1990-04-05', 'en-US')).toBe('Apr 5, 1990');
    expect(formatDateOfBirth('1990-01-01', 'en-US')).toBe('Jan 1, 1990');
    expect(formatDateOfBirth(null)).toBeNull();
    expect(formatDateOfBirth('garbage')).toBeNull();
  });

  it('lists email, phone and birthday and omits absent fields', () => {
    const lines = rosterDetailLines(person(), 'en-US');
    expect(lines.map((l) => l.kind)).toEqual(['email', 'phone', 'birthday']);
    expect(lines[0]?.href).toBe('mailto:ada@example.test');
    expect(lines[1]?.href).toBe('tel:+15550100200');
    expect(lines[2]?.href).toBeNull();
    expect(rosterDetailLines(person({ email: null, phone: null, date_of_birth: null }))).toEqual([]);
    expect(rosterDetailLines(null)).toEqual([]);
  });
});
