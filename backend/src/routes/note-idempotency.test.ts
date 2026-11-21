import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import type { PlanNoteRow } from '@service-center/shared';
import type { Db } from '../lib/supabase.js';

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';

/** W8-RES-D3: keyed note create. The database decides replay; the route maps it to 200/201 and a stable 409. */

const ORG = '11111111-1111-4111-8111-111111111111';
const PLAN = '33333333-3333-4333-8333-333333333333';
const NOTE = '44444444-4444-4444-8444-444444444444';
const KEY = 'note-draft-key-0001';

const noteRow: PlanNoteRow = {
  id: NOTE, organization_id: ORG, plan_id: PLAN, plan_item_id: null, category_id: null, audience: 'organization',
  body: 'Doors at 8', is_legacy: false, revision: 1, created_by: 'user-1', updated_by: 'user-1',
  created_at: '2026-11-20T00:00:00Z', updated_at: '2026-11-20T00:00:00Z',
  idempotency_key: KEY, idempotency_request: { body: 'Doors at 8' },
};

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

interface FakeState {
  calls: RpcCall[];
  rpcResult: { data: unknown; error: { code: string; message: string; hint?: string } | null };
}

const fakeDb = (state: FakeState): Db => {
  const chain: Record<string, unknown> = {
    maybeSingle: () => Promise.resolve({ data: { id: PLAN, service_type_id: null }, error: null }),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve, reject),
  };
  for (const method of ['select', 'eq', 'in']) chain[method] = () => chain;
  return {
    from: () => chain,
    rpc: (name: string, args: Record<string, unknown>) => {
      state.calls.push({ name, args });
      return Promise.resolve(state.rpcResult);
    },
  } as unknown as Db;
};

describe('POST /plans/:planId/notes idempotency', () => {
  let state: FakeState;
  let app: Express;

  beforeAll(async () => {
    const { planNotesRouter } = await import('./collaboration.js');
    const { errorHandler } = await import('../middleware/error-handler.js');
    app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.auth = { userId: 'user-1', email: 'sam@example.test', accessToken: 'token' };
      req.db = fakeDb(state);
      req.orgId = ORG;
      req.orgRole = 'owner';
      req.access = {
        organization_id: ORG, user_id: 'user-1', role: 'owner', access_mode: 'legacy', can_administer_access: true,
        entries: [{ capability: 'plans.edit', scope_type: 'organization', scope_id: null, source: 'role:owner', grant_id: null }],
      };
      next();
    });
    app.use('/plans/:planId/notes', planNotesRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    state = { calls: [], rpcResult: { data: { note: noteRow, replayed: false }, error: null } };
  });

  const body = { audience: 'organization', body: 'Doors at 8', idempotency_key: KEY };

  it('passes the key to the database and answers 201 for a new note, without leaking the key', async () => {
    const res = await request(app).post(`/plans/${PLAN}/notes`).send(body);
    expect(res.status).toBe(201);
    expect(state.calls[0]?.args.p_idempotency_key).toBe(KEY);
    expect(res.body.id).toBe(NOTE);
    expect(res.body).not.toHaveProperty('idempotency_key');
    expect(res.body).not.toHaveProperty('idempotency_request');
  });

  it('answers 200 with the original note when the database reports a replay', async () => {
    state.rpcResult = { data: { note: noteRow, replayed: true }, error: null };
    const res = await request(app).post(`/plans/${PLAN}/notes`).send(body);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(NOTE);
  });

  it('answers 409 idempotency_key_reused for the same key with another body', async () => {
    state.rpcResult = {
      data: null,
      error: { code: 'PT409', message: 'That idempotency key was used for a different note', hint: 'idempotency_key_reused' },
    };
    const res = await request(app).post(`/plans/${PLAN}/notes`).send({ ...body, body: 'Different' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('idempotency_key_reused');
  });

  it('sends no key for an unkeyed create (older clients)', async () => {
    const res = await request(app).post(`/plans/${PLAN}/notes`).send({ audience: 'organization', body: 'x' });
    expect(res.status).toBe(201);
    expect(state.calls[0]?.args.p_idempotency_key).toBeNull();
  });

  it('rejects a too-short key before the database', async () => {
    const res = await request(app).post(`/plans/${PLAN}/notes`).send({ ...body, idempotency_key: 'short' });
    expect(res.status).toBe(422);
    expect(state.calls).toHaveLength(0);
  });

  it('ignores the key on an edit', async () => {
    const res = await request(app).put(`/plans/${PLAN}/notes/${NOTE}`).send({ ...body, expected_revision: 1 });
    expect(res.status).toBe(200);
    expect(state.calls[0]?.args.p_idempotency_key).toBeNull();
    expect(vi.isMockFunction(fakeDb)).toBe(false);
  });
});
