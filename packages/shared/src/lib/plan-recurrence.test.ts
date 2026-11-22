import { describe, expect, it } from 'vitest';
import {
  MAX_GENERATED_PLANS,
  daysInMonth,
  defaultRecurrence,
  isLastWeekdayOfMonth,
  monthlyDayDate,
  nthWeekdayOfMonth,
  ordinalOf,
  recurrenceDates,
  recurrenceForFrequency,
  seriesHorizon,
  seriesRecurrence,
  weekdayOf,
} from './plan-recurrence.js';
import { expandPlanSeries, resolveTemplateTimes, type PlanSeriesExpansionInput } from './plan-templates.js';
import { planSeriesSchema, type PlanSeriesRecurrence } from '../schemas/plan-templates.js';
import type { PlanTemplateTime } from '../types/plan-templates.js';
import { createI18n, translateMessage } from '../i18n/engine.js';
import { planRecurrenceText, planSeriesSummaryText } from '../i18n/recurrence-text.js';
import type { StructuredTextContext } from '../i18n/structured-text.js';
import type { SupportedLocale } from '../i18n/locales.js';

const dates = (start: string, rule: PlanSeriesRecurrence, horizon: string): string[] => [...recurrenceDates(start, rule, horizon)];
const weekly = (interval_weeks: number): PlanSeriesRecurrence => ({ frequency: 'weekly', interval_weeks });
const SUNDAY = 0;

describe('calendar helpers', () => {
  it('knows month lengths, including leap years', () => {
    expect(daysInMonth(2027, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2027, 4)).toBe(30);
    expect(daysInMonth(2027, 12)).toBe(31);
  });

  it('finds the Nth and the last weekday of a month', () => {
    expect(nthWeekdayOfMonth(2027, 5, SUNDAY, 'first')).toBe('2027-05-02');
    expect(nthWeekdayOfMonth(2027, 5, SUNDAY, 'second')).toBe('2027-05-09');
    expect(nthWeekdayOfMonth(2027, 5, SUNDAY, 'fourth')).toBe('2027-05-23');
    // May 2027 has five Sundays: "last" is the fifth, not the fourth.
    expect(nthWeekdayOfMonth(2027, 5, SUNDAY, 'last')).toBe('2027-05-30');
    // A month that starts on the weekday itself.
    expect(nthWeekdayOfMonth(2027, 8, SUNDAY, 'first')).toBe('2027-08-01');
    // Leap February: 29 Feb 2028 is a Tuesday.
    expect(nthWeekdayOfMonth(2028, 2, 2, 'last')).toBe('2028-02-29');
    expect(nthWeekdayOfMonth(2028, 2, SUNDAY, 'last')).toBe('2028-02-27');
  });

  it('names a date by its weekday and place in the month', () => {
    expect(weekdayOf('2027-05-09')).toBe(SUNDAY);
    expect(ordinalOf('2027-05-09')).toBe('second');
    expect(ordinalOf('2027-05-28')).toBe('fourth');
    expect(ordinalOf('2027-05-30')).toBe('last');
    expect(isLastWeekdayOfMonth('2027-05-30')).toBe(true);
    expect(isLastWeekdayOfMonth('2027-05-23')).toBe(false);
    // The fourth Sunday of a four-Sunday month is also its last one.
    expect(isLastWeekdayOfMonth('2027-02-28')).toBe(true);
  });

  it('skips or clamps a day of month that a shorter month lacks', () => {
    expect(monthlyDayDate(2027, 4, 31, 'skip')).toBeNull();
    expect(monthlyDayDate(2027, 4, 31, 'clamp')).toBe('2027-04-30');
    expect(monthlyDayDate(2027, 2, 29, 'skip')).toBeNull();
    expect(monthlyDayDate(2028, 2, 29, 'skip')).toBe('2028-02-29');
    expect(monthlyDayDate(2027, 2, 30, 'clamp')).toBe('2027-02-28');
    expect(monthlyDayDate(2028, 2, 31, 'clamp')).toBe('2028-02-29');
    expect(monthlyDayDate(2027, 1, 15, 'skip')).toBe('2027-01-15');
  });
});

