import { createClient } from '@supabase/supabase-js';
import express, { type Express } from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ConversationMessageRow, ConversationSummary, Database } from '@service-center/shared';

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';
process.env.CRON_SECRET ||= 'test-worker-secret-long-enough';

const orgId = 'aaaaaaaa-0000-4000-8000-000000000001';
const threadId = 'bbbbbbbb-0000-4000-8000-000000000001';
const guessedId = 'bbbbbbbb-0000-4000-8000-000000000002';
const userId = 'cccccccc-0000-4000-8000-000000000001';
const authorId = 'dddddddd-0000-4000-8000-000000000001';
const otherPersonId = 'dddddddd-0000-4000-8000-000000000002';
const message: ConversationMessageRow = {
  id: 'eeeeeeee-0000-4000-8000-000000000001',
  organization_id: orgId,
  conversation_id: threadId,
  author_id: userId,
  author_person_id: authorId,
  reply_to_id: null,
  body: 'Hello',
  edited_at: null,
  deleted_at: null,
  hidden_at: null,
  hidden_by: null,
  created_at: '2026-11-19T12:00:00.000Z',
};
const summary: ConversationSummary = {
  id: threadId,
  kind: 'plan',
  title: 'Sunday rehearsal',
  team_id: null,
  plan_id: 'ffffffff-0000-4000-8000-000000000001',
  service_date: '2026-11-22T16:00:00.000Z',
  last_message_at: message.created_at,
  unread_count: 2,
  muted: true,
  can_moderate: true,
  open_reports: 0,
};

let createApp: (fetchDb: typeof fetch) => Express;
beforeAll(async () => {
  const { conversationsRouter, planItemCommentsRouter } = await import('./collaboration.js');
  const { errorHandler } = await import('../middleware/error-handler.js');
  createApp = (fetchDb) => {
    const app = express();
    app.use(express.json());
    const db = createClient<Database>('http://db.example.test', 'test-key', {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: fetchDb },
    });
    app.use((req, _res, next) => {
      req.orgId = orgId;
      req.auth = { userId, email: null, accessToken: 'test-token' };
      req.db = db;
      next();
    });
    app.use('/conversations', conversationsRouter);
    app.use('/plan-items', planItemCommentsRouter);
    app.use(errorHandler);
    return app;
  };
});

