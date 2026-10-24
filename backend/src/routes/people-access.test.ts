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

describe('People owner-only access', () => {
  let app: Express;
  let role: OrgRole = 'member';
  const from = vi.fn(() => { throw new Error('Database reached'); });
  beforeAll(async () => {
    const { peopleRouter } = await import('./people.js');
    const { errorHandler } = await import('../middleware/error-handler.js');
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.orgRole = role;
      req.orgId = 'org';
      req.auth = { userId: 'self', email: 'self@example.test', accessToken: 'token' };
      req.access = { organization_id: 'org', user_id: 'self', role, access_mode: 'legacy', can_administer_access: false,
        entries: [{ capability: 'people.manage', scope_type: 'organization', scope_id: null, source: 'grant', grant_id: 'grant' }] };
      req.db = { from } as unknown as Db;
      next();
    });
    app.use('/people', peopleRouter);
    app.use(errorHandler);
  });
  it('allows the owner through to the detail handler', async () => {
    role = 'owner';
    from.mockClear();
    await request(app).get('/people/person');
    expect(from).toHaveBeenCalledWith('people');
  });

  it('keeps the directory endpoint available to members', async () => {
    role = 'member';
    from.mockClear();
    await request(app).get('/people');
    expect(from).toHaveBeenCalledWith('organization_members');
  });

  for (const nonOwner of ['admin', 'scheduler', 'member'] as const) {
    it(`denies ${nonOwner} personal details and changes even with people.manage`, async () => {
      role = nonOwner;
      from.mockClear();
      for (const [method, path] of [
        ['get', '/person'], ['patch', '/person'], ['post', '/'], ['post', '/person/archive'],
        ['post', '/person/restore'], ['delete', '/person'], ['post', '/person/invitations'],
        ['patch', '/members/other'], ['delete', '/members/other'], ['get', '/person/tags'],
        ['put', '/person/tags'], ['get', '/members/other/eligibility'], ['post', '/eligibility'],
        ['post', '/from-member/other'],
      ] as const) {
        const response = await request(app)[method](`/people${path}`).send({});
        expect(response.status, `${method} ${path}`).toBe(403);
      }
      expect(from).not.toHaveBeenCalled();
    });
  }
});
