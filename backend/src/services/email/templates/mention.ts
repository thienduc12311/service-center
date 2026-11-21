import type { MentionEmailNotification } from '../../notifications.js';
import { escapeHtml, recipientLanguage } from '../../../lib/i18n.js';
import type { EmailContent } from './schedule.js';

/**
 * ADR-0007 mention email. The excerpt, the author's name and the place are
 * user-authored, so they are never translated and always escaped; only the
 * surrounding text is the recipient's language. The excerpt is quoted as
 * plain text with line breaks kept.
 */
export const mentionEmail = (notification: MentionEmailNotification): EmailContent => {
  const { t } = recipientLanguage(notification.locale);
  const values = { author: notification.authorName, place: notification.place };
  const greeting = notification.personName
    ? t('email.greeting', { name: notification.personName })
    : t('email.greetingAnonymous');
  const lead = t('email.mention.lead', values);
  const more = notification.moreCount > 0 ? t('email.mention.more', { count: notification.moreCount }) : null;
  const footer = t('email.mention.footer', { organization: notification.organizationName });
  const text = [
    greeting,
    lead,
    notification.excerpt.split('\n').map((line) => `> ${line}`).join('\n'),
    ...(more ? [more] : []),
    t('email.mention.openText', { url: notification.threadUrl }),
    footer,
  ].join('\n\n');
  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>${escapeHtml(lead)}</p>`,
    `<blockquote style="margin:0 0 16px;padding:8px 12px;border-left:3px solid #cbd5e1;color:#334155">${escapeHtml(notification.excerpt).replace(/\n/g, '<br>')}</blockquote>`,
    ...(more ? [`<p>${escapeHtml(more)}</p>`] : []),
    `<p><a href="${escapeHtml(notification.threadUrl)}">${escapeHtml(t('email.mention.openLink'))}</a></p>`,
    `<p style="color:#64748b;font-size:12px">${escapeHtml(footer)}</p>`,
  ].join('');
  // A header line: never let a newline from a name or title through.
  return { subject: t('email.mention.subject', values).replace(/\s+/g, ' ').trim(), html, text };
};
