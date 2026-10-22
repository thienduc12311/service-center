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
 * HTTP contract of `PATCH /api/v1/me` (`updateMe`), the profile save both
 * clients use (MOB-021). The database is a fake; RLS on `profiles` keeps a
 * caller to their own row in the real database.
 */

interface ProfileState {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
}

interface FakeDbState {
  profile: ProfileState | null;
  updates: { values: Record<string, unknown>; id: unknown }[];
}

const fakeDb = (state: FakeDbState): Db => {
  const rpc = (fn: string) => {
    if (fn !== 'my_profile') throw new Error(`unexpected rpc ${fn}`);
    return Promise.resolve({ data: state.profile, error: null });
  };
  const from = (table: string) => {
    if (table !== 'profiles') throw new Error(`unexpected table ${table}`);
    return {
      update: (values: Record<string, unknown>) => ({
        eq: (_column: string, id: unknown) => ({
          select: () => ({
            maybeSingle: () => {
              state.updates.push({ values, id });
              if (!state.profile || state.profile.id !== id) return Promise.resolve({ data: null, error: null });
              state.profile = { ...state.profile, ...values };
              return Promise.resolve({ data: { id }, error: null });
            },
          }),
        }),
      }),
    };
  };
  return { rpc, from } as unknown as Db;
};

describe('PATCH /api/v1/me', () => {
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

  const reset = (profile: ProfileState | null = {
    id: 'user-1',
    email: 'sam@example.test',
    full_name: 'Sam',
    phone: '555',
    avatar_url: null,
  }): void => {
    state = { profile, updates: [] };
  };

  it('saves name and phone on the caller’s own row and returns the read-back profile', async () => {
    reset();
    const res = await request(app).patch('/api/v1/me').send({ full_name: 'Sam Lee', phone: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'user-1', full_name: 'Sam Lee', phone: null });
    expect(state.updates).toEqual([{ values: { full_name: 'Sam Lee', phone: null }, id: 'user-1' }]);
  });

  it('rejects a blank name without writing', async () => {
    reset();
    const res = await request(app).patch('/api/v1/me').send({ full_name: '   ' });
    expect(res.status).toBe(422);
    expect(state.updates).toEqual([]);
  });

  it('never writes fields outside the shared schema', async () => {
    reset();
    const res = await request(app).patch('/api/v1/me').send({ full_name: 'Sam', email: 'other@example.test', id: 'user-2' });
    expect(res.status).toBe(200);
    expect(state.updates[0]?.values).toEqual({ full_name: 'Sam' });
    expect(state.updates[0]?.id).toBe('user-1');
  });

  it('answers 404 when the row is not visible to the caller', async () => {
    reset(null);
    const res = await request(app).patch('/api/v1/me').send({ full_name: 'Sam' });
    expect(res.status).toBe(404);
  });
});
