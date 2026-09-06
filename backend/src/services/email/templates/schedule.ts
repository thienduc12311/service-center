import type { ScheduleNotification } from '../../notifications.js';

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);

export const scheduleEmail = (notification: ScheduleNotification): EmailContent => {
  const roles = notification.assignments ?? [{ teamName: notification.teamName, positionName: notification.positionName }];
  const roleText = roles.map((role) => `${role.teamName ?? 'Team'}${role.positionName ? ` — ${role.positionName}` : ''}`).join(', ');
  const subject = `Assignment for ${notification.planTitle}`;
  const text = [
    `You are scheduled for ${notification.planTitle} on ${notification.serviceDate}.`,
    `Your assignments: ${roleText}.`,
    `Confirm or decline: ${notification.respondUrl}`,
  ].join('\n\n');
  const html = `<p>You are scheduled for <strong>${escapeHtml(notification.planTitle)}</strong> on ${escapeHtml(notification.serviceDate)}.</p><p>Your assignments: ${escapeHtml(roleText)}.</p><p><a href="${escapeHtml(notification.respondUrl)}">Confirm or decline this assignment</a></p>`;
  return { subject, html, text };
};
