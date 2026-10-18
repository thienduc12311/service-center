import type { OperationalMessageNotification } from '../../notifications.js';
import { escapeHtml, type EmailContent } from './schedule.js';

/**
 * F09 targeted message. Subject and body are the sender's text with
 * allowlisted variables already substituted as plain text; everything is
 * escaped here, so neither the sender nor a variable value can inject markup.
 */
export const operationalMessageEmail = (notification: OperationalMessageNotification): EmailContent => {
  const paragraphs = notification.body.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const footer = `Sent by ${notification.senderName ?? 'a leader'} at ${notification.organizationName}. Reply to this email to reach them.`;
  const text = [...paragraphs, `View in Service Center: ${notification.messageUrl}`, footer].join('\n\n');
  const html = [
    ...paragraphs.map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`),
    `<p><a href="${escapeHtml(notification.messageUrl)}">View in Service Center</a></p>`,
    `<p style="color:#64748b;font-size:12px">${escapeHtml(footer)}</p>`,
  ].join('');
  // A header line: never let a newline from the sender's text through.
  return { subject: notification.subject.replace(/\s+/g, ' ').trim(), html, text };
};
