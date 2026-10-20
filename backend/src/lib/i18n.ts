/**
 * Server-side translation. The language is always explicit — one recipient
 * (or one request) at a time — and never a process-wide setting, so
 * concurrent deliveries in different languages cannot affect each other.
 *
 * System-generated text resolves the recipient Person's saved preference,
 * then English; the sender's UI language is never used.
 */

import {
  formatCalendarDate,
  formatInstantDateTime,
  resolveRecipientLocale,
  translatorFor,
  type FixedTranslator,
  type SupportedLocale,
} from '@service-center/shared';

export type NotificationTranslator = FixedTranslator<'notifications'>;

/** Text and formatting bound to one recipient's language. */
export interface RecipientLanguage {
  locale: SupportedLocale;
  t: NotificationTranslator;
  /** A `YYYY-MM-DD` calendar date, never shifted by the server's zone. */
  date: (value: string) => string;
  /** An instant shown in the organization's zone. */
  dateTime: (instant: string, timeZone: string) => string;
}

export const recipientLanguage = (stored: string | null | undefined): RecipientLanguage => {
  const locale = resolveRecipientLocale(stored);
  return {
    locale,
    t: translatorFor(locale, 'notifications'),
    date: (value) => formatCalendarDate(value, locale, 'long'),
    dateTime: (instant, timeZone) => formatInstantDateTime(instant, locale, { timeZone }),
  };
};

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
