import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import type { Db } from '../lib/supabase.js';

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const KEY = 'a'.repeat(64);

interface RpcResult {
  data: string | null;
  error: { code: string; message: string } | null;
}

describe('GET /api/v1/realtime/key', () => {
  let app: Express;
  let result: RpcResult;
  const rpc = vi.fn((_fn: string, _args: { p_org: string }): Promise<RpcResult> => Promise.resolve(result));

  beforeAll(async () => {
    const { realtimeRouter } = await import('./realtime.js');
    const { errorHandler } = await import('../middleware/error-handler.js');
    app = express();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.db = { rpc } as unknown as Db;
      req.orgId = ORG_ID;
      next();
    });
    app.use('/api/v1/realtime', realtimeRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    rpc.mockClear();
    result = { data: KEY, error: null };
  });

  it('serves the active organization key and forbids caching', async () => {
    const res = await request(app).get('/api/v1/realtime/key');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ key: KEY });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(rpc.mock.calls).toEqual([['realtime_topic_key', { p_org: ORG_ID }]]);
  });

  it('answers 404 when the database withholds the key from a removed member', async () => {
    result = { data: null, error: null };
    const res = await request(app).get('/api/v1/realtime/key');
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(KEY);
  });

  it('surfaces a database failure as an error', async () => {
    result = { data: null, error: { code: 'XX000', message: 'boom' } };
    const res = await request(app).get('/api/v1/realtime/key');
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});

const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ID = '33333333-3333-4333-8333-333333333333';
const TOPIC = `conversation:${CONVERSATION_ID}:${KEY}:${'b'.repeat(64)}`;

interface TopicsRpcResult {
  data: { resource_id: string; topic: string }[] | null;
  error: { code: string; message: string } | null;
}

describe('POST /api/v1/realtime/topics', () => {
  let app: Express;
  let result: TopicsRpcResult;
  const rpc = vi.fn((_fn: string, _args: { p_org: string; p_resource: string; p_ids: string[] }): Promise<TopicsRpcResult> =>
    Promise.resolve(result));

  beforeAll(async () => {
    const { realtimeRouter } = await import('./realtime.js');
    const { errorHandler } = await import('../middleware/error-handler.js');
    app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.db = { rpc } as unknown as Db;
      req.orgId = ORG_ID;
      next();
    });
    app.use('/api/v1/realtime', realtimeRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    rpc.mockClear();
    result = { data: [{ resource_id: CONVERSATION_ID, topic: TOPIC }], error: null };
  });

  it('asks the database as the caller and returns only the topics it grants', async () => {
    const res = await request(app)
      .post('/api/v1/realtime/topics')
      .send({ resource: 'conversation', ids: [CONVERSATION_ID, OTHER_ID] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ topics: { [CONVERSATION_ID]: TOPIC } });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(rpc.mock.calls).toEqual([[
      'realtime_resource_topics',
      { p_org: ORG_ID, p_resource: 'conversation', p_ids: [CONVERSATION_ID, OTHER_ID] },
    ]]);
  });

  it('answers an empty map, not an error, for a resource the caller lost', async () => {
    result = { data: [], error: null };
    const res = await request(app)
      .post('/api/v1/realtime/topics')
      .send({ resource: 'conversation', ids: [CONVERSATION_ID] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ topics: {} });
  });

  it.each([
    ['an unknown resource', { resource: 'plan', ids: [CONVERSATION_ID] }],
    ['a malformed id', { resource: 'conversation', ids: ['nope'] }],
    ['too many ids', { resource: 'conversation', ids: Array.from({ length: 101 }, () => CONVERSATION_ID) }],
    ['a missing resource', { ids: [CONVERSATION_ID] }],
  ])('rejects %s without calling the database', async (_label, body) => {
    const res = await request(app).post('/api/v1/realtime/topics').send(body);
    expect(res.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('surfaces a database failure as an error', async () => {
    result = { data: null, error: { code: 'XX000', message: 'boom' } };
    const res = await request(app)
      .post('/api/v1/realtime/topics')
      .send({ resource: 'live_plan', ids: [CONVERSATION_ID] });
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
