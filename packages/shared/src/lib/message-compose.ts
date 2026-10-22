import type { MessageAudienceInput, SendOperationalMessageInput } from '../schemas/collaboration.js';
import type {
  MessageAudience,
  MessageAudienceInclude,
  MessageAudiencePreview,
  MessageAudienceRecipient,
  MessageVariableSnapshot,
} from '../types/collaboration.js';
import type { RosterPerson } from '../types/domain.js';
import { ApiError } from './api-client.js';
import {
  MESSAGE_TEMPLATE_VARIABLES,
  messageVariableValues,
  renderMessageTemplate,
  type MessageTemplateVariable,
} from './message-templates.js';

/**
 * F09 / MOB-018 — the targeted-message composer rules both clients follow on
 * top of `previewMessage` / `sendMessage`, plus the device text handoff. The
 * server decides the audience, the reachable channels and who may see a
 * phone number; nothing here widens either.
 */

/** Groups offered for a plan message, in the website's order. */
export const PLAN_MESSAGE_GROUPS: readonly MessageAudienceInclude[] = [
  'scheduled_confirmed',
  'scheduled_pending',
  'signups',
  'team_members',
];

export const defaultMessageInclude = (hasPlan: boolean): MessageAudienceInclude[] =>
  hasPlan ? ['scheduled_confirmed', 'scheduled_pending'] : ['team_members'];

export const messageAudience = (
  planId: string | null,
  include: readonly MessageAudienceInclude[],
  teamIds: readonly string[],
): MessageAudienceInput => ({ plan_id: planId, team_ids: [...teamIds], include: [...include] });

export type MessageAudienceProblem = 'groups_required' | 'teams_required' | 'plan_required';

/** Why the selection cannot be previewed yet (mirrors `messageAudienceSchema`), or null. */
export const messageAudienceProblem = (audience: Readonly<MessageAudience>): MessageAudienceProblem | null => {
  if (audience.include.length === 0) return 'groups_required';
  if (audience.include.includes('team_members') && (audience.team_ids ?? []).length === 0) return 'teams_required';
  if (!audience.plan_id && audience.include.some((group) => group !== 'team_members')) return 'plan_required';
  return null;
};

/** The same selection compares equal however it was toggled. */
export const messageAudienceKey = (audience: Readonly<MessageAudience>): string =>
  JSON.stringify([audience.plan_id ?? null, [...(audience.team_ids ?? [])].sort(), [...audience.include].sort()]);

/** Exclusions that still name someone in the preview. */
export const keptExclusions = (preview: Readonly<MessageAudiencePreview>, excluded: readonly string[]): string[] =>
  excluded.filter((id) => preview.recipients.some((recipient) => recipient.person_id === id));

/** Who the send will reach: reachable and not removed by the sender. */
export const messageRecipientsToSend = (
  preview: Readonly<MessageAudiencePreview> | null,
  excluded: readonly string[],
): MessageAudienceRecipient[] =>
  (preview?.recipients ?? []).filter((recipient) => recipient.reachable && !excluded.includes(recipient.person_id));

/** Variables worth offering: plan variables only on a plan message. */
export const messageVariablesFor = (hasPlan: boolean): MessageTemplateVariable[] =>
  MESSAGE_TEMPLATE_VARIABLES.filter((variable) => hasPlan || !variable.startsWith('plan_'));

export interface MessageSendDraft {
  audience: Readonly<MessageAudienceInput>;
  subject: string;
  body: string;
  templateId: string | null;
  excluded: readonly string[];
  preview: Readonly<MessageAudiencePreview>;
  /** One key per composed message; reuse it for every retry. */
  idempotencyKey: string;
}

/** The send body for the previewed audience. Exclusions outside the preview are dropped. */
export const messageSendBody = (draft: Readonly<MessageSendDraft>): SendOperationalMessageInput => ({
  audience: {
    plan_id: draft.audience.plan_id ?? null,
    team_ids: [...draft.audience.team_ids],
    include: [...draft.audience.include],
  },
  subject: draft.subject,
  body: draft.body,
  template_id: draft.templateId,
  excluded_person_ids: keptExclusions(draft.preview, draft.excluded),
  audience_hash: draft.preview.audience_hash,
  idempotency_key: draft.idempotencyKey,
});