describe('recurrence dates', () => {
  it('repeats every N weeks from the first date, by civil days', () => {
    expect(dates('2027-10-24', weekly(1), '2027-11-14')).toEqual(['2027-10-24', '2027-10-31', '2027-11-07', '2027-11-14']);
    expect(dates('2027-01-03', weekly(8), '2027-07-01')).toEqual(['2027-01-03', '2027-02-28', '2027-04-25', '2027-06-20']);
  });

  it('starts a monthly rule at its first match on or after the first date', () => {
    const second: PlanSeriesRecurrence = { frequency: 'monthly_weekday', ordinal: 'second', weekday: SUNDAY };
    expect(dates('2027-05-10', second, '2027-08-31')).toEqual(['2027-06-13', '2027-07-11', '2027-08-08']);
    expect(dates('2027-05-09', second, '2027-06-30')).toEqual(['2027-05-09', '2027-06-13']);
  });

  it('follows the last weekday across month ends and years', () => {
    const last: PlanSeriesRecurrence = { frequency: 'monthly_weekday', ordinal: 'last', weekday: SUNDAY };
    expect(dates('2027-11-01', last, '2028-03-31')).toEqual(['2027-11-28', '2027-12-26', '2028-01-30', '2028-02-27', '2028-03-26']);
  });

  it('skips months without day 31, or clamps them when asked', () => {
    expect(dates('2027-01-01', { frequency: 'monthly_day', day_of_month: 31, short_month: 'skip' }, '2027-06-30'))
      .toEqual(['2027-01-31', '2027-03-31', '2027-05-31']);
    expect(dates('2027-01-01', { frequency: 'monthly_day', day_of_month: 31, short_month: 'clamp' }, '2027-06-30'))
      .toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31', '2027-06-30']);
  });

  it('keeps 29 February only in leap years', () => {
    const day29 = (short_month: 'skip' | 'clamp'): PlanSeriesRecurrence => ({ frequency: 'monthly_day', day_of_month: 29, short_month });
    expect(dates('2027-01-01', day29('skip'), '2028-03-31').filter((date) => date.slice(5, 7) === '02')).toEqual(['2028-02-29']);
    expect(dates('2027-01-01', day29('clamp'), '2028-03-31').filter((date) => date.slice(5, 7) === '02')).toEqual(['2027-02-28', '2028-02-29']);
  });

  it('never yields past the horizon, inclusive', () => {
    expect(dates('2027-10-24', weekly(1), '2027-10-30')).toEqual(['2027-10-24']);
    expect(dates('2027-10-24', weekly(1), '2027-10-31')).toEqual(['2027-10-24', '2027-10-31']);
    expect(dates('2027-10-24', weekly(1), '2027-10-23')).toEqual([]);
  });
});

describe('default recurrence', () => {
  it('follows the service type frequency', () => {
    expect(defaultRecurrence('weekly', '2027-05-09')).toEqual(weekly(1));
    expect(defaultRecurrence('biweekly', '2027-05-09')).toEqual(weekly(2));
    expect(defaultRecurrence('monthly', '2027-05-09')).toEqual({ frequency: 'monthly_weekday', ordinal: 'second', weekday: SUNDAY });
    // A fifth Sunday has no "fifth of every month"; it means the last one.
    expect(defaultRecurrence('monthly', '2027-05-30')).toEqual({ frequency: 'monthly_weekday', ordinal: 'last', weekday: SUNDAY });
    expect(defaultRecurrence('occasionally', '2027-05-09')).toEqual(weekly(1));
    expect(defaultRecurrence(null, '2027-05-09')).toEqual(weekly(1));
  });

  it('seeds a newly chosen frequency from the first date', () => {
    expect(recurrenceForFrequency('weekly', '2027-05-30')).toEqual(weekly(1));
    expect(recurrenceForFrequency('monthly_weekday', '2027-05-30')).toEqual({ frequency: 'monthly_weekday', ordinal: 'last', weekday: SUNDAY });
    expect(recurrenceForFrequency('monthly_day', '2027-05-09')).toEqual({ frequency: 'monthly_day', day_of_month: 9, short_month: 'skip' });
  });

  it('reads an older weekly request', () => {
    expect(seriesRecurrence({ interval_weeks: 3 })).toEqual(weekly(3));
    const monthly: PlanSeriesRecurrence = { frequency: 'monthly_day', day_of_month: 5, short_month: 'skip' };
    expect(seriesRecurrence({ interval_weeks: 1, recurrence: monthly })).toBe(monthly);
  });
});

