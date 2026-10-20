import type { PersonInvitationNotification } from '../../notifications.js';
import { escapeHtml, recipientLanguage } from '../../../lib/i18n.js';
import type { EmailContent } from './schedule.js';

/** Sent in the invited Person's saved language (set by a manager before they have a login). */
export const invitationEmail = (notification: PersonInvitationNotification): EmailContent => {
  const { t } = recipientLanguage(notification.locale);
  const organization = notification.organizationName;
  const greeting = t('email.greeting', { name: notification.personName });
  const lead = t('email.invitation.lead', { organization });
  return {
    subject: t('email.invitation.subject', { organization }),
    html: `<p>${escapeHtml(greeting)}</p><p>${escapeHtml(lead)}</p><p><a href="${escapeHtml(notification.acceptUrl)}">${escapeHtml(t('email.invitation.link'))}</a></p>`,
    text: [greeting, lead, t('email.invitation.linkText', { url: notification.acceptUrl })].join('\n\n'),
  };
};