describe('Conversation reads', () => {
  it('loads a thread summary once and starts independent lookups together', async () => {
    let releaseMessages!: () => void;
    let releaseMentions!: () => void;
    const messages = new Promise<void>((resolve) => { releaseMessages = resolve; });
    const mentions = new Promise<void>((resolve) => { releaseMentions = resolve; });
    const fetchDb = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      switch (url.pathname) {
        case '/rest/v1/rpc/my_conversation':
          return Response.json([summary]);
        case '/rest/v1/conversation_messages':
          await messages;
          return Response.json([message]);
        case '/rest/v1/conversation_message_reports':
          return Response.json([]);
        case '/rest/v1/conversation_message_mentions':
          await mentions;
          return Response.json([
            { person_id: otherPersonId, message_id: message.id, resolution: 'no_login' },
            { person_id: authorId, message_id: message.id, resolution: 'notified' },
          ]);
        case '/rest/v1/people_directory':
          return Response.json(url.searchParams.get('id') === `in.(${authorId})`
            ? [{ id: authorId, profile_id: userId, first_name: 'Pat', last_name: 'Jones' }]
            : [{ id: otherPersonId, profile_id: null, first_name: 'Alex', last_name: null }]);
        default:
          throw new Error(`Unexpected database call: ${url.pathname}`);
      }
    });
    const paths = () => fetchDb.mock.calls.map(([input]) => new URL(String(input)));
    const response = request(createApp(fetchDb)).get(`/conversations/${threadId}`).then((result) => result);
    try {
      await vi.waitFor(() => expect(paths().map((url) => url.pathname).sort()).toEqual([
        '/rest/v1/conversation_message_reports', '/rest/v1/conversation_messages', '/rest/v1/rpc/my_conversation',
      ]));
      releaseMessages();
      await vi.waitFor(() => expect(paths().slice(3).map((url) => url.pathname).sort()).toEqual([
        '/rest/v1/conversation_message_mentions', '/rest/v1/people_directory',
      ]));
    } finally {
      releaseMessages();
      releaseMentions();
    }
    const result = await response;
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      conversation: summary,
      messages: {
        data: [{
          ...message,
          author_name: 'Pat Jones',
          is_mine: true,
          mentions: [
            { person_id: otherPersonId, name: 'Alex', resolution: 'no_login', is_me: false },
            { person_id: authorId, name: 'Pat Jones', resolution: 'notified', is_me: true },
          ],
        }],
        next_before: null,
      },
      reports: [],
    });
    expect(JSON.parse(String(fetchDb.mock.calls[0]?.[1]?.body))).toEqual({
      p_organization_id: orgId,
      p_conversation_id: threadId,
    });
    expect(paths().filter((url) => url.pathname === '/rest/v1/people_directory').map((url) => url.searchParams.get('id')))
      .toEqual([`in.(${authorId})`, `in.(${otherPersonId})`]);
    expect(paths()).toHaveLength(6);
  });

  it('checks standalone messages once per request and returns the same 404 after revocation or for a guessed id', async () => {
    let active = true;
    const fetchDb = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/rest/v1/rpc/my_conversation') {
        return Response.json(active && JSON.parse(String(init?.body)).p_conversation_id === threadId ? [summary] : []);
      }
      if (url.pathname === '/rest/v1/conversation_messages') return Response.json([]);
      throw new Error(`Unexpected database call: ${url.pathname}`);
    });
    const app = createApp(fetchDb);
    const path = `/conversations/${threadId}/messages`;
    const result = await request(app).get(`${path}?q=hello&limit=3`);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ data: [], next_before: null });
    const calls = fetchDb.mock.calls.map(([input]) => new URL(String(input)));
    expect(calls.map((url) => url.pathname)).toEqual(['/rest/v1/rpc/my_conversation', '/rest/v1/conversation_messages']);
    expect(calls[1]?.searchParams.get('search')).toBe('plfts(simple).hello');
    expect(calls[1]?.searchParams.get('limit')).toBe('4');

    active = false;
    for (const denied of [path, `/conversations/${threadId}`, `/conversations/${guessedId}`]) {
      fetchDb.mockClear();
      const response = await request(app).get(denied);
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Conversation not found', code: 'not_found' });
      expect(fetchDb.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual(['/rest/v1/rpc/my_conversation']);
    }
  });
});

describe('Conversation writes in another organization (W7-MSG-D2)', () => {
  it('answer 404 and change nothing when the thread is not in the active organization', async () => {
    const fetchDb = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/rest/v1/conversations') return Response.json([]);
      if (url.pathname === '/rest/v1/conversation_message_reports') return Response.json([]);
      throw new Error(`Unexpected database call: ${url.pathname}`);
    });
    const app = createApp(fetchDb);
    const base = `/conversations/${threadId}`;
    const reportId = 'bbbbbbbb-0000-4000-8000-000000000020';
    const messageId = message.id;
    const attempts = [
      request(app).post(`${base}/messages`).send({ id: messageId, body: 'hi' }),
      request(app).patch(`${base}/messages/${messageId}`).send({ body: 'edited' }),
      request(app).delete(`${base}/messages/${messageId}`),
      request(app).post(`${base}/messages/${messageId}/restore`),
      request(app).post(`${base}/messages/${messageId}/report`).send({ reason: 'spam' }),
      request(app).post(`${base}/read`).send({ read_at: '2026-11-20T10:00:00Z' }),
      request(app).put(`${base}/mute`).send({ muted: true }),
      request(app).post(`${base}/reports/${reportId}/resolve`).send({ action: 'dismiss' }),
    ];
    for (const attempt of attempts) {
      const response = await attempt;
      expect(response.status).toBe(404);
    }
    const urls = fetchDb.mock.calls.map(([input]) => new URL(String(input)));
    // A cheap row lookup, never the unread-counting summary RPC.
    expect([...new Set(urls.map((url) => url.pathname))]).toEqual(['/rest/v1/conversations', '/rest/v1/conversation_message_reports']);
    for (const url of urls) expect(url.searchParams.get('organization_id')).toBe(`eq.${orgId}`);
  });
});