describe('series expansion', () => {
  const base: PlanSeriesExpansionInput = {
    start_date: '2027-01-03',
    recurrence: weekly(1),
    count: 4,
    excluded_dates: [],
    edits: [],
    default_title: 'Sunday',
  };
  const localDates = (input: Partial<PlanSeriesExpansionInput>): string[] =>
    expandPlanSeries({ ...base, ...input }).dates.map((date) => date.local_date);

  it('creates a full year of weekly plans at the cap without a problem', () => {
    const result = expandPlanSeries({ ...base, count: MAX_GENERATED_PLANS });
    expect(MAX_GENERATED_PLANS).toBe(52);
    expect(result.dates).toHaveLength(52);
    expect(result.dates.at(-1)!.local_date).toBe('2027-12-26');
    expect(result.problems).toEqual([]);
    // A count above the cap never produces more than the cap.
    expect(expandPlanSeries({ ...base, count: 500 }).dates).toHaveLength(52);
  });

  it('includes the until date itself and nothing after it', () => {
    expect(localDates({ count: MAX_GENERATED_PLANS, end_date: '2027-01-24' })).toEqual(['2027-01-03', '2027-01-10', '2027-01-17', '2027-01-24']);
    expect(localDates({ count: MAX_GENERATED_PLANS, end_date: '2027-01-23' })).toEqual(['2027-01-03', '2027-01-10', '2027-01-17']);
    expect(localDates({ count: MAX_GENERATED_PLANS, end_date: '2027-01-03' })).toEqual(['2027-01-03']);
  });

  it('says when an until date needs more plans than the cap', () => {
    const result = expandPlanSeries({ ...base, count: MAX_GENERATED_PLANS, end_date: '2028-06-30' });
    expect(result.dates).toHaveLength(52);
    expect(result.problems).toEqual([
      expect.objectContaining({ problem: { code: 'too_many_dates', max: 52, local_date: '2028-01-02', end_date: '2028-06-30' } }),
    ]);
    // Exactly 52 dates up to the until date is fine.
    expect(expandPlanSeries({ ...base, count: MAX_GENERATED_PLANS, end_date: '2027-12-26' }).problems).toEqual([]);
    // An older request with a smaller count simply stops at its count.
    expect(expandPlanSeries({ ...base, count: 4, end_date: '2028-06-30' }).problems).toEqual([]);
  });

  it('bounds the series to two years from the first date', () => {
    const monthly: PlanSeriesRecurrence = { frequency: 'monthly_weekday', ordinal: 'first', weekday: SUNDAY };
    const fits = expandPlanSeries({ ...base, recurrence: monthly, count: 24 });
    expect(fits.problems).toEqual([]);
    expect(fits.dates.at(-1)!.local_date).toBe('2028-12-03');
    const tooLong = expandPlanSeries({ ...base, recurrence: monthly, count: 30 });
    expect(tooLong.problems.map((problem) => problem.problem?.code)).toEqual(['series_too_long']);
    expect(tooLong.problems[0]!.problem).toEqual({ code: 'series_too_long', latest_date: seriesHorizon('2027-01-03') });
    expect(expandPlanSeries({ ...base, recurrence: weekly(8), count: 52 }).problems[0]!.problem?.code).toBe('series_too_long');
  });

  it('keeps holidays and skips out of the count with a monthly rule', () => {
    const result = expandPlanSeries({
      ...base,
      recurrence: { frequency: 'monthly_weekday', ordinal: 'second', weekday: SUNDAY },
      excluded_dates: ['2027-02-14'],
      edits: [{ local_date: '2027-03-14', skip: true }],
      count: 3,
    });
    expect(result.dates.map((date) => date.local_date)).toEqual(['2027-01-10', '2027-04-11', '2027-05-09']);
    expect(result.excluded).toEqual([
      { local_date: '2027-02-14', reason: 'excluded' },
      { local_date: '2027-03-14', reason: 'skipped' },
    ]);
  });

  it('keeps moves and renames, returns dates in order, and flags a move out of range', () => {
    const moved = expandPlanSeries({
      ...base,
      edits: [{ local_date: '2027-01-03', skip: false, move_to: '2027-01-12', title: 'Moved' }],
    });
    expect(moved.dates.map((date) => [date.series_date, date.local_date])).toEqual([
      ['2027-01-10', '2027-01-10'],
      ['2027-01-03', '2027-01-12'],
      ['2027-01-17', '2027-01-17'],
      ['2027-01-24', '2027-01-24'],
    ]);
    expect(moved.dates[1]!.title).toBe('Moved');
    expect(moved.problems).toEqual([]);

    const far = expandPlanSeries({ ...base, edits: [{ local_date: '2027-01-10', skip: false, move_to: '2029-06-01' }] });
    expect(far.problems.map((problem) => problem.problem)).toEqual([
      { code: 'move_out_of_range', series_date: '2027-01-10', local_date: '2029-06-01' },
    ]);
  });

  it('keeps each wall-clock time across DST in America/Los_Angeles', () => {
    // The 2nd Sunday of March 2027 is the spring-forward day itself.
    const result = expandPlanSeries({
      ...base,
      start_date: '2027-02-01',
      recurrence: { frequency: 'monthly_weekday', ordinal: 'second', weekday: SUNDAY },
      count: 10,
    });
    expect(result.dates.map((date) => date.local_date)).toEqual([
      '2027-02-14', '2027-03-14', '2027-04-11', '2027-05-09', '2027-06-13',
      '2027-07-11', '2027-08-08', '2027-09-12', '2027-10-10', '2027-11-14',
    ]);
    const service: PlanTemplateTime[] = [{ kind: 'service', name: null, day_offset: 0, local_start: '10:00', duration_minutes: 90 }];
    const instants = result.dates.map((date) => {
      const resolved = resolveTemplateTimes(service, date.local_date, 'America/Los_Angeles', 'earlier');
      if (!resolved.ok) throw new Error(resolved.message);
      return resolved.service_date;
    });
    expect(instants[0]).toBe('2027-02-14T18:00:00.000Z'); // PST, UTC−8
    expect(instants[1]).toBe('2027-03-14T17:00:00.000Z'); // PDT from 02:00 that morning
    expect(instants[9]).toBe('2027-11-14T18:00:00.000Z'); // back to PST after 7 Nov
    // A time inside the spring-forward gap is reported, not shifted.
    const early: PlanTemplateTime[] = [{ kind: 'service', name: null, day_offset: 0, local_start: '02:30', duration_minutes: 30 }];
    expect(resolveTemplateTimes(early, '2027-03-14', 'America/Los_Angeles', 'earlier').ok).toBe(false);
    // The fall-back Sunday is the 1st Sunday of November: 01:30 happens twice.
    const late: PlanTemplateTime[] = [{ kind: 'service', name: null, day_offset: 0, local_start: '01:30', duration_minutes: 30 }];
    const first = resolveTemplateTimes(late, nthWeekdayOfMonth(2027, 11, SUNDAY, 'first'), 'America/Los_Angeles', 'earlier');
    const second = resolveTemplateTimes(late, '2027-11-07', 'America/Los_Angeles', 'later');
    if (!first.ok || !second.ok) throw new Error('expected both sides of the fold');
    expect(new Date(second.service_date).getTime() - new Date(first.service_date).getTime()).toBe(3_600_000);
  });
});

