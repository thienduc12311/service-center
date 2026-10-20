import { useMemo } from 'react';
import {
  formatCalendarDate,
  formatInstantDate,
  formatInstantDateTime,
  formatInstantTime,
  formatList,
  formatNumber,
  formatPercent,
  monthNames,
  weekdayNames,
  type DateStyle,
  type InstantFormatOptions,
} from '@service-center/shared';
import { useLanguage } from './LanguageProvider';

/** Formatting helpers bound to the displayed language. */
export interface Formatters {
  /** A `YYYY-MM-DD` calendar date (service dates, blockout days), never shifted. */
  calendarDate: (value: string, style?: DateStyle) => string;
  /** The date of an instant, in `timeZone` (organization zone) or the viewer's. */
  date: (value: string | number | Date, style?: DateStyle, options?: InstantFormatOptions) => string;
  time: (value: string | number | Date, options?: InstantFormatOptions) => string;
  dateTime: (value: string | number | Date, options?: InstantFormatOptions & { dateStyle?: DateStyle }) => string;
  number: (value: number, options?: Intl.NumberFormatOptions) => string;
  percent: (fraction: number) => string;
  list: (items: readonly string[]) => string;
  weekdays: (width?: 'short' | 'narrow' | 'long') => string[];
  months: (width?: 'short' | 'long') => string[];
}

export const useFormatters = (): Formatters => {
  const { locale } = useLanguage();
  return useMemo<Formatters>(
    () => ({
      calendarDate: (value, style) => formatCalendarDate(value, locale, style),
      date: (value, style, options) => formatInstantDate(value, locale, style, options),
      time: (value, options) => formatInstantTime(value, locale, options),
      dateTime: (value, options) => formatInstantDateTime(value, locale, options),
      number: (value, options) => formatNumber(value, locale, options),
      percent: (fraction) => formatPercent(fraction, locale),
      list: (items) => formatList(items, locale),
      weekdays: (width) => weekdayNames(locale, width),
      months: (width) => monthNames(locale, width),
    }),
    [locale],
  );
};
