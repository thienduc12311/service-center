import { describe, expect, it } from 'vitest';
import { availabilityFreshness, formatCivilDate, isFreshnessWarning, weekOfMonth } from './availability.js';

describe('availabilityFreshness', () => {
  const now = new Date('2027-05-01T12:00:00Z');

  it('distinguishes never reviewed from stale and current', () => {
    expect(availabilityFreshness(null, { now })).toBe('unknown');
    expect(availabilityFreshness('2027-04-20T00:00:00Z', { now })).toBe('current');
    expect(availabilityFreshness('2027-01-20T00:00:00Z', { now })).toBe('stale');
  });

  it('treats a review older than the request as stale even when recent', () => {
    expect(availabilityFreshness('2027-04-28T00:00:00Z', { now, requestedAt: '2027-04-29T00:00:00Z' })).toBe('stale');
    expect(availabilityFreshness('2027-04-30T00:00:00Z', { now, requestedAt: '2027-04-29T00:00:00Z' })).toBe('current');
  });
});

describe('weekOfMonth', () => {
  it('matches the database rule (days 1–7 are week 1)', () => {
    expect(weekOfMonth('2027-05-01')).toBe(1);
    expect(weekOfMonth('2027-05-07')).toBe(1);
    expect(weekOfMonth('2027-05-08')).toBe(2);
    expect(weekOfMonth('2027-05-29')).toBe(5);
  });
});

describe('isFreshnessWarning', () => {
  it('separates missing information from preferences', () => {
    expect(isFreshnessWarning('availability_unknown')).toBe(true);
    expect(isFreshnessWarning('frequency')).toBe(false);
  });
});

describe('formatCivilDate', () => {
  it('keeps the calendar date regardless of the viewer timezone', () => {
    expect(formatCivilDate('2026-10-17')).toBe('Sat, Oct 17');
  });
});
