import { POKE_FALLBACK_MS } from './realtime-pokes.js';
import { ApiError } from './api-client.js';
import type { NotificationRow, NotificationType } from '../types/database.js';
import type { ConversationListPage, ConversationMessage, ConversationSummary } from '../types/collaboration.js';

/**
 * F09 / MOB-019: team and plan conversation rules shared by the website and
 * the native app (`conversations`, `getConversation`, `conversationMessages`,
 * `postConversationMessage`, `markConversationRead`, `muteConversation`,
 * moderation). The server derives participants and decides every request;
 * these helpers only interpret its answers the same way on both clients.
 */

/** Authoritative fallback reads when a broadcast is missed or unavailable. */
export const CONVERSATION_THREAD_POLL_MS = POKE_FALLBACK_MS;
export const CONVERSATION_LIST_POLL_MS = POKE_FALLBACK_MS;
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
  /** Block the author: hides everything they write from the caller. Never offered on your own messages. */
  block: boolean;
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
    block: visible && !message.is_mine,
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

// ------------------------------------------------- list paging (W8-PERF-D3) --

/**
 * Sort key of one conversation in the list: most recent message first (none
 * last), then newest conversation, then id so the order is total and a page
 * boundary never splits or repeats a tie. The database orders identically.
 */
export interface ConversationListCursor {
  /** `last_message_at` of the last row shown, null when it has no messages. */
  last: string | null;
  created: string;
  id: string;
}

const base64UrlEncode = (text: string): string =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const base64UrlDecode = (value: string): string => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return new TextDecoder().decode(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)));
};

export const encodeConversationCursor = (cursor: ConversationListCursor): string =>
  base64UrlEncode(JSON.stringify(cursor));

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isTimestamp = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value));

/** Null when the cursor was not produced by `encodeConversationCursor`. */
export const decodeConversationCursor = (value: string): ConversationListCursor | null => {
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(value));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { last, created, id } = parsed as Record<string, unknown>;
    if (!(last === null || isTimestamp(last)) || !isTimestamp(created) || typeof id !== 'string' || !UUID_PATTERN.test(id)) {
      return null;
    }
    return { last, created, id };
  } catch {
    // Not valid base64 or JSON: the caller maps a null cursor to a 400.
    return null;
  }
};

/** A conversation row plus the creation time the cursor needs (never sent to clients). */
export interface ConversationListRow extends ConversationSummary {
  created_at: string;
}

/**
 * Turns `limit + 1` rows from the database into one API page. The extra row
 * only proves another page exists; the cursor points at the last row returned.
 */
export const toConversationListPage = (rows: readonly ConversationListRow[], limit: number): ConversationListPage => {
  const shown = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  const lastRow = shown.at(-1);
  return {
    items: shown.map((row): ConversationSummary => {
      const { created_at: _createdAt, ...summary } = row;
      return summary;
    }),
    has_more: hasMore,
    next_cursor: hasMore && lastRow
      ? encodeConversationCursor({ last: lastRow.last_message_at, created: lastRow.created_at, id: lastRow.id })
      : null,
  };
};

/** Every conversation across loaded pages, without repeats if a refetch shifted a boundary. */
export const flattenConversationPages = (pages: readonly ConversationListPage[]): ConversationSummary[] => {
  const seen = new Set<string>();
  const out: ConversationSummary[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
};
