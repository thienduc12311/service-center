/** Dates and counts as the admin app shows them (English, the viewer's time zone). */
const LOCALE = 'en-US';

const dateFormat = new Intl.DateTimeFormat(LOCALE, { year: 'numeric', month: 'short', day: 'numeric' });
const dateTimeFormat = new Intl.DateTimeFormat(LOCALE, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const numberFormat = new Intl.NumberFormat(LOCALE);
const relativeFormat = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });

export const formatDate = (iso: string): string => dateFormat.format(new Date(iso));

export const formatDateTime = (iso: string): string => dateTimeFormat.format(new Date(iso));

export const formatCount = (value: number): string => numberFormat.format(value);

interface RelativeUnit {
  unit: Intl.RelativeTimeFormatUnit;
  seconds: number;
}

const RELATIVE_UNITS: readonly RelativeUnit[] = [
  { unit: 'year', seconds: 365 * 24 * 3600 },
  { unit: 'month', seconds: 30 * 24 * 3600 },
  { unit: 'week', seconds: 7 * 24 * 3600 },
  { unit: 'day', seconds: 24 * 3600 },
  { unit: 'hour', seconds: 3600 },
  { unit: 'minute', seconds: 60 },
];

/** "3 days ago", "in 5 hours", "now". */
export const formatRelativeTime = (iso: string, now: number = Date.now()): string => {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  for (const { unit, seconds: size } of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) return relativeFormat.format(Math.trunc(seconds / size), unit);
  }
  return 'just now';
};

/** "1 account", "3 accounts". */
export const pluralize = (count: number, singular: string, plural: string = `${singular}s`): string =>
  `${formatCount(count)} ${count === 1 ? singular : plural}`;
