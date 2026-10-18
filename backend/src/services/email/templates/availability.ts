import type { AvailabilityRequestNotification } from '../../notifications.js';
import type { EmailContent } from './schedule.js';

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);

/** No other person's details, plans or reasons — just the ask and the link. */
export const availabilityRequestEmail = (notification: AvailabilityRequestNotification): EmailContent => {
  const period = `${notification.windowStart} to ${notification.windowEnd}`;
  const subject = `${notification.organizationName}: please update your availability`;
  const lines = [
    `${notification.organizationName} is planning ${period}. Please add any dates you can't serve, or confirm that your availability is up to date.`,
    notification.message ? `Message: ${notification.message}` : null,
    notification.respondBy ? `Please respond by ${notification.respondBy}.` : null,
    `Update your availability: ${notification.availabilityUrl}`,
  ].filter((line): line is string => Boolean(line));
  const html = [
    `<p>${escapeHtml(notification.organizationName)} is planning ${escapeHtml(period)}. Please add any dates you can’t serve, or confirm that your availability is up to date.</p>`,
    notification.message ? `<p>${escapeHtml(notification.message)}</p>` : '',
    notification.respondBy ? `<p>Please respond by ${escapeHtml(notification.respondBy)}.</p>` : '',
    `<p><a href="${escapeHtml(notification.availabilityUrl)}">Update your availability</a></p>`,
  ].join('');
  return { subject, html, text: lines.join('\n\n') };
};
