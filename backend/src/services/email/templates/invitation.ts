import type { PersonInvitationNotification } from '../../notifications.js';
import type { EmailContent } from './schedule.js';

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);

export const invitationEmail = (notification: PersonInvitationNotification): EmailContent => ({
  subject: `Join ${notification.organizationName}`,
  html: `<p>Hi ${escapeHtml(notification.personName)},</p><p>You have been invited to join ${escapeHtml(notification.organizationName)}.</p><p><a href="${escapeHtml(notification.acceptUrl)}">Join the organization</a></p>`,
  text: `Hi ${notification.personName},\n\nYou have been invited to join ${notification.organizationName}.\n\nJoin the organization: ${notification.acceptUrl}`,
});
