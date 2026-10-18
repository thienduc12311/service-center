import type {
  ConversationReportReason,
  MessageAudienceInclude,
  MessageAudienceReason,
  MessageVariableSnapshot,
  NoteAudience,
} from '../types/collaboration.js';

/**
 * F09 — the only `{{variables}}` a message subject/body may use. Kept in
 * step with `private.message_unknown_variables` in the database, which
 * refuses anything else at send time too.
 */
export const MESSAGE_TEMPLATE_VARIABLES = [
  'first_name',
  'last_name',
  'full_name',
  'organization_name',
  'plan_title',
  'plan_date',
  'sender_name',
] as const;

export type MessageTemplateVariable = (typeof MESSAGE_TEMPLATE_VARIABLES)[number];
export type MessageVariableValues = Record<MessageTemplateVariable, string>;

export const MESSAGE_VARIABLE_LABELS: Record<MessageTemplateVariable, string> = {
  first_name: 'Recipient first name',
  last_name: 'Recipient last name',
  full_name: 'Recipient full name',
  organization_name: 'Organization name',
  plan_title: 'Plan title',
  plan_date: 'Plan date',
  sender_name: 'Your name',
};

const VARIABLE = /\{\{\s*([^{}\s]*)\s*\}\}/g;
const allowed = new Set<string>(MESSAGE_TEMPLATE_VARIABLES);

/** Every `{{name}}` in the text that is not on the allowlist, once each. */
export const unknownMessageVariables = (text: string): string[] => {
  const unknown = new Set<string>();
  for (const match of text.matchAll(VARIABLE)) {
    const name = match[1] ?? '';
    if (!allowed.has(name)) unknown.add(name);
  }
  return [...unknown];
};

/**
 * Substitutes allowlisted variables into plain text. Values are inserted as
 * text, never markup: the email renderer escapes the whole result. An
 * unknown variable is left as written (sending refuses it anyway).
 */
export const renderMessageTemplate = (text: string, values: Readonly<MessageVariableValues>): string =>
  text.replace(VARIABLE, (whole, name: string) =>
    allowed.has(name) ? values[name as MessageTemplateVariable] : whole,
  );

export interface MessageRecipientNames {
  first_name: string;
  last_name: string | null;
}

/** "Sun, Oct 25, 2026" in the organization's zone, or empty. */
const formatPlanDate = (instant: string | null | undefined, timeZone: string | null | undefined): string => {
  if (!instant) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: timeZone ?? 'UTC',
    }).format(new Date(instant));
  } catch {
    return new Date(instant).toDateString();
  }
};

/** Values for one recipient, from the snapshot captured when the message was sent. */
export const messageVariableValues = (
  recipient: MessageRecipientNames,
  snapshot: Readonly<MessageVariableSnapshot>,
): MessageVariableValues => ({
  first_name: recipient.first_name,
  last_name: recipient.last_name ?? '',
  full_name: [recipient.first_name, recipient.last_name].filter(Boolean).join(' '),
  organization_name: snapshot.organization_name ?? '',
  plan_title: snapshot.plan_title ?? '',
  plan_date: formatPlanDate(snapshot.plan_date, snapshot.organization_timezone),
  sender_name: snapshot.sender_name ?? '',
});

export const NOTE_AUDIENCE_LABELS: Record<NoteAudience, string> = {
  organization: 'Everyone in the organization',
  scheduled: 'People scheduled on this plan',
  teams: 'Selected teams',
  leaders: 'Plan leaders only',
};

export const MESSAGE_AUDIENCE_INCLUDE_LABELS: Record<MessageAudienceInclude, string> = {
  team_members: 'Team members',
  scheduled_confirmed: 'Confirmed on this plan',
  scheduled_pending: 'Not yet answered on this plan',
  signups: 'Signed up for an opening',
};

export const MESSAGE_AUDIENCE_REASON_LABELS: Record<MessageAudienceReason, string> = {
  team_member: 'Team member',
  scheduled_confirmed: 'Confirmed',
  scheduled_pending: 'Awaiting reply',
  signup: 'Signed up',
};

export const CONVERSATION_REPORT_REASON_LABELS: Record<ConversationReportReason, string> = {
  spam: 'Spam',
  harassment: 'Harassment or bullying',
  inappropriate: 'Inappropriate content',
  safety: 'Safety concern',
  other: 'Something else',
};
