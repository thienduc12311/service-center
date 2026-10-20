/**
 * Locale-aware presentation of dates, times and numbers.
 *
 * Language changes only how a value is *displayed*. Stored instants, the
 * organization timezone, recurrence and week-start rules, `<input type=date>`
 * values and machine exports (CSV, ICS) are untouched: callers keep passing
 * the same instants and zones they already use, plus a display locale.
 */

import { formatLocaleFor, isSupportedLocale, type SupportedLocale } from './locales.js';

/** A supported language or an explicit `Intl` locale tag. */
export type DisplayLocale = SupportedLocale | (string & {});

const intlLocale = (locale: DisplayLocale): string => (isSupportedLocale(locale) ? formatLocaleFor(locale) : locale);

/** Named presets so call sites never assemble `Intl` option bags ad hoc. */
export type DateStyle =
  /** "Sun, Oct 25" */
  | 'short'
  /** "Sunday, October 25, 2026" */
  | 'long'
  /** "Oct 25, 2026" */
  | 'medium'
  /** "October 2026" */
  | 'monthYear'
  /** "Sun" */
  | 'weekday'
  /** "Oct 25" */
  | 'dayMonth'
  /** "October 25, 2026" */
  | 'longDate';

const DATE_OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  short: { weekday: 'short', month: 'short', day: 'numeric' },
  long: { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' },
  medium: { month: 'short', day: 'numeric', year: 'numeric' },
  monthYear: { month: 'long', year: 'numeric' },
  weekday: { weekday: 'short' },
  dayMonth: { month: 'short', day: 'numeric' },
  longDate: { month: 'long', day: 'numeric', year: 'numeric' },
};

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Formats a calendar date (`YYYY-MM-DD`, e.g. `plans.service_date`) without
 * shifting it: the date is built in UTC and formatted in UTC, so a viewer
 * west of Greenwich never sees the previous day. Invalid input is returned
 * unchanged rather than rendered as "Invalid Date".
 */
export const formatCalendarDate = (value: string, locale: DisplayLocale, style: DateStyle = 'short'): string => {
  const match = DATE_ONLY.exec(value.slice(0, 10));
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(intlLocale(locale), { ...DATE_OPTIONS[style], timeZone: 'UTC' }).format(date);
};

/** Options for formatting an instant. Omit `timeZone` to use the viewer's zone. */
export interface InstantFormatOptions {
  timeZone?: string;
}

const toInstant = (value: string | number | Date): Date => (value instanceof Date ? new Date(value.getTime()) : new Date(value));

/** The date part of an instant in a zone (organization zone for schedules). */
export const formatInstantDate = (
  value: string | number | Date,
  locale: DisplayLocale,
  style: DateStyle = 'short',
  options: InstantFormatOptions = {},
): string => {
  const date = toInstant(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(intlLocale(locale), { ...DATE_OPTIONS[style], ...(options.timeZone ? { timeZone: options.timeZone } : {}) }).format(date);
};

/** "9:00 AM" / "09:00" in a zone. */
export const formatInstantTime = (value: string | number | Date, locale: DisplayLocale, options: InstantFormatOptions = {}): string => {
  const date = toInstant(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(intlLocale(locale), {
    hour: 'numeric',
    minute: '2-digit',
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  }).format(date);
};

/** "Sun, Oct 25 · 9:00 AM" in a zone. */
export const formatInstantDateTime = (
  value: string | number | Date,
  locale: DisplayLocale,
  options: InstantFormatOptions & { dateStyle?: DateStyle } = {},
): string => {
  const date = formatInstantDate(value, locale, options.dateStyle ?? 'short', options);
  const time = formatInstantTime(value, locale, options);
  return date && time ? `${date} · ${time}` : date || time;
};

export const formatNumber = (value: number, locale: DisplayLocale, options: Intl.NumberFormatOptions = {}): string =>
  new Intl.NumberFormat(intlLocale(locale), options).format(value);

export const formatPercent = (fraction: number, locale: DisplayLocale): string =>
  new Intl.NumberFormat(intlLocale(locale), { style: 'percent', maximumFractionDigits: 0 }).format(fraction);

/**
 * Short weekday names starting on Sunday — the week start stays the
 * application's scheduling rule, independent of language.
 */
export const weekdayNames = (locale: DisplayLocale, width: 'short' | 'narrow' | 'long' = 'short'): string[] => {
  const formatter = new Intl.DateTimeFormat(intlLocale(locale), { weekday: width, timeZone: 'UTC' });
  // 2026-01-04 is a Sunday.
  return Array.from({ length: 7 }, (_, index) => formatter.format(new Date(Date.UTC(2026, 0, 4 + index))));
};

/** Month names, January first. */
export const monthNames = (locale: DisplayLocale, width: 'short' | 'long' = 'long'): string[] => {
  const formatter = new Intl.DateTimeFormat(intlLocale(locale), { month: width, timeZone: 'UTC' });
  return Array.from({ length: 12 }, (_, index) => formatter.format(new Date(Date.UTC(2026, index, 1))));
};

/**
 * Joins already-translated items as a list. Uses `Intl.ListFormat` where the
 * runtime has it (Hermes may not) and a comma join otherwise.
 */
export const formatList = (items: readonly string[], locale: DisplayLocale): string => {
  const ListFormat = (Intl as typeof Intl & { ListFormat?: new (locale: string, options: { type: 'conjunction' }) => { format(list: readonly string[]): string } }).ListFormat;
  if (ListFormat) return new ListFormat(intlLocale(locale), { type: 'conjunction' }).format(items);
  return items.join(', ');
};
