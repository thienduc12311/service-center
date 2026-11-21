import { describe, expect, it } from 'vitest';
import {
  decodeConversationCursor,
  encodeConversationCursor,
  flattenConversationPages,
  toConversationListPage,
  type ConversationListRow,
} from './conversations.js';
import { listConversationsQuerySchema } from '../schemas/collaboration.js';

describe('conversation list paging (W8-PERF-D3)', () => {
  const summary = (n: number, last: string | null): ConversationListRow => ({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    kind: 'plan',
    team_id: null,
    plan_id: null,
    title: `Plan ${n}`,
    service_date: null,
    last_message_at: last,
    unread_count: 0,
    muted: false,
    can_moderate: false,
    open_reports: 0,
    created_at: '2026-01-01T00:00:00.000Z',
  });

  it('round-trips a cursor, including a conversation with no messages', () => {
    const cursor = { last: null, created: '2026-01-01T00:00:00.000Z', id: '00000000-0000-4000-8000-000000000001' };
    expect(decodeConversationCursor(encodeConversationCursor(cursor))).toEqual(cursor);
    const withLast = { ...cursor, last: '2026-02-01T10:00:00.000Z' };
    expect(decodeConversationCursor(encodeConversationCursor(withLast))).toEqual(withLast);
  });

  it('rejects forged or malformed cursors', () => {
    expect(decodeConversationCursor('not-a-cursor')).toBeNull();
    expect(decodeConversationCursor(encodeConversationCursor({ last: 'x', created: 'y', id: 'z' }))).toBeNull();
    expect(decodeConversationCursor(btoa('[]'))).toBeNull();
  });

  it('reports has_more only when an extra row exists and strips created_at', () => {
    const rows = [1, 2, 3].map((n) => summary(n, '2026-02-01T10:00:00.000Z'));
    const first = toConversationListPage(rows, 2);
    expect(first.items.map((item) => item.title)).toEqual(['Plan 1', 'Plan 2']);
    expect(first.items[0]).not.toHaveProperty('created_at');
    expect(first.has_more).toBe(true);
    expect(decodeConversationCursor(first.next_cursor ?? '')?.id).toBe(rows[1]?.id);

    const last = toConversationListPage(rows, 3);
    expect(last).toMatchObject({ has_more: false, next_cursor: null });
    expect(last.items).toHaveLength(3);
  });

  it('flattens pages without repeating a conversation', () => {
    const a = toConversationListPage([1, 2].map((n) => summary(n, null)), 5);
    const b = toConversationListPage([2, 3].map((n) => summary(n, null)), 5);
    expect(flattenConversationPages([a, b]).map((item) => item.title)).toEqual(['Plan 1', 'Plan 2', 'Plan 3']);
  });

  it('validates the list query', () => {
    expect(listConversationsQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(listConversationsQuerySchema.parse({ limit: '25', cursor: 'abc' })).toEqual({ limit: 25, cursor: 'abc' });
    expect(() => listConversationsQuerySchema.parse({ limit: '101' })).toThrow();
  });
});
