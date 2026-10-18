import type {
  ConversationMessage,
  ConversationMessageRow,
  DeliveryChannel,
  DeliveryStatus,
  DiscussionMention,
  DiscussionPage,
  MentionResolution,
  MessageAudienceReason,
  MessageRecipientOutcome,
  OperationalRecipientStatus,
  PlanItemComment,
  PlanItemCommentRow,
  PlanNote,
  PlanNoteRow,
} from '@service-center/shared';
import type { Db } from '../lib/supabase.js';

/** Who is acting, in which organization, through which RLS-bound client. */
export interface CollaborationCaller {
  db: Db;
  orgId: string;
  userId: string;
}

/** A name from `people_directory` (names only; visible to every member). */
export interface DirectoryName {
  id: string;
  profile_id: string | null;
  first_name: string;
  last_name: string | null;
}

export interface MentionRecord {
  person_id: string;
  resolution: MentionResolution;
}

export const displayName = (name: Pick<DirectoryName, 'first_name' | 'last_name'> | null | undefined): string | null =>
  name ? [name.first_name, name.last_name].filter(Boolean).join(' ') || null : null;

/** At most `max` characters, cut on a word boundary when one is near. */
export const excerpt = (text: string, max = 140): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
};

export const toPlanNote = (row: PlanNoteRow, teamIds: readonly string[], authorName: string | null): PlanNote => ({
  ...row,
  team_ids: [...teamIds].sort(),
  author_name: authorName,
});

const toMentions = (
  records: readonly MentionRecord[],
  names: ReadonlyMap<string, DirectoryName>,
): DiscussionMention[] =>
  records.map((record) => ({
    person_id: record.person_id,
    name: displayName(names.get(record.person_id)) ?? 'Someone',
    resolution: record.resolution,
  }));

export const toItemComment = (
  row: PlanItemCommentRow,
  mentions: readonly MentionRecord[],
  names: ReadonlyMap<string, DirectoryName>,
  authorName: string | null,
  userId: string,
): PlanItemComment => ({
  ...row,
  author_name: authorName,
  mentions: toMentions(mentions, names),
  is_mine: row.author_id === userId,
});

export const toConversationMessage = (
  row: ConversationMessageRow,
  mentions: readonly MentionRecord[],
  names: ReadonlyMap<string, DirectoryName>,
  authorName: string | null,
  userId: string,
): ConversationMessage => ({
  ...row,
  author_name: authorName,
  mentions: toMentions(mentions, names),
  is_mine: row.author_id === userId,
});

/**
 * Rows are fetched newest first with one extra row: when it exists there
 * are older rows, and the cursor is the oldest shown `created_at`.
 * Returned oldest first, the order a thread is read in.
 */
export const pageOf = <T extends { created_at: string }>(rows: readonly T[], limit: number): DiscussionPage<T> => {
  const shown = rows.slice(0, limit);
  return {
    data: [...shown].reverse(),
    next_before: rows.length > limit ? shown[shown.length - 1]?.created_at ?? null : null,
  };
};

/** One row of `operational_message_outcomes` (recipient × channel). */
export interface MessageOutcomeRow {
  person_id: string;
  first_name: string;
  last_name: string | null;
  reasons: MessageAudienceReason[];
  recipient_status: OperationalRecipientStatus;
  delivery_id: string | null;
  channel: DeliveryChannel | null;
  delivery_status: DeliveryStatus | null;
  error_code: string | null;
  attempts: number | null;
  completed_at: string | null;
}

const RETRYABLE: ReadonlySet<DeliveryStatus> = new Set<DeliveryStatus>(['failed', 'ambiguous']);

/** Groups recipient × channel rows into one outcome per recipient, in input order. */
export const groupMessageOutcomes = (rows: readonly MessageOutcomeRow[]): MessageRecipientOutcome[] => {
  const byPerson = new Map<string, MessageRecipientOutcome>();
  for (const row of rows) {
    let outcome = byPerson.get(row.person_id);
    if (!outcome) {
      outcome = {
        person_id: row.person_id,
        first_name: row.first_name,
        last_name: row.last_name,
        reasons: row.reasons,
        status: row.recipient_status,
        channels: [],
        retryable: false,
      };
      byPerson.set(row.person_id, outcome);
    }
    if (row.delivery_id && row.channel && row.delivery_status) {
      outcome.channels.push({
        delivery_id: row.delivery_id,
        channel: row.channel,
        status: row.delivery_status,
        error_code: row.error_code,
        attempts: row.attempts ?? 0,
        completed_at: row.completed_at,
      });
      outcome.retryable ||= RETRYABLE.has(row.delivery_status);
    }
  }
  return [...byPerson.values()];
};
