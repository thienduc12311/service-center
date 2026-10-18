import { describe, expect, it } from 'vitest';
import {
  expandBlockoutRecurrence,
  possibleInstantsForLocalDateTime,
  resolveOneOffBlockout,
  resolveZonedLocalDateTime,
} from './timezone.js';

describe('organization timezone blockouts', () => {
  it('keeps an all-day Sunday in the organization timezone across a 23-hour DST day', () => {
    const occurrence = resolveOneOffBlockout({
      allDay: true,
      timeZone: 'America/New_York',
      localStartDate: '2027-03-14',
      localEndDate: '2027-03-15',
      ambiguousTimePolicy: 'earlier',
    });
    expect(occurrence.localStartDate).toBe('2027-03-14');
    expect(new Date(occurrence.endsAt).getTime() - new Date(occurrence.startsAt).getTime()).toBe(23 * 3_600_000);
  });

  it('keeps an all-day Sunday across a 25-hour DST day', () => {
    const occurrence = resolveOneOffBlockout({
      allDay: true,
      timeZone: 'America/New_York',
      localStartDate: '2027-11-07',
      localEndDate: '2027-11-08',
      ambiguousTimePolicy: 'later',
    });
    expect(new Date(occurrence.endsAt).getTime() - new Date(occurrence.startsAt).getTime()).toBe(25 * 3_600_000);
  });

  it('rejects nonexistent wall times and requires an explicit ambiguous offset', () => {
    expect(possibleInstantsForLocalDateTime('2027-03-14', '02:30', 'America/New_York')).toEqual([]);
    expect(() => resolveZonedLocalDateTime({
      localDate: '2027-03-14', localTime: '02:30', timeZone: 'America/New_York',
    })).toThrow(/does not exist/);

    const fold = possibleInstantsForLocalDateTime('2027-11-07', '01:30', 'America/New_York');
    expect(fold.map((item) => item.utcOffsetMinutes)).toEqual([-240, -300]);
    expect(() => resolveZonedLocalDateTime({
      localDate: '2027-11-07', localTime: '01:30', timeZone: 'America/New_York',
    })).toThrow(/occurs twice/);
    expect(resolveZonedLocalDateTime({
      localDate: '2027-11-07', localTime: '01:30', timeZone: 'America/New_York', utcOffsetMinutes: -300,
    }).instant).toBe('2027-11-07T06:30:00.000Z');
    expect(() => possibleInstantsForLocalDateTime('2027-01-01', '09:00', 'Not/A_Zone')).toThrow(/valid IANA/);
  });

  it('preserves weekly wall time across DST', () => {
    const occurrences = expandBlockoutRecurrence({
      allDay: false,
      timeZone: 'America/New_York',
      localStartDate: '2027-03-07',
      localStartTime: '09:00',
      localEndDate: '2027-03-07',
      localEndTime: '10:00',
      frequency: 'weekly',
      interval: 1,
      end: { type: 'count', count: 3 },
      monthlyMissingDate: 'skip',
      ambiguousTimePolicy: 'earlier',
    });
    expect(occurrences.map((item) => item.localStartDate)).toEqual(['2027-03-07', '2027-03-14', '2027-03-21']);
    expect(occurrences.map((item) => item.startsAt)).toEqual([
      '2027-03-07T14:00:00.000Z',
      '2027-03-14T13:00:00.000Z',
      '2027-03-21T13:00:00.000Z',
    ]);
  });

  it('skips missing monthly dates and stays finite', () => {
    const occurrences = expandBlockoutRecurrence({
      allDay: true,
      timeZone: 'UTC',
      localStartDate: '2027-01-31',
      localEndDate: '2027-02-01',
      frequency: 'monthly',
      interval: 1,
      end: { type: 'count', count: 3 },
      monthlyMissingDate: 'skip',
      ambiguousTimePolicy: 'earlier',
    });
    expect(occurrences.map((item) => item.localStartDate)).toEqual(['2027-01-31', '2027-03-31', '2027-05-31']);
    expect(occurrences).toHaveLength(3);
  });

  it('refuses an until rule that would exceed the finite occurrence bound', () => {
    expect(() => expandBlockoutRecurrence({
      allDay: true, timeZone: 'UTC', localStartDate: '2027-01-01', localEndDate: '2027-01-02',
      frequency: 'weekly', interval: 1, end: { type: 'until', untilDate: '2035-01-01' },
      monthlyMissingDate: 'skip', ambiguousTimePolicy: 'earlier',
    })).toThrow(/120 occurrences/);
  });
});
