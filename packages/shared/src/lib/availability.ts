import type {
  AvailabilityFreshness,
  PreferenceWarningCode,
  SchedulingFrequency,
} from '../types/availability.js';

/** After this long without a review, availability counts as stale. */
export const AVAILABILITY_STALE_AFTER_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How far a leader can rely on a person's availability. A review older than
 * 90 days — or older than the request being answered — is stale; no review at
 * all is unknown. Distinct from a blockout, which is an explicit "no".
 */
export const availabilityFreshness = (
  reviewedAt: string | null | undefined,
  options: { now?: Date; requestedAt?: string | null } = {},
): AvailabilityFreshness => {
  if (!reviewedAt) return 'unknown';
  const reviewed = new Date(reviewedAt).getTime();
  const now = (options.now ?? new Date()).getTime();
  if (options.requestedAt && reviewed < new Date(options.requestedAt).getTime()) return 'stale';
  return now - reviewed > AVAILABILITY_STALE_AFTER_DAYS * DAY_MS ? 'stale' : 'current';
};

export const AVAILABILITY_FRESHNESS_LABELS: Record<AvailabilityFreshness, string> = {
  unknown: 'Never reviewed',
  stale: 'Needs review',
  current: 'Up to date',
};

export const SCHEDULING_FREQUENCY_LABELS: Record<SchedulingFrequency, string> = {
  every_week: 'At most once a week',
  every_other_week: 'Every other week',
  every_third_week: 'Every third week',
  once_a_month: 'Once a month',
};

export const PREFERENCE_WARNING_LABELS: Record<PreferenceWarningCode, string> = {
  frequency: 'Serving more often than preferred',
  monthly_max: 'Monthly maximum reached',
  avoided_date: 'Avoided date',
  avoided_week: 'Avoided week',
  outside_preferred_weeks: 'Outside preferred weeks',
  outside_preferred_dates: 'Outside preferred dates',
  time_not_preferred: 'Not a preferred time',
  availability_unknown: 'Availability never reviewed',
  availability_stale: 'Availability needs review',
  busy_elsewhere: 'Busy in another organization',
};

/** Freshness codes describe missing information, not a stated preference. */
export const isFreshnessWarning = (code: PreferenceWarningCode): boolean =>
  code === 'availability_unknown' || code === 'availability_stale';

/** Week of the month a local date falls in: days 1–7 are week 1, 29–31 week 5. */
export const weekOfMonth = (localDate: string): number => Math.floor((Number(localDate.slice(8, 10)) - 1) / 7) + 1;

/**
 * Formats a civil date (YYYY-MM-DD) without shifting it through the viewer's
 * timezone — a request "from Oct 17" reads Oct 17 everywhere.
 */
export const formatCivilDate = (value: string, locale = 'en-US'): string => {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, day)));
};
