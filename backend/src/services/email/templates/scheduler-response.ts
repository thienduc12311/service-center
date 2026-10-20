import type { SchedulerResponseNotification } from '../../notifications.js';
import { escapeHtml, recipientLanguage } from '../../../lib/i18n.js';
import type { EmailContent } from './schedule.js';

/** Tells a response owner that someone declined or withdrew. No decline reason is included. */
export const schedulerResponseEmail = (notification: SchedulerResponseNotification): EmailContent => {
  const language = recipientLanguage(notification.locale);
  const { t } = language;
  const withdrawn = notification.transition === 'withdrawal';
  const values = { name: notification.responderName, plan: notification.planTitle, date: language.date(notification.serviceDate) };
  const lead = withdrawn ? t('email.response.withdrawnLead', values) : t('email.response.declinedLead', values);
  return {
    subject: withdrawn ? t('email.response.withdrawnSubject', values) : t('email.response.declinedSubject', values),
    text: [lead, t('email.response.openText', { url: notification.planUrl })].join('\n\n'),
    html: `<p>${escapeHtml(lead)}</p><p><a href="${escapeHtml(notification.planUrl)}">${escapeHtml(t('email.response.openLink'))}</a></p>`,
  };
};