describe('series request validation', () => {
  const revision_id = '00000000-0000-4000-8000-000000000001';
  const parse = (extra: Record<string, unknown>) => planSeriesSchema.safeParse({ revision_id, start_date: '2027-01-03', ...extra });

  it('enforces the cap and the rule bounds', () => {
    expect(parse({ count: 52 }).success).toBe(true);
    expect(parse({ count: 53 }).success).toBe(false);
    expect(parse({ recurrence: weekly(8) }).success).toBe(true);
    expect(parse({ recurrence: weekly(9) }).success).toBe(false);
    expect(parse({ recurrence: { frequency: 'monthly_weekday', ordinal: 'fifth', weekday: 0 } }).success).toBe(false);
    expect(parse({ recurrence: { frequency: 'monthly_day', day_of_month: 32 } }).success).toBe(false);
    const parsed = parse({ recurrence: { frequency: 'monthly_day', day_of_month: 31 } });
    expect(parsed.success && parsed.data.recurrence).toEqual({ frequency: 'monthly_day', day_of_month: 31, short_month: 'skip' });
  });

  it('refuses impossible dates and an end beyond two years', () => {
    expect(parse({ start_date: '2027-02-30' }).success).toBe(false);
    expect(parse({ start_date: '2027-02-29' }).success).toBe(false);
    expect(parse({ start_date: '2028-02-29' }).success).toBe(true);
    expect(parse({ end_date: '2029-01-03' }).success).toBe(true);
    expect(parse({ end_date: '2029-01-05' }).success).toBe(false);
    expect(parse({ end_date: '2027-01-02' }).success).toBe(false);
    expect(parse({ edits: [{ local_date: '2027-01-03', move_to: '2027-13-01' }] }).success).toBe(false);
  });
});

