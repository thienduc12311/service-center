import { describe, expect, it } from 'vitest';
import { expandPlanSeries, resolveTemplateTimes, shiftPlanToDate } from './plan-templates.js';
import { planSeriesSchema, planTemplateContentSchema } from '../schemas/plan-templates.js';
import type { PlanTemplateTime } from '../types/plan-templates.js';

const sunday: PlanTemplateTime[] = [
  { kind: 'rehearsal', name: 'Run-through', day_offset: -1, local_start: '19:00', duration_minutes: 90 },
  { kind: 'service', name: 'Service', day_offset: 0, local_start: '10:00', duration_minutes: 75 },
];

const localClock = (instant: string, timeZone: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(instant));

describe('template times', () => {
  it('keeps 10:00 local on both sides of the November DST change', () => {
    const before = resolveTemplateTimes(sunday, '2027-10-31', 'America/Toronto', 'earlier');
    const after = resolveTemplateTimes(sunday, '2027-11-07', 'America/Toronto', 'earlier');
    if (!before.ok || !after.ok) throw new Error('expected resolution');
    expect(localClock(before.service_date, 'America/Toronto')).toBe('10:00');
    expect(localClock(after.service_date, 'America/Toronto')).toBe('10:00');
    // A fixed 7×24h week would land at 09:00 after the change.
    expect(new Date(after.service_date).getTime() - new Date(before.service_date).getTime()).toBe(7 * 24 * 3_600_000 + 3_600_000);
    // The rehearsal is the evening before, in local time.
    expect(localClock(after.times[0]!.starts_at, 'America/Toronto')).toBe('19:00');
    expect(new Date(after.times[1]!.ends_at).getTime() - new Date(after.times[1]!.starts_at).getTime()).toBe(75 * 60_000);
  });

  it('reports a time skipped by spring-forward instead of shifting it', () => {
    const early: PlanTemplateTime[] = [{ kind: 'service', name: null, day_offset: 0, local_start: '02:30', duration_minutes: 60 }];
    const result = resolveTemplateTimes(early, '2027-03-14', 'America/Toronto', 'earlier');
    expect(result.ok).toBe(false);
  });

  it('uses the explicit choice for a time that occurs twice', () => {
    const late: PlanTemplateTime[] = [{ kind: 'service', name: null, day_offset: 0, local_start: '01:30', duration_minutes: 30 }];
    const earlier = resolveTemplateTimes(late, '2027-11-07', 'America/Toronto', 'earlier');
    const later = resolveTemplateTimes(late, '2027-11-07', 'America/Toronto', 'later');
    if (!earlier.ok || !later.ok) throw new Error('expected resolution');
    expect(new Date(later.service_date).getTime() - new Date(earlier.service_date).getTime()).toBe(3_600_000);
  });
});

describe('plan series', () => {
  const base = {
    start_date: '2027-10-24',
    interval_weeks: 1,
    count: 4,
    excluded_dates: [] as string[],
    edits: [],
    default_title: 'Sunday',
  };

  it('lists excluded and skipped dates and still proposes the requested count', () => {
    const result = expandPlanSeries({
      ...base,
      excluded_dates: ['2027-10-31'],
      edits: [{ local_date: '2027-11-14', skip: true }],
    });
    expect(result.dates.map((date) => date.local_date)).toEqual(['2027-10-24', '2027-11-07', '2027-11-21', '2027-11-28']);
    expect(result.excluded).toEqual([
      { local_date: '2027-10-31', reason: 'excluded' },
      { local_date: '2027-11-14', reason: 'skipped' },
    ]);
    expect(result.problems).toEqual([]);
  });

  it('moves and renames one date and flags two plans on the same day', () => {
    const result = expandPlanSeries({
      ...base,
      edits: [
        { local_date: '2027-10-31', skip: false, move_to: '2027-11-07', title: 'Harvest' },
      ],
    });
    expect(result.dates[1]).toEqual({ series_date: '2027-10-31', local_date: '2027-11-07', title: 'Harvest' });
    expect(result.problems).toHaveLength(1);
  });

  it('stops at the end date and never exceeds the batch cap', () => {
    expect(expandPlanSeries({ ...base, end_date: '2027-11-07' }).dates).toHaveLength(3);
    expect(expandPlanSeries({ ...base, count: 50 }).dates).toHaveLength(12);
    expect(planSeriesSchema.safeParse({ revision_id: crypto.randomUUID(), start_date: '2027-10-24', count: 13 }).success).toBe(false);
  });

  it('always generates times and refuses unknown template components', () => {
    const parsed = planSeriesSchema.parse({ revision_id: crypto.randomUUID(), start_date: '2027-10-24', components: ['items'] });
    expect(parsed.components).toEqual(['items', 'times']);
    expect(planTemplateContentSchema.safeParse({ items: [], confirmed_answers: [] }).success).toBe(false);
  });
});

describe('plan shift', () => {
  const plan = {
    service_date: '2027-10-31T14:00:00.000Z',
    times: [
      { id: 'r', starts_at: '2027-10-30T23:00:00.000Z', ends_at: '2027-10-31T00:30:00.000Z' },
      { id: 's', starts_at: '2027-10-31T14:00:00.000Z', ends_at: '2027-10-31T15:15:00.000Z' },
    ],
  };

  it('keeps local clock and day offsets across the fall-back change', () => {
    const result = shiftPlanToDate(plan, '2027-11-07', 'America/Toronto', 'earlier');
    if (!result.ok) throw new Error(result.message);
    expect(result.plan.service_date).toBe('2027-11-07T15:00:00.000Z');
    expect(result.plan.times).toEqual([
      { id: 'r', starts_at: '2027-11-06T23:00:00.000Z', ends_at: '2027-11-07T00:30:00.000Z' },
      { id: 's', starts_at: '2027-11-07T15:00:00.000Z', ends_at: '2027-11-07T16:15:00.000Z' },
    ]);
  });

  it('reports a time the move would land in a spring-forward gap', () => {
    const early = { service_date: '2027-03-07T07:30:00.000Z', times: [] };
    expect(shiftPlanToDate(early, '2027-03-14', 'America/Toronto', 'earlier').ok).toBe(false);
  });
});
