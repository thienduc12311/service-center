import { escapeHtml } from '../../../lib/i18n.js';
import type { EmailContent } from './schedule.js';

/**
 * Church application emails. English only for now: an applicant has no
 * church yet, so there is no saved language to choose from.
 */

export interface NewChurchApplicationEmailInput {
  churchName: string;
  applicantName: string | null;
  city: string;
  country: string;
  reviewUrl: string;
}

export interface ChurchApplicationApprovedEmailInput {
  churchName: string;
  appUrl: string;
}

export interface ChurchApplicationRejectedEmailInput {
  churchName: string;
  reason: string;
  appUrl: string;
}

const paragraphsToHtml = (paragraphs: readonly string[]): string =>
  paragraphs.map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`).join('');

/** One header line: never let a newline from user text through. */
const subjectLine = (value: string): string => value.replace(/\s+/g, ' ').trim();

/** To super admins. */
export const newChurchApplicationEmail = (input: NewChurchApplicationEmailInput): EmailContent => {
  const who = input.applicantName ?? 'Someone';
  const paragraphs = [
    `${who} applied to register ${input.churchName} (${input.city}, ${input.country}).`,
    `Review it: ${input.reviewUrl}`,
  ];
  return {
    subject: subjectLine(`New church application: ${input.churchName}`),
    text: paragraphs.join('\n\n'),
    html: [
      `<p>${escapeHtml(who)} applied to register <strong>${escapeHtml(input.churchName)}</strong> (${escapeHtml(input.city)}, ${escapeHtml(input.country)}).</p>`,
      `<p><a href="${escapeHtml(input.reviewUrl)}">Review the application</a></p>`,
    ].join(''),
  };
};

/** To the applicant: their church exists and they are its owner. */
export const churchApplicationApprovedEmail = (input: ChurchApplicationApprovedEmailInput): EmailContent => {
  const paragraphs = [
    `Good news: ${input.churchName} is approved. You are its owner and can start inviting your team.`,
    `Open Service Center: ${input.appUrl}`,
  ];
  return {
    subject: subjectLine(`${input.churchName} is approved`),
    text: paragraphs.join('\n\n'),
    html: paragraphsToHtml(paragraphs.slice(0, 1)) + `<p><a href="${escapeHtml(input.appUrl)}">Open Service Center</a></p>`,
  };
};

/** To the applicant, with the reviewer's reason. */
export const churchApplicationRejectedEmail = (input: ChurchApplicationRejectedEmailInput): EmailContent => {
  const paragraphs = [
    `Your application to register ${input.churchName} was not approved.`,
    `Reason: ${input.reason}`,
    `You can update the details and apply again: ${input.appUrl}`,
  ];
  return {
    subject: subjectLine(`About your application for ${input.churchName}`),
    text: paragraphs.join('\n\n'),
    html: paragraphsToHtml(paragraphs),
  };
};