describe('recurrence in words', () => {
  const contextFor = (locale: SupportedLocale): StructuredTextContext => {
    const instance = createI18n({ locale });
    return { locale, translate: (message) => translateMessage(instance, message) };
  };
  const en = contextFor('en');
  const vi = contextFor('vi');
  const second: PlanSeriesRecurrence = { frequency: 'monthly_weekday', ordinal: 'second', weekday: SUNDAY };

  it('says the rule and its end in English', () => {
    expect(planSeriesSummaryText(second, '2027-05-09', { kind: 'count', count: 10 }, en)).toBe('Monthly on the 2nd Sunday, 10 plans');
    expect(planRecurrenceText({ frequency: 'monthly_weekday', ordinal: 'last', weekday: SUNDAY }, '2027-05-09', en)).toBe('Monthly on the last Sunday');
    expect(planRecurrenceText(weekly(1), '2027-05-09', en)).toBe('Every Sunday');
    expect(planRecurrenceText(weekly(2), '2027-05-09', en)).toBe('Every 2 weeks on Sunday');
    expect(planRecurrenceText({ frequency: 'monthly_day', day_of_month: 15, short_month: 'skip' }, '2027-05-09', en)).toBe('Monthly on day 15');
    expect(planRecurrenceText({ frequency: 'monthly_day', day_of_month: 31, short_month: 'skip' }, '2027-05-09', en))
      .toBe('Monthly on day 31, skipping months without it');
    expect(planRecurrenceText({ frequency: 'monthly_day', day_of_month: 31, short_month: 'clamp' }, '2027-05-09', en))
      .toBe('Monthly on day 31, or the last day of shorter months');
    expect(planSeriesSummaryText(weekly(1), '2027-05-09', { kind: 'count', count: 1 }, en)).toBe('Every Sunday, 1 plan');
    expect(planSeriesSummaryText(weekly(1), '2027-05-09', { kind: 'until', until_date: '2027-12-26' }, en)).toMatch(/^Every Sunday, until .*2027/);
  });

  it('says it in Vietnamese', () => {
    expect(planSeriesSummaryText(second, '2027-05-09', { kind: 'count', count: 10 }, vi)).toBe('Hằng tháng vào Chủ Nhật thứ hai, 10 chương trình');
    expect(planRecurrenceText({ frequency: 'monthly_weekday', ordinal: 'last', weekday: SUNDAY }, '2027-05-09', vi)).toBe('Hằng tháng vào Chủ Nhật cuối cùng');
    expect(planRecurrenceText(weekly(2), '2027-05-09', vi)).toBe('2 tuần một lần vào Chủ Nhật');
  });
});
