import { startOfMonth } from '@service-center/shared';

/** URL search parameters the calendar keeps, so a month and team can be linked and survive reloads. */
export const CALENDAR_MONTH_PARAM = 'month';
export const CALENDAR_TEAM_PARAM = 'team';

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** `YYYY-MM` → the first local day of that month; null for anything else. */
export const parseMonthParam = (value: string | null): Date | null => {
  const match = value ? MONTH.exec(value) : null;
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, 1) : null;
};

/** The local month of `value` as `YYYY-MM`. */
export const formatMonthParam = (value: Date): string => {
  const month = startOfMonth(value);
  return `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
};
