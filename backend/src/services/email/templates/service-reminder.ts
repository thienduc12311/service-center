import type { ServiceReminderNotification } from '../../notifications.js';
import { escapeHtml, recipientLanguage } from '../../../lib/i18n.js';
import { roleText, type EmailContent } from './schedule.js';

/** F08: a confirmed person's "coming up" reminder. No response link. */
export const serviceReminderEmail = (notification: ServiceReminderNotification): EmailContent => {
  const language = recipientLanguage(notification.locale);
  const { t } = language;
  const when = notification.firstTimeLabel ?? language.date(notification.serviceDate);
  const lines = [
    notification.personName
      ? t('email.serviceReminder.lead', { name: notification.personName, plan: notification.planTitle })
      : t('email.serviceReminder.leadAnonymous', { plan: notification.planTitle }),
    t('email.serviceReminder.firstTime', { when }),
    notification.assignments.length ? t('email.yourAssignments', { roles: roleText(notification.assignments, language) }) : null,
    notification.location ? t('email.serviceReminder.location', { location: notification.location }) : null,
  ].filter((line): line is string => line !== null);
  return {
    subject: t('email.serviceReminder.subject', { plan: notification.planTitle }),
    text: [...lines, t('email.serviceReminder.detailsText', { url: notification.planUrl })].join('\n\n'),
    html: [
      ...lines.map((line) => `<p>${escapeHtml(line)}</p>`),
      `<p><a href="${escapeHtml(notification.planUrl)}">${escapeHtml(t('email.serviceReminder.detailsLink'))}</a></p>`,
    ].join(''),
  };
};
