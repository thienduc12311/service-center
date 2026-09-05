import { describe, expect, it } from 'vitest';
import { addMonths, monthGrid, startOfMonth, toISODate } from './dates.js';

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
});
