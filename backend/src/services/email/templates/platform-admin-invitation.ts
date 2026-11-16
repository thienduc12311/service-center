import { escapeHtml } from '../../../lib/i18n.js';
import type { EmailContent } from './schedule.js';

/** Inviting someone to become a super admin. English only, like the rest of the admin dashboard. */
export interface PlatformAdminInvitationEmailInput {
  inviterName: string | null;
  /** The address the invitation was sent to; they must sign in with it. */
  email: string;
  expiresAt: Date;
  adminUrl: string;
  /** Whether an account with this address exists yet. */
  hasAccount: boolean;
}

const dateLabel = (value: Date): string =>
  value.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

export const platformAdminInvitationEmail = (input: PlatformAdminInvitationEmailInput): EmailContent => {
  const who = input.inviterName ?? 'A Service Center super admin';
  const steps = input.hasAccount
    ? `Sign in to the admin dashboard with ${input.email} and accept the invitation: ${input.adminUrl}`
    : `First create a Service Center account with ${input.email}, then sign in to the admin dashboard and accept the invitation: ${input.adminUrl}`;
  const paragraphs = [
    `${who} invited you to become a super admin of Service Center. Super admins manage every church and account on the platform.`,
    steps,
    `You will set up two-factor sign-in before you can use the dashboard. The invitation expires on ${dateLabel(input.expiresAt)} (UTC).`,
    `If you weren't expecting this, you can ignore this email.`,
  ];
  return {
    subject: 'You are invited to become a Service Center super admin',
    text: paragraphs.join('\n\n'),
    html: [
      `<p>${escapeHtml(paragraphs[0] ?? '')}</p>`,
      `<p>${escapeHtml(steps.replace(`: ${input.adminUrl}`, '.'))}</p>`,
      `<p><a href="${escapeHtml(input.adminUrl)}">Open the admin dashboard</a></p>`,
      `<p>${escapeHtml(paragraphs[2] ?? '')}</p>`,
      `<p>${escapeHtml(paragraphs[3] ?? '')}</p>`,
    ].join(''),
  };
};
