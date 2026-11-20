import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import type { Db } from '../lib/supabase.js';

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';

/**
 * HTTP contract of notification clean-up, with the database replaced by a
 * recording fake. That a user can only delete their own rows is enforced by
 * the `notifications_delete` RLS policy; these tests pin the extra filters
 * the routes add so deletes stay inside the active organization.
 */

type FilterCall = [method: string, ...args: unknown[]];

interface RecordedQuery {
  table: string;
  operation: 'select' | 'delete' | 'update';
  options: unknown;
  filters: FilterCall[];
}

interface QueryResult {
  data: unknown;
  error: { code: string; message: string } | null;
  count: number | null;
}

interface FakeDbState {
  queries: RecordedQuery[];
  deleteResult: QueryResult;
  unread: number;
  accountUnread: number;
}

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const NOTIFICATION_ID = '22222222-2222-4222-8222-222222222222';

const fakeDb = (state: FakeDbState): Db => {
  const builder = (query: RecordedQuery): unknown => {
    const result = (): QueryResult => {
      if (query.operation === 'delete') return state.deleteResult;
      const scoped = query.filters.some(([method, column]) => method === 'eq' && column === 'organization_id');
      return { data: null, error: null, count: scoped ? state.unread : state.accountUnread };
    };
    const chain: Record<string, unknown> = {
      then: (resolve: (value: QueryResult) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve, reject),
    };
    for (const method of ['eq', 'is', 'not', 'in', 'lt', 'order', 'limit']) {
      chain[method] = (...args: unknown[]) => {
        query.filters.push([method, ...args]);
        return chain;
      };
    }
    return chain;
  };
  const from = (table: string) => {
    const start = (operation: RecordedQuery['operation']) => (...args: unknown[]) => {
      const query: RecordedQuery = { table, operation, options: args[args.length - 1], filters: [] };
      state.queries.push(query);
      return builder(query);
    };
    return { select: start('select'), delete: start('delete'), update: start('update') };
  };
  return { from } as unknown as Db;
};

describe('notification clean-up routes', () => {
  let state: FakeDbState;
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
      queries: [],
      deleteResult: { data: null, error: null, count: 3 },
      unread: 2,
      accountUnread: 5,
    };
  });

  const deletes = (): RecordedQuery[] => state.queries.filter((query) => query.operation === 'delete');

  it('deletes one notification scoped to the caller and the active organization', async () => {
    const res = await request(app).delete(`/api/v1/notifications/${NOTIFICATION_ID}`);
    expect(res.status).toBe(204);
    expect(deletes()).toHaveLength(1);
    expect(deletes()[0]?.filters).toEqual([
      ['eq', 'id', NOTIFICATION_ID],
      ['eq', 'organization_id', ORG_ID],
      ['eq', 'user_id', 'user-1'],
    ]);
  });

  it('rejects a malformed id before touching the database', async () => {
    const res = await request(app).delete('/api/v1/notifications/not-a-uuid');
    expect(res.status).toBe(400);
    expect(state.queries).toHaveLength(0);
  });

  it('clears only read notifications in the active organization and returns fresh counts', async () => {
    const res = await request(app).post('/api/v1/notifications/clear-read');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: 3, unread: 2, account_unread: 5 });

    expect(deletes()).toHaveLength(1);
    const [clear] = deletes();
    expect(clear?.options).toEqual({ count: 'exact' });
    expect(clear?.filters).toEqual([
      ['eq', 'organization_id', ORG_ID],
      ['eq', 'user_id', 'user-1'],
      ['not', 'read_at', 'is', null],
    ]);
  });

  it('reports zero when nothing was read', async () => {
    state.deleteResult = { data: null, error: null, count: null };
    const res = await request(app).post('/api/v1/notifications/clear-read');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(0);
  });

  it('surfaces a database failure as an error, not a silent success', async () => {
    state.deleteResult = { data: null, error: { code: 'XX000', message: 'boom' }, count: null };
    const res = await request(app).post('/api/v1/notifications/clear-read');
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
