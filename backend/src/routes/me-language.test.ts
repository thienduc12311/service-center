import { beforeAll, describe, expect, it } from 'vitest';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import type { Db } from '../lib/supabase.js';

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';
process.env.CRON_SECRET ||= 'test-worker-secret-long-enough';

/**
 * HTTP contract of the self-service language routes, with the database
 * replaced by a fake. Authorization itself is enforced by the database
 * functions and covered by supabase/tests/i18n-preferred-language.sql
 * against a real database.
 */

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

interface FakeDbState {
  memberships: string[];
  /** Saved value per organization; absent = no linked Person there. */
  people: Map<string, string | null>;
  rpcError?: { code: string; message: string };
  calls: RpcCall[];
}

const fakeDb = (state: FakeDbState): Db => {
  const rpc = (fn: string, args: Record<string, unknown>) => {
    state.calls.push({ fn, args });
    if (state.rpcError) return Promise.resolve({ data: null, error: state.rpcError });
    const org = String(args.p_organization_id);
    if (!state.memberships.includes(org)) {
      return Promise.resolve({ data: null, error: { code: 'P0002', message: 'Organization not found' } });
    }
    if (!state.people.has(org)) return Promise.resolve({ data: [{ person_linked: false, preferred_language: null }], error: null });
    if (fn === 'set_my_language_preference') state.people.set(org, (args.p_preferred_language as string | null) ?? null);
    return Promise.resolve({ data: [{ person_linked: true, preferred_language: state.people.get(org) ?? null }], error: null });
  };
  const from = () => ({
    select: () => ({
      eq: () => ({
        eq: () => Promise.resolve({ data: state.memberships.map((organization_id) => ({ organization_id })), error: null }),
      }),
    }),
  });
  return { rpc, from } as unknown as Db;
};

describe('/api/v1/me/language-preference', () => {
  let state: FakeDbState;
  let app: Express;

  beforeAll(async () => {
    const { meRouter } = await import('./me.js');
    const { errorHandler } = await import('../middleware/error-handler.js');
    app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.auth = { userId: 'user-1', email: 'sam@example.test', accessToken: 'token' };
      req.db = fakeDb(state);
      next();
    });
    app.use('/api/v1/me', meRouter);
    app.use(errorHandler);
  });

  const reset = (overrides: Partial<FakeDbState> = {}): void => {
    state = { memberships: ['org-a', 'org-b'], people: new Map([['org-a', 'vi'], ['org-b', null]]), calls: [], ...overrides };
  };

  it('returns the saved value for the church in X-Organization-Id', async () => {
    reset();
    const res = await request(app).get('/api/v1/me/language-preference').set('X-Organization-Id', 'org-a');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ preferred_language: 'vi', person_linked: true });
    expect(state.calls).toEqual([{ fn: 'my_language_preference', args: { p_organization_id: 'org-a' } }]);
  });

  it('keeps churches independent', async () => {
    reset();
    const res = await request(app).get('/api/v1/me/language-preference').set('X-Organization-Id', 'org-b');
    expect(res.body).toEqual({ preferred_language: null, person_linked: true });
  });

  it('returns null with person_linked false for a member without a linked Person', async () => {
    reset({ people: new Map() });
    const res = await request(app).get('/api/v1/me/language-preference').set('X-Organization-Id', 'org-a');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ preferred_language: null, person_linked: false });
  });

  it('saves a canonical code and returns the persisted value', async () => {
    reset();
    const res = await request(app).patch('/api/v1/me/language-preference').set('X-Organization-Id', 'org-b').send({ preferred_language: 'vi' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ preferred_language: 'vi', person_linked: true });
    expect(state.calls[0]).toEqual({ fn: 'set_my_language_preference', args: { p_organization_id: 'org-b', p_preferred_language: 'vi' } });
    expect(state.people.get('org-a')).toBe('vi');
  });

  it('clears to Automatic with an explicit null', async () => {
    reset();
    const res = await request(app).patch('/api/v1/me/language-preference').set('X-Organization-Id', 'org-a').send({ preferred_language: null });
    expect(res.status).toBe(200);
    expect(res.body.preferred_language).toBeNull();
  });

  it.each([
    ['a regional tag', { preferred_language: 'vi-VN' }],
    ['an unsupported language', { preferred_language: 'fr' }],
    ['a missing field', {}],
    ['another Person field', { preferred_language: 'vi', first_name: 'Mallory' }],
    ['a Person id', { preferred_language: 'vi', person_id: 'someone-else' }],
  ])('rejects %s before touching the database', async (_label, body) => {
    reset();
    const res = await request(app).patch('/api/v1/me/language-preference').set('X-Organization-Id', 'org-a').send(body);
    expect(res.status).toBe(422);
    expect(state.calls).toHaveLength(0);
  });

  it('answers PERSON_LINK_REQUIRED instead of creating a Person', async () => {
    reset({ people: new Map() });
    const res = await request(app).patch('/api/v1/me/language-preference').set('X-Organization-Id', 'org-a').send({ preferred_language: 'vi' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PERSON_LINK_REQUIRED');
  });

  it('reads an inactive or foreign church as not found', async () => {
    reset();
    const res = await request(app).patch('/api/v1/me/language-preference').set('X-Organization-Id', 'org-x').send({ preferred_language: 'vi' });
    expect(res.status).toBe(404);
  });

  it('infers the only church, and asks for one when there are several', async () => {
    reset({ memberships: ['org-a'] });
    const single = await request(app).get('/api/v1/me/language-preference');
    expect(single.body.preferred_language).toBe('vi');
    reset();
    const several = await request(app).get('/api/v1/me/language-preference');
    expect(several.status).toBe(400);
    expect(several.body.code).toBe('organization_required');
  });

  it('reports an unexpected database failure as a 500 (clients show a generic message)', async () => {
    reset({ rpcError: { code: 'XX000', message: 'relation "people" is broken' } });
    const res = await request(app).get('/api/v1/me/language-preference').set('X-Organization-Id', 'org-a');
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('XX000');
  });
});
