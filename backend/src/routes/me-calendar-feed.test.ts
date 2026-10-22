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
 * HTTP contract of the personal calendar link (`getCalendarFeed` /
 * `rotateCalendarFeed`), which the website Settings and the native
 * subscription screen (MOB-022) both use. The database is a fake; RLS keeps
 * a caller to their own token rows in the real database.
 */

interface TokenState {
  id: string;
  organization_id: string;
  user_id: string;
  token_hash: string;
  revoked_at: string | null;
}

interface FakeDbState {
  memberships: { organization_id: string }[];
  tokens: TokenState[];
}

type Filter = [column: string, value: unknown];

const matches = (row: TokenState, filters: readonly Filter[]): boolean =>
  filters.every(([column, value]) => (row as unknown as Record<string, unknown>)[column] === value);

const fakeDb = (state: FakeDbState): Db => {
  const tokensTable = () => {
    const filters: Filter[] = [];
    let patch: Partial<TokenState> | null = null;
    const builder = {
      select: () => builder,
      update: (values: Partial<TokenState>) => {
        patch = values;
        return builder;
      },
      insert: (values: Omit<TokenState, 'id' | 'revoked_at'>) => {
        state.tokens.push({ ...values, id: `token-${state.tokens.length + 1}`, revoked_at: null });
        return Promise.resolve({ data: null, error: null });
      },
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return builder;
      },
      is: (column: string, value: unknown) => {
        filters.push([column, value]);
        return builder;
      },
      maybeSingle: () => {
        const row = state.tokens.find((token) => matches(token, filters));
        return Promise.resolve({ data: row ? { id: row.id } : null, error: null });
      },
      then: (resolve: (value: { data: null; error: null }) => void) => {
        if (patch) for (const token of state.tokens) if (matches(token, filters)) Object.assign(token, patch);
        resolve({ data: null, error: null });
      },
    };
    return builder;
  };
  const membersTable = () => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      then: (resolve: (value: { data: FakeDbState['memberships']; error: null }) => void) =>
        resolve({ data: state.memberships, error: null }),
    };
    return builder;
  };
  const from = (table: string) => {
    if (table === 'calendar_feed_tokens') return tokensTable();
    if (table === 'organization_members') return membersTable();
    throw new Error(`unexpected table ${table}`);
  };
  return { from } as unknown as Db;
};

describe('/api/v1/me/calendar-feed', () => {
  let state: FakeDbState;
  let app: Express;

  beforeAll(async () => {
    const { meRouter } = await import('./me.js');
    const { errorHandler } = await import('../middleware/error-handler.js');
    app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.auth = { userId: 'user-1', email: 'riley@example.test', accessToken: 'token' };
      req.db = fakeDb(state);
      next();
    });
    app.use('/api/v1/me', meRouter);
    app.use(errorHandler);
  });

  const reset = (memberships = [{ organization_id: 'org-1' }]): void => {
    state = { memberships, tokens: [] };
  };

  it('reports no link, never a URL, and is not cacheable', async () => {
    reset();
    const res = await request(app).get('/api/v1/me/calendar-feed');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: null, webcal_url: null, active: false });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('returns the new URL once, revokes the previous link, and later reads only say it is active', async () => {
    reset();
    const first = await request(app).post('/api/v1/me/calendar-feed').send({});
    expect(first.status).toBe(201);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.body.url).toMatch(/\/api\/v1\/calendar-feed\/[A-Za-z0-9_-]+\.ics$/);
    expect(first.body.webcal_url).toBe(String(first.body.url).replace(/^https?:\/\//, 'webcal://'));

    const second = await request(app).post('/api/v1/me/calendar-feed').send({});
    expect(second.body.url).not.toBe(first.body.url);
    expect(state.tokens.map((token) => token.revoked_at === null)).toEqual([false, true]);
    // The stored value is a hash, never the token in the URL.
    expect(state.tokens.some((token) => String(second.body.url).includes(token.token_hash))).toBe(false);

    const status = await request(app).get('/api/v1/me/calendar-feed');
    expect(status.body).toEqual({ url: null, webcal_url: null, active: true });
  });

  it('uses the organization header and refuses one the caller is not an active member of', async () => {
    reset([{ organization_id: 'org-1' }, { organization_id: 'org-2' }]);
    expect((await request(app).get('/api/v1/me/calendar-feed')).status).toBe(400);
    const res = await request(app).post('/api/v1/me/calendar-feed').set('X-Organization-Id', 'org-2').send({});
    expect(res.status).toBe(201);
    expect(state.tokens[0]?.organization_id).toBe('org-2');
    expect((await request(app).get('/api/v1/me/calendar-feed').set('X-Organization-Id', 'org-3')).status).toBe(400);
  });
});
