/**
 * Words a plan-generation recurrence in the viewer's language, e.g. "Every
 * 2nd Sunday, 10 plans". Shared by web and mobile so both say the same.
 */
import type { PlanSeriesRecurrence } from '../schemas/plan-templates.js';
import { weekdayOf } from '../lib/plan-recurrence.js';
import { formatCalendarDate, weekdayNames } from './format.js';
import type { StructuredTextContext } from './structured-text.js';

/** How a series ends, as chosen in the form or as reviewed. */
export type PlanSeriesEnd = { kind: 'count'; count: number } | { kind: 'until'; until_date: string };

const weekdayName = (context: StructuredTextContext, weekday: number): string =>
  weekdayNames(context.locale, 'long')[weekday] ?? '';

/** The rule alone: "Every Sunday", "Every 2 weeks on Sunday", "Every last Sunday", "Monthly on day 31, …". */
export const planRecurrenceText = (rule: PlanSeriesRecurrence, startDate: string, context: StructuredTextContext): string => {
  switch (rule.frequency) {
    case 'weekly':
      return context.translate({
        key: 'templates:recurrence.weekly',
        values: { count: rule.interval_weeks, weekday: weekdayName(context, weekdayOf(startDate)) },
      });
    case 'monthly_weekday':
      return context.translate({
        key: 'templates:recurrence.monthlyWeekday',
        values: {
          ordinal: context.translate({ key: `templates:recurrence.ordinal.${rule.ordinal}` }),
          weekday: weekdayName(context, rule.weekday),
        },
      });
    case 'monthly_day':
      return context.translate({
        key: rule.day_of_month <= 28
          ? 'templates:recurrence.monthlyDay'
          : rule.short_month === 'clamp' ? 'templates:recurrence.monthlyDayClamp' : 'templates:recurrence.monthlyDaySkip',
        values: { day: rule.day_of_month },
      });
  }
};

/** How it ends: "10 plans" or "until 31 Dec 2027". */
export const planSeriesEndText = (end: PlanSeriesEnd, context: StructuredTextContext): string =>
  end.kind === 'count'
    ? context.translate({ key: 'templates:recurrence.plans', values: { count: end.count } })
    : context.translate({ key: 'templates:recurrence.until', values: { date: formatCalendarDate(end.until_date, context.locale, 'medium') } });

/** The whole series in words: "Every 2nd Sunday, 10 plans". */
export const planSeriesSummaryText = (
  rule: PlanSeriesRecurrence,
  startDate: string,
  end: PlanSeriesEnd,
  context: StructuredTextContext,
): string =>
  context.translate({
    key: 'templates:recurrence.summary',
    values: { rule: planRecurrenceText(rule, startDate, context), end: planSeriesEndText(end, context) },
  });
