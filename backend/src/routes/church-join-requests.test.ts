import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import type { CreateChurchJoinRequestInput, DeclineChurchJoinRequestInput, OrgRole } from '@service-center/shared';
import type { Db } from '../lib/supabase.js';

/**
 * Join-request routes: input is validated and normalized before the service
 * runs, and the church side is for owners only. The services are fakes; the
 * database checks the owner again (see supabase/tests/church-join-requests.sql).
 */

const fixture = vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
  process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';
  return {
    lookups: [] as string[],
    created: [] as CreateChurchJoinRequestInput[],
    approved: [] as string[],
    declined: [] as Array<{ id: string; input: DeclineChurchJoinRequestInput }>,
  };
});

vi.mock('../services/church-join-requests.js', () => ({
  lookupChurch: async (_caller: unknown, slug: string) => {
    fixture.lookups.push(slug);
    return { id: 'org-1', name: 'Riverside', slug };
  },
  listMyJoinRequests: async () => [],
  requestToJoin: async (_caller: unknown, input: CreateChurchJoinRequestInput) => {
    fixture.created.push(input);
    return { id: 'req-1', status: 'pending' };
  },
  withdrawMyJoinRequest: async (_caller: unknown, id: string) => ({ id, status: 'withdrawn' }),
  listChurchJoinRequests: async () => ({ pending: [], recent: [] }),
  approveJoinRequest: async (_caller: unknown, id: string) => {
    fixture.approved.push(id);
    return { request: { id, status: 'approved' }, invitation_sent: true, invite_url: 'http://localhost/accept-invite?token=t' };
  },
  declineJoinRequest: async (_caller: unknown, id: string, input: DeclineChurchJoinRequestInput) => {
    fixture.declined.push({ id, input });
    return { id, status: 'declined' };
  },
}));

const REQUEST_ID = '0f6c4a6e-2a35-4d55-9a3f-5d1f2e1d9a10';
let role: OrgRole = 'owner';
let app: Express;

beforeAll(async () => {
  const { churchJoinRequestsOwnerRouter, churchJoinRequestsRouter } = await import('./church-join-requests.js');
  const { errorHandler } = await import('../middleware/error-handler.js');
  app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: 'user-1', email: 'jo@example.test', accessToken: 'token' };
    req.db = {} as unknown as Db;
    req.orgId = 'org-1';
    req.orgRole = role;
    req.access = {
      organization_id: 'org-1',
      user_id: 'user-1',
      role,
      access_mode: 'legacy',
      can_administer_access: false,
      entries: [{ capability: 'people.manage', scope_type: 'organization', scope_id: null, source: 'grant', grant_id: 'grant' }],
    };
    next();
  });
  app.use('/api/v1/church-join-requests', churchJoinRequestsRouter);
  app.use('/api/v1/people/join-requests', churchJoinRequestsOwnerRouter);
  app.use(errorHandler);
});

beforeEach(() => {
  role = 'owner';
  fixture.lookups = [];
  fixture.created = [];
  fixture.approved = [];
  fixture.declined = [];
});

describe('/api/v1/church-join-requests', () => {
  it('normalizes the slug before looking it up', async () => {
    const response = await request(app).get('/api/v1/church-join-requests/lookup').query({ slug: ' Riverside ' });
    expect(response.status).toBe(200);
    expect(fixture.lookups).toEqual(['riverside']);
  });

  it('refuses something that is not a slug', async () => {
    const response = await request(app).get('/api/v1/church-join-requests/lookup').query({ slug: 'not a slug!' });
    expect(response.status).toBe(422);
    expect(fixture.lookups).toEqual([]);
  });

  it('creates a request with a trimmed message, and none when blank', async () => {
    expect((await request(app).post('/api/v1/church-join-requests').send({ slug: 'riverside', message: '  Hi  ' })).status).toBe(201);
    expect((await request(app).post('/api/v1/church-join-requests').send({ slug: 'riverside', message: '' })).status).toBe(201);
    expect(fixture.created).toEqual([
      { slug: 'riverside', message: 'Hi' },
      { slug: 'riverside', message: null },
    ]);
  });

  it('refuses a message over 500 characters', async () => {
    const response = await request(app).post('/api/v1/church-join-requests').send({ slug: 'riverside', message: 'x'.repeat(501) });
    expect(response.status).toBe(422);
  });

  it('refuses a request id that is not a uuid', async () => {
    expect((await request(app).post('/api/v1/church-join-requests/nope/withdraw')).status).toBe(422);
    expect((await request(app).post(`/api/v1/church-join-requests/${REQUEST_ID}/withdraw`)).status).toBe(200);
  });
});

describe('/api/v1/people/join-requests', () => {
  for (const nonOwner of ['admin', 'scheduler', 'member'] as const) {
    it(`refuses ${nonOwner}s even with people.manage`, async () => {
      role = nonOwner;
      for (const [method, path] of [
        ['get', ''],
        ['post', `/${REQUEST_ID}/approve`],
        ['post', `/${REQUEST_ID}/decline`],
      ] as const) {
        const response = await request(app)[method](`/api/v1/people/join-requests${path}`).send({});
        expect(response.status, `${method} ${path}`).toBe(403);
      }
      expect(fixture.approved).toEqual([]);
      expect(fixture.declined).toEqual([]);
    });
  }

  it('lets the owner list, approve and decline', async () => {
    expect((await request(app).get('/api/v1/people/join-requests')).body).toEqual({ pending: [], recent: [] });
    const approved = await request(app).post(`/api/v1/people/join-requests/${REQUEST_ID}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.invite_url).toContain('/accept-invite?token=');
    const declined = await request(app).post(`/api/v1/people/join-requests/${REQUEST_ID}/decline`).send({ reason: '  Not now ' });
    expect(declined.status).toBe(200);
    expect(fixture.approved).toEqual([REQUEST_ID]);
    expect(fixture.declined).toEqual([{ id: REQUEST_ID, input: { reason: 'Not now' } }]);
  });
});
