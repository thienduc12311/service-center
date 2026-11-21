import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import type { Db } from '../lib/supabase.js';

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';

/** W8-RT-D2: the DELETE routes outside wave 7's list also report what they removed. */

interface DeleteState {
  deletedRows: Array<Record<string, string>>;
}

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const fakeDb = (state: DeleteState): Db => {
  const chain: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data: state.deletedRows, error: null }).then(resolve, reject),
  };
  for (const method of ['eq', 'select']) chain[method] = () => chain;
  return { from: () => ({ delete: () => chain }) } as unknown as Db;
};

describe('DELETE devices, blocks and members', () => {
  let state: DeleteState;
  let app: Express;

  beforeAll(async () => {
    const { meRouter } = await import('./me.js');
    const { devicesRouter } = await import('./notifications.js');
    const { peopleRouter } = await import('./people.js');
    const { errorHandler } = await import('../middleware/error-handler.js');
    app = express();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.auth = { userId: 'user-1', email: 'sam@example.test', accessToken: 'token' };
      req.db = fakeDb(state);
      req.orgId = ORG;
      req.orgRole = 'owner';
      next();
    });
    app.use('/me/devices', devicesRouter);
    app.use('/me', meRouter);
    app.use('/people', peopleRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    state = { deletedRows: [] };
  });

  const paths = [`/me/devices/ExponentPushToken-abc`, `/me/blocks/${OTHER}`, `/people/members/${OTHER}`];

  it.each(paths)('DELETE %s answers 404 when nothing was deleted', async (path) => {
    const res = await request(app).delete(path);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it.each(paths)('DELETE %s answers 204 when a row was deleted', async (path) => {
    state.deletedRows = [{ id: OTHER }];
    const res = await request(app).delete(path);
    expect(res.status).toBe(204);
  });
});
