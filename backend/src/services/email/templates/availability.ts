import type { AvailabilityRequestNotification } from '../../notifications.js';
import { escapeHtml, recipientLanguage } from '../../../lib/i18n.js';
import type { EmailContent } from './schedule.js';

/** No other person's details, plans or reasons — just the ask and the link. */
export const availabilityRequestEmail = (notification: AvailabilityRequestNotification): EmailContent => {
  const language = recipientLanguage(notification.locale);
  const { t } = language;
  const organization = notification.organizationName;
  const lines = [
    t('email.availability.lead', { organization, start: language.date(notification.windowStart), end: language.date(notification.windowEnd) }),
    // The leader's own words, kept exactly as written.
    notification.message ? t('email.availability.message', { message: notification.message }) : null,
    notification.respondBy ? t('email.availability.respondBy', { date: language.date(notification.respondBy) }) : null,
  ].filter((line): line is string => Boolean(line));
  return {
    subject: t('email.availability.subject', { organization }),
    text: [...lines, t('email.availability.linkText', { url: notification.availabilityUrl })].join('\n\n'),
    html: [
      ...lines.map((line) => `<p>${escapeHtml(line)}</p>`),
      `<p><a href="${escapeHtml(notification.availabilityUrl)}">${escapeHtml(t('email.availability.link'))}</a></p>`,
    ].join(''),
  };
};
