import type { ScheduleNotification, ScheduleNotificationPlan, ScheduleNotificationRole } from '../../notifications.js';

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);

export const roleText = (roles: readonly ScheduleNotificationRole[]): string =>
  roles.map((role) => `${role.teamName ?? 'Team'}${role.positionName ? ` — ${role.positionName}` : ''}`).join(', ');

/**
 * F08: one message for several plans. Every plan has its own link, which
 * answers that plan's exact request only; nothing answers them all at once.
 */
const consolidatedEmail = (notification: ScheduleNotification, plans: readonly ScheduleNotificationPlan[]): EmailContent => {
  const intro = notification.reminder
    ? `Reminder: you have not yet answered ${plans.length} requests.`
    : `You have been scheduled for ${plans.length} services.`;
  const subject = notification.reminder
    ? `Reminder: ${plans.length} requests waiting for your answer`
    : `You're scheduled for ${plans.length} services`;
  const text = [
    intro,
    'Each service has its own link; answering one does not answer the others.',
    ...plans.map((plan) => [
      `${plan.planTitle} — ${plan.serviceDate}`,
      `Your assignments: ${roleText(plan.assignments)}.`,
      `Confirm or decline this service: ${plan.respondUrl}`,
    ].join('\n')),
  ].join('\n\n');
  const html = [
    `<p>${escapeHtml(intro)}</p>`,
    '<p>Each service has its own link; answering one does not answer the others.</p>',
    ...plans.map((plan) => `<div style="margin:16px 0;padding:12px;border:1px solid #e5e7eb;border-radius:8px">`
      + `<p><strong>${escapeHtml(plan.planTitle)}</strong> — ${escapeHtml(plan.serviceDate)}</p>`
      + `<p>Your assignments: ${escapeHtml(roleText(plan.assignments))}.</p>`
      + `<p><a href="${escapeHtml(plan.respondUrl)}">Confirm or decline ${escapeHtml(plan.planTitle)}</a></p></div>`),
  ].join('');
  return { subject, html, text };
};

export const scheduleEmail = (notification: ScheduleNotification): EmailContent => {
  if (notification.plans && notification.plans.length > 1) return consolidatedEmail(notification, notification.plans);
  const roles = notification.assignments ?? [{ teamName: notification.teamName, positionName: notification.positionName }];
  const subject = notification.reminder
    ? `Reminder: please answer for ${notification.planTitle}`
    : `Assignment for ${notification.planTitle}`;
  const lead = notification.reminder
    ? `Reminder: you have not yet answered your request for ${notification.planTitle} on ${notification.serviceDate}.`
    : `You are scheduled for ${notification.planTitle} on ${notification.serviceDate}.`;
  const text = [
    lead,
    `Your assignments: ${roleText(roles)}.`,
    `Confirm or decline: ${notification.respondUrl}`,
  ].join('\n\n');
  const leadHtml = notification.reminder
    ? `<p>Reminder: you have not yet answered your request for <strong>${escapeHtml(notification.planTitle)}</strong> on ${escapeHtml(notification.serviceDate)}.</p>`
    : `<p>You are scheduled for <strong>${escapeHtml(notification.planTitle)}</strong> on ${escapeHtml(notification.serviceDate)}.</p>`;
  const html = `${leadHtml}<p>Your assignments: ${escapeHtml(roleText(roles))}.</p><p><a href="${escapeHtml(notification.respondUrl)}">Confirm or decline this assignment</a></p>`;
  return { subject, html, text };
};
