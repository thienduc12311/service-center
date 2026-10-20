import type { OperationalMessageNotification } from '../../notifications.js';
import { escapeHtml, recipientLanguage } from '../../../lib/i18n.js';
import type { EmailContent } from './schedule.js';

/**
 * F09 targeted message. Subject and body are the sender's text with
 * allowlisted variables already substituted as plain text — user-authored,
 * so never translated; only the application's link and footer are. Everything
 * is escaped here, so neither the sender nor a variable value can inject markup.
 */
export const operationalMessageEmail = (notification: OperationalMessageNotification): EmailContent => {
  const { t } = recipientLanguage(notification.locale);
  const paragraphs = notification.body.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const footer = t('email.operational.footer', {
    sender: notification.senderName ?? t('email.operational.aLeader'),
    organization: notification.organizationName,
  });
  const text = [...paragraphs, t('email.operational.viewText', { url: notification.messageUrl }), footer].join('\n\n');
  const html = [
    ...paragraphs.map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`),
    `<p><a href="${escapeHtml(notification.messageUrl)}">${escapeHtml(t('email.operational.viewLink'))}</a></p>`,
    `<p style="color:#64748b;font-size:12px">${escapeHtml(footer)}</p>`,
  ].join('');
  // A header line: never let a newline from the sender's text through.
  return { subject: notification.subject.replace(/\s+/g, ' ').trim(), html, text };
};
