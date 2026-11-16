import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import type { AdminOverview } from '@service-center/shared';

/**
 * The super-admin guard on `/api/v1/admin`: platform admins only, and a
 * two-factor session for everything except `GET /session`. The services are
 * fakes; the database functions check the actor again.
 */

const fixture = vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
  process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';
  return { admins: new Set<string>(), purges: 0, approvals: [] as Array<{ id: string; slug: string }> };
});

vi.mock('../services/platform-admin.js', () => ({
  isPlatformAdmin: async (userId: string) => fixture.admins.has(userId),
  purgeExpiredPlatformAccess: async () => {
    fixture.purges += 1;
    return 0;
  },
  getOverview: async (): Promise<AdminOverview> => ({
    churches: { total: 2, active: 1, disabled: 1 },
    pending_applications: 3,
    accounts: 10,
    storage_used_bytes: 1024,
  }),
  approveApplication: async (_actor: unknown, id: string, slug: string) => {
    fixture.approvals.push({ id, slug });
    return { id, status: 'approved' };
  },
}));

const token = (aal: 'aal1' | 'aal2'): string =>
  ['h', Buffer.from(JSON.stringify({ sub: 'user-1', aal })).toString('base64url'), 's'].join('.');

let app: Express;
let session = { userId: 'user-1', aal: 'aal2' as 'aal1' | 'aal2' };

beforeAll(async () => {
  const { adminRouter } = await import('./admin.js');
  const { errorHandler } = await import('../middleware/error-handler.js');
  app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: session.userId, email: 'pat@example.test', accessToken: token(session.aal) };
    next();
  });
  app.use('/api/v1/admin', adminRouter);
  app.use(errorHandler);
});

beforeEach(() => {
  fixture.admins = new Set(['user-1']);
  fixture.purges = 0;
  fixture.approvals = [];
  session = { userId: 'user-1', aal: 'aal2' };
});

describe('/api/v1/admin guard', () => {
  it('refuses someone who is not a platform admin', async () => {
    fixture.admins.clear();
    const response = await request(app).get('/api/v1/admin/overview');
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('not_platform_admin');
  });

  it('refuses a platform admin without two-factor login', async () => {
    session.aal = 'aal1';
    const response = await request(app).get('/api/v1/admin/overview');
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('mfa_required');
  });

  it('answers /session before two-factor login so the app can ask for it', async () => {
    session.aal = 'aal1';
    const response = await request(app).get('/api/v1/admin/session');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ user_id: 'user-1', email: 'pat@example.test', aal: 'aal1', mfa_required: true });
  });

  it('serves a two-factor platform admin and clears expired access first', async () => {
    const response = await request(app).get('/api/v1/admin/overview');
    expect(response.status).toBe(200);
    expect(response.body.pending_applications).toBe(3);
    expect(fixture.purges).toBe(1);
  });

  it('validates the slug before approving', async () => {
    const id = '0f6c4a6e-2a35-4d55-9a3f-5d1f2e1d9a10';
    const bad = await request(app).post(`/api/v1/admin/church-applications/${id}/approve`).send({ slug: 'Not A Slug!' });
    expect(bad.status).toBe(422);
    const good = await request(app).post(`/api/v1/admin/church-applications/${id}/approve`).send({ slug: ' Grace-ATL ' });
    expect(good.status).toBe(200);
    expect(fixture.approvals).toEqual([{ id, slug: 'grace-atl' }]);
  });

  it('refuses an application id that is not a uuid', async () => {
    const response = await request(app).post('/api/v1/admin/church-applications/nope/approve').send({ slug: 'grace' });
    expect(response.status).toBe(422);
  });
});
