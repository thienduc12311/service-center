import type { MessageAudienceReason, MessageAudienceRecipient, TextHandoffRecipient } from '@service-center/shared';
import { matchesSearch } from './list-search';

/**
 * MOB-018 at scale: a reviewed audience can be hundreds of people, so the
 * composer shows a count and a few names, and the full list (with search and
 * bulk include/exclude) opens on demand. These helpers shape that list; the
 * send still goes through the shared `messageRecipientsToSend`.
 */

/** A recipient's display name, as the composer has always shown it. */
export const recipientName = (recipient: Pick<MessageAudienceRecipient, 'first_name' | 'last_name'>): string =>
  [recipient.first_name, recipient.last_name].filter(Boolean).join(' ');

/** Recipients whose name (or why they're included, in words) match `query`. */
export const filterRecipients = (
  recipients: readonly MessageAudienceRecipient[],
  query: string,
  reasonLabel: (reason: MessageAudienceReason) => string = (reason) => reason,
): MessageAudienceRecipient[] =>
  recipients.filter((recipient) => matchesSearch(query, [recipientName(recipient), ...recipient.reasons.map(reasonLabel)]));

/** People reached by the send: reachable and not excluded (the shared rule, here for counts and names). */
export const includedRecipients = (
  recipients: readonly MessageAudienceRecipient[],
  excluded: readonly string[],
): MessageAudienceRecipient[] => recipients.filter((recipient) => recipient.reachable && !excluded.includes(recipient.person_id));

/** The first few names that will receive the message, and how many more there are. */
export interface RecipientNamePreview {
  names: string[];
  more: number;
}

export const recipientNamePreview = (
  recipients: readonly MessageAudienceRecipient[],
  excluded: readonly string[],
  max = 3,
): RecipientNamePreview => {
  const included = includedRecipients(recipients, excluded);
  return { names: included.slice(0, max).map(recipientName), more: Math.max(0, included.length - max) };
};

/** Reachable people in `shown`: the only ones an include/exclude toggle applies to. */
export const toggleableIds = (shown: readonly MessageAudienceRecipient[]): string[] =>
  shown.filter((recipient) => recipient.reachable).map((recipient) => recipient.person_id);

/** `list` with every id in `ids` added (once). */
export const withAll = (list: readonly string[], ids: readonly string[]): string[] => [...new Set([...list, ...ids])];

/** `list` without any id in `ids`. */
export const withoutAll = (list: readonly string[], ids: readonly string[]): string[] => {
  const drop = new Set(ids);
  return list.filter((id) => !drop.has(id));
};

/** Whether every id in `ids` is in `list` (false for an empty `ids`). */
export const containsAll = (list: readonly string[], ids: readonly string[]): boolean =>
  ids.length > 0 && ids.every((id) => list.includes(id));

/** Text-handoff candidates whose name or phone match `query`. */
export const filterHandoffCandidates = (candidates: readonly TextHandoffRecipient[], query: string): TextHandoffRecipient[] =>
  candidates.filter((candidate) => matchesSearch(query, [candidate.name, candidate.phone]));
