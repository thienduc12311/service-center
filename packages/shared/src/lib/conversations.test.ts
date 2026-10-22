import { describe, expect, it } from 'vitest';
import { ApiError } from './api-client.js';
import {
  chatStartableTeams,
  conversationAccess,
  conversationMessageActions,
  conversationMessageState,
  conversationNotificationTarget,
  conversationPostOutcome,
  conversationReadMark,
  draftAlreadyPosted,
  mergeConversationPages,
  CONVERSATION_SEARCH_MIN,
} from './conversations.js';
import { conversationMessagesQuerySchema, postConversationMessageSchema } from '../schemas/collaboration.js';
import type { ConversationMessage } from '../types/collaboration.js';

const CONVERSATION = '00000000-0000-4000-8000-0000000000c1';

const message = (id: string, created_at: string, overrides: Partial<ConversationMessage> = {}): ConversationMessage => ({
  id,
  organization_id: '00000000-0000-4000-8000-000000000001',
  conversation_id: CONVERSATION,
  author_id: '00000000-0000-4000-8000-0000000000a1',
  author_person_id: null,
  reply_to_id: null,
  body: `body ${id}`,
  edited_at: null,
  deleted_at: null,
  hidden_at: null,
  hidden_by: null,
  created_at,
  author_name: 'Sam',
  mentions: [],
  is_mine: false,
  ...overrides,
});

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('mergeConversationPages', () => {
  it('deduplicates overlapping pages and keeps oldest-first order', () => {
    const newest = [message(id(3), '2026-10-21T10:03:00Z'), message(id(4), '2026-10-21T10:04:00Z')];
    const older = [message(id(1), '2026-10-21T10:01:00Z'), message(id(2), '2026-10-21T10:02:00Z'), message(id(3), '2026-10-21T10:03:00Z')];
    expect(mergeConversationPages(newest, older).map((m) => m.id)).toEqual([id(1), id(2), id(3), id(4)]);
  });

  it('lets a re-read copy win, so edits and removals replace the shown text', () => {
    const shown = [message(id(1), '2026-10-21T10:01:00Z')];
    const reread = [message(id(1), '2026-10-21T10:01:00Z', { body: '', hidden_at: '2026-10-21T11:00:00Z' })];
    const [merged] = mergeConversationPages(shown, reread);
    expect(merged?.hidden_at).not.toBeNull();
    expect(merged?.body).toBe('');
  });

  it('keeps a replayed post (same id) as one message', () => {
    const posted = message(id(5), '2026-10-21T10:05:00Z', { is_mine: true });
    expect(mergeConversationPages([posted], [posted, posted])).toHaveLength(1);
  });

  it('orders equal timestamps by id so pages agree on both clients', () => {
    const merged = mergeConversationPages([message(id(9), '2026-10-21T10:00:00Z')], [message(id(8), '2026-10-21T10:00:00Z')]);
    expect(merged.map((m) => m.id)).toEqual([id(8), id(9)]);
  });
});

describe('conversationReadMark', () => {
  const shown = [message(id(1), '2026-10-21T10:01:00Z'), message(id(2), '2026-10-21T10:02:00Z')];

  it('marks the newest displayed message, never a later time', () => {
    expect(conversationReadMark(shown, 2, null)).toBe('2026-10-21T10:02:00Z');
  });

  it('does nothing when nothing is unread, nothing is shown or it was already sent', () => {
    expect(conversationReadMark(shown, 0, null)).toBeNull();
    expect(conversationReadMark([], 3, null)).toBeNull();
    expect(conversationReadMark(shown, 1, '2026-10-21T10:02:00Z')).toBeNull();
  });

  it('advances once a newer message is displayed', () => {
    const more = [...shown, message(id(3), '2026-10-21T10:03:00Z')];
    expect(conversationReadMark(more, 1, '2026-10-21T10:02:00Z')).toBe('2026-10-21T10:03:00Z');
  });
});

