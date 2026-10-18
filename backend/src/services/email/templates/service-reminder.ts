import type { ServiceReminderNotification } from '../../notifications.js';
import { escapeHtml, roleText, type EmailContent } from './schedule.js';

/** F08: a confirmed person's "coming up" reminder. No response link. */
export const serviceReminderEmail = (notification: ServiceReminderNotification): EmailContent => {
  const when = notification.firstTimeLabel ?? notification.serviceDate;
  const subject = `Coming up: ${notification.planTitle}`;
  const lines = [
    `Hi${notification.personName ? ` ${notification.personName}` : ''}, this is a reminder that you are confirmed for ${notification.planTitle}.`,
    `First time you're needed: ${when}.`,
    notification.assignments.length ? `Your assignments: ${roleText(notification.assignments)}.` : null,
    notification.location ? `Location: ${notification.location}.` : null,
    `Details: ${notification.planUrl}`,
  ].filter((line): line is string => line !== null);
  const html = [
    `<p>Hi${notification.personName ? ` ${escapeHtml(notification.personName)}` : ''}, this is a reminder that you are confirmed for <strong>${escapeHtml(notification.planTitle)}</strong>.</p>`,
    `<p>First time you're needed: ${escapeHtml(when)}.</p>`,
    notification.assignments.length ? `<p>Your assignments: ${escapeHtml(roleText(notification.assignments))}.</p>` : '',
    notification.location ? `<p>Location: ${escapeHtml(notification.location)}.</p>` : '',
    `<p><a href="${escapeHtml(notification.planUrl)}">View details</a></p>`,
  ].join('');
  return { subject, html, text: lines.join('\n\n') };
};
