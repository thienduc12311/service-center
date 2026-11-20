import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import type { Db } from '../lib/supabase.js';

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';

/** W7-RESP-D1 / W7-ACC-D4: a delete that removes nothing is a 404, not a 204. */

interface DeleteState {
  deletedRows: Array<{ id: string }>;
}

const ID = '22222222-2222-4222-8222-222222222222';
const ORG = '11111111-1111-4111-8111-111111111111';

const fakeDb = (state: DeleteState): Db => {
  const chain: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data: state.deletedRows, error: null }).then(resolve, reject),
  };
  for (const method of ['eq', 'select']) chain[method] = () => chain;
  return { from: () => ({ delete: () => chain }) } as unknown as Db;
};

describe('DELETE routes report what they removed', () => {
  let state: DeleteState;
  let app: Express;

  beforeAll(async () => {
    const { assignmentsRouter } = await import('./assignments.js');
    const { teamsRouter } = await import('./teams.js');
    const { errorHandler } = await import('../middleware/error-handler.js');
    app = express();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.auth = { userId: 'user-1', email: 'sam@example.test', accessToken: 'token' };
      req.db = fakeDb(state);
      req.orgId = ORG;
      req.orgRole = 'owner';
      req.access = {
        organization_id: ORG, user_id: 'user-1', role: 'owner', access_mode: 'legacy', can_administer_access: true,
        entries: (['teams.manage', 'scheduling.manage'] as const).map((capability) => ({
          capability, scope_type: 'organization' as const, scope_id: null, source: 'role:owner', grant_id: null,
        })),
      };
      next();
    });
    app.use('/assignments', assignmentsRouter);
    app.use('/teams', teamsRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    state = { deletedRows: [] };
  });

  const paths = [`/assignments/${ID}`, `/teams/${ID}`, `/teams/${ID}/positions/${ID}`];

  it.each(paths)('DELETE %s answers 404 when no row was deleted', async (path) => {
    const res = await request(app).delete(path);
    expect(res.status).toBe(404);
  });

  it.each(paths)('DELETE %s answers 204 when a row was deleted', async (path) => {
    state.deletedRows = [{ id: ID }];
    const res = await request(app).delete(path);
    expect(res.status).toBe(204);
  });
});
