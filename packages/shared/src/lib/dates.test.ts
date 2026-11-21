import { describe, expect, it } from 'vitest';
import { addMonths, monthGrid, nextOccurrence, parseDuration, startOfMonth, toISODate } from './dates.js';

describe('date helpers', () => {
  it('do not mutate caller-owned Date instances', () => {
    const original = new Date(2026, 8, 5, 14, 30);
    const timestamp = original.getTime();

    expect(toISODate(startOfMonth(original))).toBe('2026-09-01');
    expect(toISODate(addMonths(original, 1))).toBe('2026-10-05');
    expect(original.getTime()).toBe(timestamp);
  });

  it('builds a six-week grid around the requested month using unique dates', () => {
    const cursor = new Date(2026, 8, 1);
    const timestamp = cursor.getTime();
    const days = monthGrid(cursor);

    expect(days).toHaveLength(42);
    expect(toISODate(days[0]!)).toBe('2026-08-30');
    expect(toISODate(days[1]!)).toBe('2026-08-31');
    expect(toISODate(days[2]!)).toBe('2026-09-01');
    expect(toISODate(days.at(-1)!)).toBe('2026-10-10');
    expect(new Set(days.map((day) => day.getTime())).size).toBe(42);
    expect(cursor.getTime()).toBe(timestamp);
  });

  it('steps a service date forward by its recurrence', () => {
    const sunday = new Date(2026, 8, 13);

    expect(toISODate(nextOccurrence(sunday, 'weekly'))).toBe('2026-09-20');
    expect(toISODate(nextOccurrence(sunday, 'biweekly'))).toBe('2026-09-27');
    expect(toISODate(nextOccurrence(sunday, 'monthly'))).toBe('2026-10-13');
    // No fixed rhythm, so it still offers a sensible next date to edit.
    expect(toISODate(nextOccurrence(sunday, 'occasionally'))).toBe('2026-09-20');
  });
});

describe('parseDuration', () => {
  it('accepts seconds, m:ss and h:mm:ss', () => {
    expect(parseDuration('285')).toBe(285);
    expect(parseDuration('4:45')).toBe(285);
    expect(parseDuration(' 0:05 ')).toBe(5);
    expect(parseDuration('1:02:03')).toBe(3723);
    expect(parseDuration('90:00')).toBe(5400);
  });

  it.each(['99:99', '1:75', '1:60', '1:2:3:4', '1:99:00', '1::2', '1:', 'a:10', '-1:30', ''])('rejects %j', (input) => {
    expect(parseDuration(input)).toBeNull();
  });
});