/** How a refused or failed send should be presented. */
export type MessageSendOutcome =
  /** 409 `audience_changed`: nothing was sent; review a fresh preview. */
  | 'audienceChanged'
  /** No answer or a server failure: it may have been stored. Retry with the same key. */
  | 'uncertain'
  /** 409 `idempotency_key_reused`: an earlier attempt of this message was stored with other content. */
  | 'keyReused'
  /** Refused for another reason (lost permission, validation, template gone). Nothing was sent. */
  | 'refused';

export const messageSendOutcome = (error: unknown): MessageSendOutcome => {
  if (error instanceof ApiError) {
    if (error.status >= 500) return 'uncertain';
    if (error.code === 'audience_changed') return 'audienceChanged';
    if (error.code === 'idempotency_key_reused') return 'keyReused';
    return 'refused';
  }
  return 'uncertain';
};

// ------------------------------------------------------ device text handoff --

/** A previewed recipient, with the phone number the server let the caller see (if any). */
export interface TextHandoffRecipient {
  person_id: string;
  name: string;
  phone: string | null;
}

/**
 * Joins the previewed audience to the People list. `listPeople` returns a
 * phone only to people.view_private / people.manage (or for oneself), so
 * nobody gains a number they could not already read.
 */
export const textHandoffRecipients = (
  recipients: readonly MessageAudienceRecipient[],
  people: readonly Pick<RosterPerson, 'person_id' | 'phone'>[],
): TextHandoffRecipient[] => {
  const phones = new Map<string, string>();
  for (const person of people) {
    const phone = normalizeTextPhone(person.phone);
    if (person.person_id && phone) phones.set(person.person_id, phone);
  }
  return recipients.map((recipient) => ({
    person_id: recipient.person_id,
    name: [recipient.first_name, recipient.last_name].filter(Boolean).join(' '),
    phone: phones.get(recipient.person_id) ?? null,
  }));
};

/** Digits and a leading +, or null when too short to dial. */
export const normalizeTextPhone = (phone: string | null | undefined): string | null => {
  if (!phone) return null;
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 3) return null;
  return trimmed.startsWith('+') ? `+${digits}` : digits;
};

/** Variables that differ per recipient; a group text cannot fill them in. */
export const PERSONAL_MESSAGE_VARIABLES: readonly MessageTemplateVariable[] = ['first_name', 'last_name', 'full_name'];

export type TextHandoffBody =
  | { ok: true; text: string }
  | { ok: false; personalVariables: MessageTemplateVariable[] };

/**
 * The text handed to the device composer. Shared variables are filled from
 * the same values as the email; recipient variables only when one person is
 * selected. The result is plain text — the composer never interprets it.
 */
export const textHandoffBody = (
  body: string,
  snapshot: Readonly<MessageVariableSnapshot>,
  selected: readonly Pick<MessageAudienceRecipient, 'first_name' | 'last_name'>[],
): TextHandoffBody => {
  const only = selected.length === 1 ? selected[0] : undefined;
  if (!only) {
    const personalVariables = PERSONAL_MESSAGE_VARIABLES.filter((variable) =>
      new RegExp(`\\{\\{\\s*${variable}\\s*\\}\\}`).test(body));
    if (personalVariables.length > 0) return { ok: false, personalVariables };
  }
  const values = messageVariableValues(only ?? { first_name: '', last_name: null }, snapshot);
  return { ok: true, text: renderMessageTemplate(body, values).trim() };
};

export type TextComposerPlatform = 'ios' | 'android';

/**
 * An `sms:` link that opens the device's own composer with the recipients
 * and text filled in. Opening it sends nothing; the person still taps Send
 * there, and the app is never told whether they did.
 */
export const textComposerUrl = (
  phones: readonly string[],
  text: string,
  platform: TextComposerPlatform,
): string => {
  const body = encodeURIComponent(text);
  if (platform === 'ios') {
    if (phones.length <= 1) return `sms:${phones[0] ?? ''}&body=${body}`;
    return `sms:/open?addresses=${phones.join(',')}&body=${body}`;
  }
  return `sms:${phones.join(',')}?body=${body}`;
};
