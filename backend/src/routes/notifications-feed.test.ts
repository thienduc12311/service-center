import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import type { Db } from '../lib/supabase.js';

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';

/**
 * W7-MSG-D1 / D3: the cursor the feed issues must be accepted verbatim by the
 * next request, and must carry the row id so tied timestamps are not skipped.
 */

interface FeedRow {
  id: string;
  created_at: string;
}

interface FeedState {
  rows: FeedRow[];
  filters: Array<[string, ...unknown[]]>;
}

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const TIED_AT = '2026-11-20T22:07:16.512152+00:00';

const fakeDb = (state: FeedState): Db => {
  const chain: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data: state.rows, error: null, count: 0 }).then(resolve, reject),
  };
  for (const method of ['eq', 'is', 'or', 'order', 'limit']) {
    chain[method] = (...args: unknown[]) => {
      state.filters.push([method, ...args]);
      return chain;
    };
  }
  return { from: () => ({ select: () => chain }) } as unknown as Db;
};

describe('GET /notifications cursor', () => {
  let state: FeedState;
  let app: Express;

  beforeAll(async () => {
    const { notificationsRouter } = await import('./notifications.js');
    const { errorHandler } = await import('../middleware/error-handler.js');
    app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.auth = { userId: 'user-1', email: 'sam@example.test', accessToken: 'token' };
      req.db = fakeDb(state);
      req.orgId = ORG_ID;
      next();
    });
    app.use('/api/v1/notifications', notificationsRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    state = {
      rows: [
        { id: '33333333-3333-4333-8333-333333333333', created_at: TIED_AT },
        { id: '22222222-2222-4222-8222-222222222222', created_at: TIED_AT },
      ],
      filters: [],
    };
  });

  it('accepts the next_cursor it issued (PostgREST +00:00 offset)', async () => {
    const first = await request(app).get('/api/v1/notifications?limit=2');
    expect(first.status).toBe(200);
    const cursor = first.body.next_cursor as string;
    expect(cursor).toBe(`${TIED_AT}~22222222-2222-4222-8222-222222222222`);

    state.filters = [];
    const second = await request(app).get('/api/v1/notifications').query({ limit: 2, before: cursor });
    expect(second.status).toBe(200);
    expect(state.filters).toContainEqual([
      'or',
      `created_at.lt."${TIED_AT}",and(created_at.eq."${TIED_AT}",id.lt.22222222-2222-4222-8222-222222222222)`,
    ]);
  });

  it('keeps accepting a legacy timestamp-only cursor', async () => {
    const res = await request(app).get('/api/v1/notifications').query({ before: TIED_AT });
    expect(res.status).toBe(200);
    expect(state.filters).toContainEqual(['or', `created_at.lt."${TIED_AT}"`]);
  });

  it('rejects a malformed cursor as a validation error', async () => {
    const res = await request(app).get('/api/v1/notifications').query({ before: 'yesterday' });
    expect(res.status).toBe(422);
  });
});
