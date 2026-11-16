import { describe, expect, it } from 'vitest';
import { timeZoneOptions } from './timezones';

describe('timeZoneOptions', () => {
  it('adds a missing current zone and sorts', () => {
    expect(timeZoneOptions('UTC', ['Europe/Paris', 'America/New_York'])).toEqual(['America/New_York', 'Europe/Paris', 'UTC']);
  });

  it('does not duplicate a known zone', () => {
    expect(timeZoneOptions('Europe/Paris', ['Europe/Paris'])).toEqual(['Europe/Paris']);
  });
});
