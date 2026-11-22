import { beforeAll, describe, expect, it } from 'vitest';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import type { EffectiveAccess } from '@service-center/shared';
import type { Db } from '../lib/supabase.js';

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';
process.env.CRON_SECRET ||= 'test-worker-secret-long-enough';

/**
 * W10-SEC-D1/D2: an absurd `page` on the paged lists is refused with 422
 * before any query runs — never 500, never the first page under another label.
 */
const ORG = '00000000-0000-4000-8000-000000000001';

const access: EffectiveAccess = {
  organization_id: ORG,
  user_id: 'user-1',
  role: 'owner',
  access_mode: 'legacy',
  can_administer_access: true,
  entries: [],
};

/** Any database access fails the test: validation must answer first. */
const untouchableDb = new Proxy({}, {
  get: () => {
    throw new Error('the database must not be reached');
  },
}) as Db;

describe('paged list bounds', () => {
  let app: Express;

  beforeAll(async () => {
    const { plansRouter } = await import('./plans.js');
    const { songsRouter } = await import('./songs.js');
    const { errorHandler } = await import('../middleware/error-handler.js');
    app = express();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.auth = { userId: 'user-1', email: 'owner@example.test', accessToken: 'token' };
      req.db = untouchableDb;
      req.orgId = ORG;
      req.orgRole = 'owner';
      req.access = access;
      next();
    });
    app.use('/api/v1/plans', plansRouter);
    app.use('/api/v1/songs', songsRouter);
    app.use(errorHandler);
  });

  for (const list of ['plans', 'songs']) {
    for (const page of ['99999999999999999999', '1e21', '9007199254740993', '100001', '0']) {
      it(`GET /${list}?page=${page} answers 422`, async () => {
        const res = await request(app).get(`/api/v1/${list}`).query({ page });
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('unprocessable');
      });
    }
  }
});
