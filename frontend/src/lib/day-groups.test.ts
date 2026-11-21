import { describe, expect, it } from 'vitest';
import { dayLabelKind, groupByDay } from './day-groups';
import { formatMonthParam, parseMonthParam } from './calendar-params';

describe('day groups', () => {
  it('splits a sorted list into local days without reordering', () => {
    const at = (day: number, hour: number) => new Date(2026, 10, day, hour).toISOString();
    const items = [{ id: 'a', at: at(21, 18) }, { id: 'b', at: at(21, 9) }, { id: 'c', at: at(20, 23) }];
    const groups = groupByDay(items, (item) => item.at);
    expect(groups.map((group) => [group.day, group.items.map((item) => item.id)])).toEqual([
      ['2026-11-21', ['a', 'b']],
      ['2026-11-20', ['c']],
    ]);
  });

  it('names today, yesterday and tomorrow, and dates otherwise', () => {
    const now = new Date(2026, 10, 21, 12);
    expect(dayLabelKind('2026-11-21', now)).toBe('today');
    expect(dayLabelKind('2026-11-20', now)).toBe('yesterday');
    expect(dayLabelKind('2026-11-22', now)).toBe('tomorrow');
    expect(dayLabelKind('2026-11-01', now)).toBe('date');
  });
});

describe('calendar month parameter', () => {
  it('round-trips a month and rejects anything else', () => {
    expect(formatMonthParam(new Date(2027, 0, 17))).toBe('2027-01');
    expect(parseMonthParam('2027-01')?.getTime()).toBe(new Date(2027, 0, 1).getTime());
    for (const bad of [null, '', '2027-13', '2027-1', 'january', '2027-01-01']) expect(parseMonthParam(bad)).toBeNull();
  });
});
