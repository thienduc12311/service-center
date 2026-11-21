import { ACCOUNT_BLOCKED } from '@service-center/shared';
import express, { type Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    SUPABASE_URL: 'http://supabase.test',
    SUPABASE_ANON_KEY: 'test-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    isTest: true,
  },
}));

describe('requireAuth', () => {
  const fetchAuth = vi.fn<typeof fetch>();
  const token = 'fixture-access-token';
  const user = { id: 'b8c55ba4-10c2-4bdc-92cf-6665babf2548', email: 'member@example.test' };
  let app: Express;

  beforeAll(async () => {
    vi.stubGlobal('fetch', fetchAuth);
    const { requireAuth } = await import('./auth.js');
    const { errorHandler } = await import('./error-handler.js');
    app = express();
    app.get('/', requireAuth, (req, res) => {
      res.json({ id: req.auth.userId, email: req.auth.email });
    });
    app.use(errorHandler);
  });

  afterAll(() => vi.unstubAllGlobals());
  beforeEach(() => fetchAuth.mockReset());

  const getProtectedRoute = () => request(app).get('/').set('Authorization', `Bearer ${token}`);

  it.each(['session_not_found', 'user_not_found', 'user_banned'])(
    'rechecks Auth on replay and returns 401 when Auth reports %s',
    async (code) => {
      fetchAuth.mockResolvedValueOnce(Response.json(user));
      fetchAuth.mockResolvedValueOnce(Response.json({ code, msg: 'Denied' }, { status: 403 }));

      const before = await getProtectedRoute();
      expect(before.status).toBe(200);
      expect(before.body).toEqual(user);

      const after = await getProtectedRoute();
      expect(after.status).toBe(401);
      expect(after.body.code).toBe('unauthorized');

      expect(fetchAuth).toHaveBeenCalledTimes(2);
      for (const [url, options] of fetchAuth.mock.calls) {
        expect(url).toBe('http://supabase.test/auth/v1/user');
        expect(options?.method).toBe('GET');
        expect(new Headers(options?.headers).get('Authorization')).toBe(`Bearer ${token}`);
      }
    },
  );

  it('returns account_blocked when Auth returns a user with a current ban', async () => {
    fetchAuth.mockResolvedValueOnce(Response.json({
      ...user,
      banned_until: new Date(Date.now() + 60_000).toISOString(),
    }));

    const response = await getProtectedRoute();
    expect(response.status).toBe(401);
    expect(response.body.code).toBe(ACCOUNT_BLOCKED);
  });

  it.each([
    ['a network failure', () => Promise.reject(new TypeError('fetch failed'))],
    ['an Auth 502', () => Promise.resolve(Response.json({ msg: 'bad gateway' }, { status: 502 }))],
    ['an Auth 500', () => Promise.resolve(Response.json({ msg: 'boom' }, { status: 500 }))],
  ])('answers 503 auth_unavailable, not 401, on %s (W8-RES-D2)', async (_name, respond) => {
    fetchAuth.mockImplementationOnce(respond);
    const response = await getProtectedRoute();
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('auth_unavailable');
  });

  it('still answers 401 for an expired token', async () => {
    fetchAuth.mockResolvedValueOnce(Response.json({ code: 'bad_jwt', msg: 'invalid JWT: token is expired' }, { status: 401 }));
    const response = await getProtectedRoute();
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('unauthorized');
  });
});