describe('conversationMessageActions', () => {
  const participant = { can_moderate: false };
  const moderator = { can_moderate: true };

  it('offers reply/report on others, edit/delete on own', () => {
    expect(conversationMessageActions(message(id(1), 'x'), participant)).toEqual({ reply: true, edit: false, report: true, delete: false, restore: false });
    expect(conversationMessageActions(message(id(1), 'x', { is_mine: true }), participant)).toEqual({ reply: true, edit: true, report: false, delete: true, restore: false });
  });

  it('lets moderators delete anyone and restore only hidden messages', () => {
    expect(conversationMessageActions(message(id(1), 'x'), moderator).delete).toBe(true);
    const hidden = message(id(1), 'x', { hidden_at: '2026-10-21T11:00:00Z', body: '' });
    expect(conversationMessageState(hidden)).toBe('hidden');
    expect(conversationMessageActions(hidden, moderator)).toEqual({ reply: false, edit: false, report: false, delete: false, restore: true });
    expect(conversationMessageActions(hidden, participant).restore).toBe(false);
  });

  it('offers nothing on a deleted message', () => {
    const deleted = message(id(1), 'x', { deleted_at: '2026-10-21T11:00:00Z', body: '', is_mine: true });
    expect(conversationMessageState(deleted)).toBe('deleted');
    expect(Object.values(conversationMessageActions(deleted, moderator)).some(Boolean)).toBe(false);
  });
});

describe('conversationPostOutcome', () => {
  it('treats no answer and server errors as uncertain (same id replays)', () => {
    expect(conversationPostOutcome(new TypeError('Network request failed'))).toBe('uncertain');
    expect(conversationPostOutcome(new ApiError(502, 'Bad gateway'))).toBe('uncertain');
  });

  it('separates rate limit, id conflict, revoked access and refusals', () => {
    expect(conversationPostOutcome(new ApiError(429, 'slow down', 'rate_limited'))).toBe('rateLimited');
    expect(conversationPostOutcome(new ApiError(409, 'used', 'message_id_conflict'))).toBe('newId');
    expect(conversationPostOutcome(new ApiError(404, 'Conversation not found'))).toBe('gone');
    expect(conversationPostOutcome(new ApiError(422, 'Too long'))).toBe('refused');
    expect(conversationPostOutcome(new ApiError(403, 'Forbidden'))).toBe('refused');
  });
});

describe('conversationAccess', () => {
  it('reads 404/403 as no longer a participant and anything else as retryable', () => {
    expect(conversationAccess(null)).toBe('open');
    expect(conversationAccess(new ApiError(404, 'Conversation not found'))).toBe('unavailable');
    expect(conversationAccess(new ApiError(403, 'Forbidden'))).toBe('unavailable');
    expect(conversationAccess(new TypeError('offline'))).toBe('error');
  });
});

describe('draftAlreadyPosted', () => {
  it('recognises a draft the server stored before the answer was lost', () => {
    const mine = message(id(7), 'x', { is_mine: true });
    expect(draftAlreadyPosted([mine], id(7))).toBe(true);
    expect(draftAlreadyPosted([message(id(7), 'x')], id(7))).toBe(false);
    expect(draftAlreadyPosted([mine], id(8))).toBe(false);
  });
});

describe('conversationNotificationTarget', () => {
  it('opens the conversation only for chat notifications that carry one', () => {
    expect(conversationNotificationTarget({ type: 'conversation_message', conversation_id: CONVERSATION })).toBe(CONVERSATION);
    expect(conversationNotificationTarget({ type: 'conversation_mention', conversation_id: CONVERSATION })).toBe(CONVERSATION);
    expect(conversationNotificationTarget({ type: 'conversation_reply', conversation_id: CONVERSATION })).toBe(CONVERSATION);
    expect(conversationNotificationTarget({ type: 'conversation_message', conversation_id: null })).toBeNull();
    expect(conversationNotificationTarget({ type: 'plan_updated', conversation_id: CONVERSATION })).toBeNull();
  });
});

describe('chatStartableTeams', () => {
  const teams = [
    { id: 'band', service_type_id: 'st', members: [{ user_id: 'me' }] },
    { id: 'prod', service_type_id: 'st', members: [{ user_id: 'other' }] },
    { id: 'hosp', service_type_id: 'st', members: [{ user_id: null }] },
  ];

  it('lists own teams plus teams the caller schedules or manages', () => {
    expect(chatStartableTeams(teams, 'me', (team) => team.id === 'prod').map((t) => t.id)).toEqual(['band', 'prod']);
    expect(chatStartableTeams(teams, null, () => false)).toEqual([]);
  });
});

describe('schema agreement', () => {
  it('uses the same search minimum as the query schema', () => {
    expect(conversationMessagesQuerySchema.safeParse({ q: 'a'.repeat(CONVERSATION_SEARCH_MIN - 1) }).success).toBe(false);
    expect(conversationMessagesQuerySchema.safeParse({ q: 'a'.repeat(CONVERSATION_SEARCH_MIN) }).success).toBe(true);
  });

  it('accepts a reply with mentions as one message body', () => {
    expect(postConversationMessageSchema.safeParse({ id: id(1), body: '@Sam yes', reply_to_id: id(2), mention_person_ids: [id(3)] }).success).toBe(true);
  });
});
