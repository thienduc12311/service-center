import { beforeAll, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import type { OrgRole } from '@service-center/shared';
import type { Db } from '../lib/supabase.js';

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';
process.env.CRON_SECRET ||= 'test-worker-secret-long-enough';

/** W7-ACC-D2: membership rows are owner-only in RLS, so the route says so with a 403. */
const OTHER_USER = '2f1c7a52-8b1e-4c39-9d43-5a6f0e1b2c3d';

describe('PATCH /access/members/:userId', () => {
  let app: Express;
  let role: OrgRole = 'member';
  const from = vi.fn(() => { throw new Error('Database reached'); });

  beforeAll(async () => {
    const { accessRouter } = await import('./access.js');
    const { errorHandler } = await import('../middleware/error-handler.js');
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.orgRole = role;
      req.orgId = 'org';
      req.auth = { userId: 'self', email: 'self@example.test', accessToken: 'token' };
      req.access = { organization_id: 'org', user_id: 'self', role, access_mode: 'legacy', can_administer_access: role === 'owner' || role === 'admin', entries: [] };
      req.db = { from } as unknown as Db;
      next();
    });
    app.use('/access', accessRouter);
    app.use(errorHandler);
  });

  for (const nonOwner of ['admin', 'scheduler', 'member'] as const) {
    it(`refuses ${nonOwner} with a 403 before touching the database`, async () => {
      role = nonOwner;
      from.mockClear();
      const response = await request(app).patch(`/access/members/${OTHER_USER}`).send({ access_mode: 'scoped' });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('forbidden');
      expect(from).not.toHaveBeenCalled();
    });
  }

  it('lets the owner through to the update', async () => {
    role = 'owner';
    from.mockClear();
    await request(app).patch(`/access/members/${OTHER_USER}`).send({ access_mode: 'scoped' });
    expect(from).toHaveBeenCalledWith('organization_members');
  });

  it('keeps the member list available to admins', async () => {
    role = 'admin';
    from.mockClear();
    await request(app).get('/access/members');
    expect(from).toHaveBeenCalled();
  });
});
