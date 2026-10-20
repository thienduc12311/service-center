import type { ScheduleNotification, ScheduleNotificationPlan, ScheduleNotificationRole } from '../../notifications.js';
import { escapeHtml, recipientLanguage, type RecipientLanguage } from '../../../lib/i18n.js';

export { escapeHtml };

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

/** "Band — Bass, Hosts" in the recipient's language; team and position names stay as authored. */
export const roleText = (roles: readonly ScheduleNotificationRole[], language: RecipientLanguage): string =>
  roles
    .map((role) => {
      const team = role.teamName ?? language.t('email.teamFallback');
      return role.positionName ? language.t('email.rolePosition', { team, position: role.positionName }) : team;
    })
    .join(', ');

/**
 * F08: one message for several plans. Every plan has its own link, which
 * answers that plan's exact request only; nothing answers them all at once.
 */
const consolidatedEmail = (
  notification: ScheduleNotification,
  plans: readonly ScheduleNotificationPlan[],
  language: RecipientLanguage,
): EmailContent => {
  const { t } = language;
  const count = plans.length;
  const intro = notification.reminder ? t('email.consolidated.reminderIntro', { count }) : t('email.consolidated.intro', { count });
  const subject = notification.reminder ? t('email.consolidated.reminderSubject', { count }) : t('email.consolidated.subject', { count });
  const separate = t('email.consolidated.separateLinks');
  const sections = plans.map((plan) => ({
    heading: t('email.consolidated.planHeading', { plan: plan.planTitle, date: language.date(plan.serviceDate) }),
    roles: t('email.yourAssignments', { roles: roleText(plan.assignments, language) }),
    respondText: t('email.consolidated.respondText', { url: plan.respondUrl }),
    respondLink: t('email.consolidated.respondLink', { plan: plan.planTitle }),
    url: plan.respondUrl,
  }));
  const text = [intro, separate, ...sections.map((section) => [section.heading, section.roles, section.respondText].join('\n'))].join('\n\n');
  const html = [
    `<p>${escapeHtml(intro)}</p>`,
    `<p>${escapeHtml(separate)}</p>`,
    ...sections.map((section) => `<div style="margin:16px 0;padding:12px;border:1px solid #e5e7eb;border-radius:8px">`
      + `<p><strong>${escapeHtml(section.heading)}</strong></p>`
      + `<p>${escapeHtml(section.roles)}</p>`
      + `<p><a href="${escapeHtml(section.url)}">${escapeHtml(section.respondLink)}</a></p></div>`),
  ].join('');
  return { subject, html, text };
};

export const scheduleEmail = (notification: ScheduleNotification): EmailContent => {
  const language = recipientLanguage(notification.locale);
  if (notification.plans && notification.plans.length > 1) return consolidatedEmail(notification, notification.plans, language);
  const { t } = language;
  const roles = notification.assignments ?? [{ teamName: notification.teamName, positionName: notification.positionName }];
  const values = { plan: notification.planTitle, date: language.date(notification.serviceDate) };
  const subject = notification.reminder ? t('email.schedule.reminderSubject', values) : t('email.schedule.subject', values);
  const lead = notification.reminder ? t('email.schedule.reminderLead', values) : t('email.schedule.lead', values);
  const rolesLine = t('email.yourAssignments', { roles: roleText(roles, language) });
  const text = [lead, rolesLine, t('email.schedule.respondText', { url: notification.respondUrl })].join('\n\n');
  const html = `<p>${escapeHtml(lead)}</p><p>${escapeHtml(rolesLine)}</p>`
    + `<p><a href="${escapeHtml(notification.respondUrl)}">${escapeHtml(t('email.schedule.respondLink'))}</a></p>`;
  return { subject, html, text };
};
