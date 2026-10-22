import { ApiError } from './api-client.js';
import type { NotificationRow, NotificationType } from '../types/database.js';
import type { ConversationMessage, ConversationSummary } from '../types/collaboration.js';

/**
 * F09 / MOB-019: team and plan conversation rules shared by the website and
 * the native app (`conversations`, `getConversation`, `conversationMessages`,
 * `postConversationMessage`, `markConversationRead`, `muteConversation`,
 * moderation). The server derives participants and decides every request;
 * these helpers only interpret its answers the same way on both clients.
 */

/** Both clients poll the authenticated API; there is no realtime subscription. */
export const CONVERSATION_THREAD_POLL_MS = 10_000;
export const CONVERSATION_LIST_POLL_MS = 30_000;
/** Messages per page (the server allows 1–100). */
export const CONVERSATION_PAGE_SIZE = 30;
/** Same minimum as `conversationMessagesQuerySchema.q`. */
export const CONVERSATION_SEARCH_MIN = 2;

/** Notification types that announce a conversation message. */
export const CONVERSATION_NOTIFICATION_TYPES: readonly NotificationType[] = [
  'conversation_message',
  'conversation_mention',
  'conversation_reply',
];

/** Minimal shape for merging keyset pages. */
export interface ConversationPageEntry {
  id: string;
  created_at: string;
}

/**
 * Pages (each oldest-first) merged into one oldest-first list without
 * duplicates. Overlapping pages, a re-read newest page and a replayed post
 * all carry the same message id; the later copy wins (edits, removals).
 */
export const mergeConversationPages = <T extends ConversationPageEntry>(
  known: readonly T[],
  page: readonly T[],
): T[] => {
  const byId = new Map<string, T>();
  for (const message of known) byId.set(message.id, message);
  for (const message of page) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) =>
    a.created_at === b.created_at ? a.id.localeCompare(b.id) : a.created_at.localeCompare(b.created_at));
};

/**
 * The read position to send after showing `shown` (oldest-first), or null
 * when nothing new was displayed. Only the newest message actually on screen
 * counts, never "now": a message that arrives while the thread is not
 * visible stays unread. The server keeps the position monotonic as well.
 */
export const conversationReadMark = (
  shown: readonly ConversationPageEntry[],
  unreadCount: number,
  alreadyMarked: string | null,
): string | null => {
  const newest = shown.at(-1)?.created_at ?? null;
  if (!newest || unreadCount <= 0) return null;
  if (alreadyMarked && newest <= alreadyMarked) return null;
  return newest;
};

export type ConversationMessageState = 'visible' | 'deleted' | 'hidden';

export const conversationMessageState = (message: Pick<ConversationMessage, 'deleted_at' | 'hidden_at'>): ConversationMessageState =>
  message.hidden_at ? 'hidden' : message.deleted_at ? 'deleted' : 'visible';

/** Which actions to offer on one message; the server rechecks each one. */
export interface ConversationMessageActions {
  reply: boolean;
  edit: boolean;
  report: boolean;
  delete: boolean;
  restore: boolean;
}

export const conversationMessageActions = (
  message: Pick<ConversationMessage, 'deleted_at' | 'hidden_at' | 'is_mine'>,
  conversation: Pick<ConversationSummary, 'can_moderate'>,
): ConversationMessageActions => {
  const state = conversationMessageState(message);
  const visible = state === 'visible';
  return {
    reply: visible,
    edit: visible && message.is_mine,
    report: visible && !message.is_mine,
    delete: visible && (message.is_mine || conversation.can_moderate),
    restore: state === 'hidden' && conversation.can_moderate,
  };
};

/** How a failed send should be presented. The draft and its id are kept unless noted. */
export type ConversationPostOutcome =
  /** No answer (network, 5xx): it may have been stored; sending again with the same id replays it. */
  | 'uncertain'
  /** 429: wait before sending again (same id). */
  | 'rateLimited'
  /** 409 `message_id_conflict`: the id belongs to another message; the draft needs a fresh id. */
  | 'newId'
  /** 404: the conversation (or the message replied to) is no longer available to this person. */
  | 'gone'
  /** 403/422/other: refused as is. */
  | 'refused';

export const conversationPostOutcome = (error: unknown): ConversationPostOutcome => {
  if (!(error instanceof ApiError)) return 'uncertain';
  if (error.status >= 500) return 'uncertain';
  if (error.status === 429) return 'rateLimited';
  if (error.code === 'message_id_conflict') return 'newId';
  if (error.status === 404) return 'gone';
  return 'refused';
};

/** Whether a thread could be read: 404/403 means not (or no longer) a participant. */
export type ConversationAccess = 'open' | 'unavailable' | 'error';

export const conversationAccess = (error: unknown): ConversationAccess => {
  if (!error) return 'open';
  if (error instanceof ApiError && (error.status === 404 || error.status === 403)) return 'unavailable';
  return 'error';
};

/** True when the server already stored the draft with this id (a lost acknowledgement). */
export const draftAlreadyPosted = (messages: readonly Pick<ConversationMessage, 'id' | 'is_mine'>[], draftId: string): boolean =>
  messages.some((message) => message.id === draftId && message.is_mine);

/** The conversation a feed row or push opens, or null when it is not a chat notification. */
export const conversationNotificationTarget = (
  notification: Pick<NotificationRow, 'type' | 'conversation_id'>,
): string | null =>
  notification.conversation_id && CONVERSATION_NOTIFICATION_TYPES.includes(notification.type)
    ? notification.conversation_id
    : null;

/** Minimal team shape for choosing which team chats may be opened. */
export interface ChatTeam {
  id: string;
  service_type_id: string | null;
  members: ReadonlyArray<{ user_id: string | null }>;
}

/**
 * Teams whose chat the caller may open: their own teams, plus teams they
 * schedule or manage. Same rule as the database's participant check; the
 * server still decides (404 otherwise).
 */
export const chatStartableTeams = <T extends ChatTeam>(
  teams: readonly T[],
  profileId: string | null | undefined,
  canManageTeam: (team: T) => boolean,
): T[] =>
  teams.filter((team) =>
    (profileId != null && team.members.some((member) => member.user_id === profileId)) || canManageTeam(team));