describe('Item comment writes through the wrong item (W7-MSG-D10)', () => {
  it('answer 404 before the edit or delete function runs', async () => {
    const itemId = 'bbbbbbbb-0000-4000-8000-000000000010';
    const commentId = 'bbbbbbbb-0000-4000-8000-000000000011';
    const fetchDb = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/rest/v1/plan_items') return Response.json({ id: itemId, plan_id: 'ffffffff-0000-4000-8000-000000000001' });
      if (url.pathname === '/rest/v1/rpc/can_read_item_thread') return Response.json(true);
      if (url.pathname === '/rest/v1/plan_item_comments') return Response.json(null);
      throw new Error(`Unexpected database call: ${url.pathname}`);
    });
    const app = createApp(fetchDb);
    const path = `/plan-items/${itemId}/comments/${commentId}`;
    expect((await request(app).patch(path).send({ body: 'wrong path edit' })).status).toBe(404);
    expect((await request(app).delete(path).send({})).status).toBe(404);
    const paths = fetchDb.mock.calls.map(([input]) => new URL(String(input)).pathname);
    expect(paths.some((entry) => entry.startsWith('/rest/v1/rpc/edit_item_comment') || entry.startsWith('/rest/v1/rpc/delete_item_comment'))).toBe(false);
  });
});

describe('Conversation list paging (W8-PERF-D3)', () => {
  const row = (n: number): ConversationSummary & { created_at: string } => ({
    ...summary,
    id: `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`,
    title: `Chat ${n}`,
    created_at: '2026-11-01T00:00:00.000Z',
  });

  /** A database with 230 conversations that honours the paging arguments like the SQL function. */
  const pagingDb = () => {
    const all = Array.from({ length: 230 }, (_, index) => row(index + 1));
    return vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname !== '/rest/v1/rpc/my_conversations_page') throw new Error(`Unexpected database call: ${url.pathname}`);
      const args = JSON.parse(String(init?.body)) as { p_limit: number; p_after_id: string | null };
      const start = args.p_after_id ? all.findIndex((entry) => entry.id === args.p_after_id) + 1 : 0;
      return Response.json(all.slice(start, start + args.p_limit));
    });
  };

  it('reaches every conversation past the old 100-row cap without loss or repeats', async () => {
    const app = createApp(pagingDb());
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const result: request.Response = await request(app).get('/conversations').query({ limit: 100, ...(cursor ? { cursor } : {}) });
      expect(result.status).toBe(200);
      seen.push(...(result.body.items as ConversationSummary[]).map((item) => item.id));
      expect(result.body.items[0]).not.toHaveProperty('created_at');
      cursor = result.body.next_cursor as string | null;
      expect(result.body.has_more).toBe(cursor !== null);
      pages += 1;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(230);
    expect(new Set(seen).size).toBe(230);
  });

  it('asks the database for one extra row and sends the cursor of the last returned row', async () => {
    const fetchDb = pagingDb();
    await request(createApp(fetchDb)).get('/conversations').query({ limit: 20 });
    const [, init] = fetchDb.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toMatchObject({ p_organization_id: orgId, p_limit: 21, p_after_id: null });
  });

  it('rejects a cursor it did not issue', async () => {
    const fetchDb = pagingDb();
    const result = await request(createApp(fetchDb)).get('/conversations').query({ cursor: 'forged' });
    expect(result.status).toBe(400);
    expect(fetchDb).not.toHaveBeenCalled();
  });

  it('answers an app build from before paging (no cursor, no limit) with the whole plain array', async () => {
    const result = await request(createApp(pagingDb())).get('/conversations');
    expect(result.status).toBe(200);
    expect(Array.isArray(result.body)).toBe(true);
    const items = result.body as ConversationSummary[];
    expect(items).toHaveLength(230);
    expect(new Set(items.map((item) => item.id)).size).toBe(230);
    const { created_at: _createdAt, ...first } = row(1);
    expect(items[0]).toEqual(first);
  });

  it('answers the paged shape as soon as either limit or cursor is sent', async () => {
    const limitOnly = await request(createApp(pagingDb())).get('/conversations').query({ limit: 50 });
    expect(limitOnly.body).toMatchObject({ has_more: true });
    expect(limitOnly.body.items).toHaveLength(50);
    const cursor = limitOnly.body.next_cursor as string;
    const cursorOnly = await request(createApp(pagingDb())).get('/conversations').query({ cursor });
    expect(cursorOnly.body.items).toHaveLength(50);
    expect(cursorOnly.body.items[0].id).toBe(row(51).id);
  });
});
