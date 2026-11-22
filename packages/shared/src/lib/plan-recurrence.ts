/**
 * Flexible recurrence for generating plans from a template: which local
 * calendar dates a series produces. Pure calendar arithmetic on
 * `YYYY-MM-DD` strings in the organization's timezone — never instants, so a
 * DST change can't move a date. Wall-clock times are resolved per date
 * afterwards (`resolveTemplateTimes`), where DST gaps and folds are explicit.
 *
 * Web, mobile and the API all expand a series with this module; the API
 * recomputes it rather than trusting client dates, and the database
 * re-checks the cap, order and range.
 */
import type { PlanRecurrence } from '../types/database.js';
import type { PlanSeriesRecurrence, RecurrenceOrdinal } from '../schemas/plan-templates.js';
import { addLocalDays, formatLocalDate, localDaysBetween, parseLocalDate } from './timezone.js';

/**
 * Most plans one generation batch may create. One batch is one database
 * transaction under the signed-in 8 s statement timeout. Measured locally
 * (Postgres 17, a template with 25 items, 10 needs over 3 teams, a 9-person
 * roster and 2 times): `generate_plans_from_template` takes ~1.04 s for 52
 * plans (preview ~0.46 s), ~0.53 s for 26 and ~2.15 s for 104, growing
 * linearly (~20 ms per plan). 52 — a year of weekly services — keeps the
 * commit near 1 s. Keep in step with `private.plan_generation_preview`.
 */
export const MAX_GENERATED_PLANS = 52;

/**
 * The furthest a batch may reach: every plan date lies within this many
 * days of the first date (two years). Bounds monthly and every-8-weeks
 * series, whose cap alone would reach years ahead. Keep in step with
 * `private.plan_generation_preview`.
 */
export const MAX_SERIES_SPAN_DAYS = 731;

/** Holidays to leave out and per-date edits a request may carry. */
export const MAX_SERIES_EXCLUSIONS = 104;
export const MAX_SERIES_EDITS = 104;

export const RECURRENCE_ORDINALS: readonly RecurrenceOrdinal[] = ['first', 'second', 'third', 'fourth', 'last'];
const ORDINAL_INDEX: Record<Exclude<RecurrenceOrdinal, 'last'>, number> = { first: 1, second: 2, third: 3, fourth: 4 };

/** Days in a month (`month` 1–12); handles leap years. */
export const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

const partsOf = (date: string) => {
  const parts = parseLocalDate(date);
  if (!parts) throw new RangeError(`Not a calendar date: ${date}`);
  return parts;
};

/** 0 = Sunday … 6 = Saturday, for a local calendar date. */
export const weekdayOf = (date: string): number => {
  const { year, month, day } = partsOf(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};

/**
 * Which occurrence of its weekday a date is in its month: the 1st–4th, or
 * `last` for a fifth one (there is never a fifth of every month).
 */
export const ordinalOf = (date: string): RecurrenceOrdinal => {
  const index = Math.ceil(partsOf(date).day / 7);
  return index >= 5 ? 'last' : RECURRENCE_ORDINALS[index - 1]!;
};

/** Whether a date is the last of its weekday in its month (e.g. the last Sunday). */
export const isLastWeekdayOfMonth = (date: string): boolean => {
  const { year, month, day } = partsOf(date);
  return day + 7 > daysInMonth(year, month);
};

/** The Nth (or last) given weekday of a month, e.g. the 2nd Sunday of 2027-05. */
export const nthWeekdayOfMonth = (year: number, month: number, weekday: number, ordinal: RecurrenceOrdinal): string => {
  if (ordinal === 'last') {
    const last = daysInMonth(year, month);
    const lastWeekday = new Date(Date.UTC(year, month - 1, last)).getUTCDay();
    return formatLocalDate({ year, month, day: last - ((lastWeekday - weekday + 7) % 7) });
  }
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const first = 1 + ((weekday - firstWeekday + 7) % 7);
  return formatLocalDate({ year, month, day: first + (ORDINAL_INDEX[ordinal] - 1) * 7 });
};

/**
 * A day of a month. Day 29–31 in a shorter month is either left out
 * (`skip`, the default — nothing is invented) or moved to the month's last
 * day (`clamp`, e.g. "the 31st" becomes 30 April and 28/29 February).
 */
export const monthlyDayDate = (year: number, month: number, day: number, shortMonth: 'skip' | 'clamp'): string | null => {
  const last = daysInMonth(year, month);
  if (day <= last) return formatLocalDate({ year, month, day });
  return shortMonth === 'clamp' ? formatLocalDate({ year, month, day: last }) : null;
};

const monthAfter = (year: number, month: number, steps: number): { year: number; month: number } => {
  const index = year * 12 + (month - 1) + steps;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
};

/**
 * Candidate series dates in ascending order, starting on or after
 * `startDate` and never past `horizon` (inclusive). Weekly series start on
 * `startDate` itself; monthly series start at their first matching date on
 * or after it.
 */
export function* recurrenceDates(startDate: string, rule: PlanSeriesRecurrence, horizon: string): Generator<string> {
  const start = partsOf(startDate);
  if (rule.frequency === 'weekly') {
    for (let step = 0; ; step += 1) {
      const date = addLocalDays(startDate, step * rule.interval_weeks * 7);
      if (date > horizon) return;
      yield date;
    }
  }
  for (let step = 0; ; step += 1) {
    const { year, month } = monthAfter(start.year, start.month, step);
    if (formatLocalDate({ year, month, day: 1 }) > horizon) return;
    const date = rule.frequency === 'monthly_weekday'
      ? nthWeekdayOfMonth(year, month, rule.weekday, rule.ordinal)
      : monthlyDayDate(year, month, rule.day_of_month, rule.short_month);
    if (date === null || date < startDate) continue;
    if (date > horizon) return;
    yield date;
  }
}

/** The last date a series starting on `startDate` may reach. */
export const seriesHorizon = (startDate: string): string => addLocalDays(startDate, MAX_SERIES_SPAN_DAYS);

/**
 * The rule a new series starts with: the service type's frequency, matched
 * to the first date. Monthly picks that date's weekday and its place in the
 * month ("2nd Sunday"; a fifth one is "last"). Occasional or unknown
 * frequencies start weekly.
 */
export const defaultRecurrence = (frequency: PlanRecurrence | null | undefined, startDate: string): PlanSeriesRecurrence => {
  switch (frequency) {
    case 'biweekly':
      return { frequency: 'weekly', interval_weeks: 2 };
    case 'monthly':
      return { frequency: 'monthly_weekday', ordinal: ordinalOf(startDate), weekday: weekdayOf(startDate) };
    default:
      return { frequency: 'weekly', interval_weeks: 1 };
  }
};

/** The rule a request means: its `recurrence`, or the older weekly `interval_weeks` field. */
export const seriesRecurrence = (input: { recurrence?: PlanSeriesRecurrence | undefined; interval_weeks: number }): PlanSeriesRecurrence =>
  input.recurrence ?? { frequency: 'weekly', interval_weeks: input.interval_weeks };

/** Days between the earliest and latest of some local dates (0 for none). */
export const seriesSpanDays = (dates: readonly string[]): number => {
  if (dates.length < 2) return 0;
  const sorted = [...dates].sort();
  return localDaysBetween(sorted[0]!, sorted.at(-1)!);
};
