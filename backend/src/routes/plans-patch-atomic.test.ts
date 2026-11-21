import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import type { EffectiveAccess } from '@service-center/shared';
import type { Db } from '../lib/supabase.js';

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';
process.env.CRON_SECRET ||= 'test-worker-secret-long-enough';

vi.mock('../services/plans.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/plans.js')>()),
  fetchPlanDetail: vi.fn(async (_db: Db, _org: string, id: string) => ({ id })),
}));
vi.mock('../services/delivery-worker.js', () => ({ deliverEffectNow: vi.fn(async () => undefined) }));

/**
 * W8-RES-D4 / W8-RT-D1: `PATCH /plans/:id` writes the plan fields and the time
 * list through ONE rpc (`update_plan_with_times`), never two independent
 * writes. The real transaction semantics are asserted in
 * supabase/tests/qa-wave8-db.sql.
 */

const ORG = '00000000-0000-4000-8000-000000000001';
const PLAN = '00000000-0000-4000-8000-0000000000c1';

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

interface RpcFailure {
  code: string;
  message: string;
  hint?: string;
}

interface FakeState {
  rpcs: RpcCall[];
  plainUpdates: number;
  rpcError: RpcFailure | null;
}

const fakeDb = (state: FakeState): Db => {
  const single = { data: { id: PLAN, location: null, organization_id: ORG, content_revision: 7 }, error: null };
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.single = () => Promise.resolve(single);
  chain.update = () => {
    state.plainUpdates += 1;
    return chain;
  };
  return {
    from: () => chain,
    rpc: (name: string, args: Record<string, unknown>) => {
      state.rpcs.push({ name, args });
      if (state.rpcError) return Promise.resolve({ data: null, error: state.rpcError });
      return Promise.resolve({ data: { invalidated_requests: 0, notified_assignment_ids: [], effect_id: null }, error: null });
    },
  } as unknown as Db;
};

const editorAccess: EffectiveAccess = {
  organization_id: ORG,
  user_id: 'user-1',
  role: 'admin',
  access_mode: 'scoped',
  can_administer_access: true,
  entries: [{ capability: 'plans.edit', scope_type: 'organization', scope_id: null, source: 'role:admin', grant_id: null }],
};

describe('PATCH /plans/:id is atomic', () => {
  let state: FakeState;
  let app: Express;

  beforeAll(async () => {
    const { plansRouter } = await import('./plans.js');
    const { errorHandler } = await import('../middleware/error-handler.js');
    app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.auth = { userId: 'user-1', email: 'sam@example.test', accessToken: 'token' };
      req.db = fakeDb(state);
      req.orgId = ORG;
      req.access = editorAccess;
      next();
    });
    app.use('/api/v1/plans', plansRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    state = { rpcs: [], plainUpdates: 0, rpcError: null };
  });

  const TIMES = [
    {
      id: '00000000-0000-4000-8000-0000000000d1',
      kind: 'service',
      name: 'Main',
      starts_at: '2026-12-06T09:00:00.000Z',
      ends_at: '2026-12-06T10:00:00.000Z',
    },
  ];

  it('sends fields and times in a single rpc and performs no separate plans update', async () => {
    const res = await request(app)
      .patch(`/api/v1/plans/${PLAN}`)
      .send({ title: 'Advent', service_date: '2026-12-13T09:00:00.000Z', times: TIMES, expected_revision: 7 });
    expect(res.status).toBe(200);
    expect(state.plainUpdates).toBe(0);
    expect(state.rpcs).toHaveLength(1);
    const call = state.rpcs[0];
    expect(call?.name).toBe('update_plan_with_times');
    expect(call?.args.p_fields).toMatchObject({ title: 'Advent', service_date: '2026-12-13T09:00:00.000Z' });
    expect(call?.args.p_expected_revision).toBe(7);
    expect(Array.isArray(call?.args.p_times)).toBe(true);
  });

  it('passes a null time list when only fields change', async () => {
    const res = await request(app).patch(`/api/v1/plans/${PLAN}`).send({ title: 'Renamed' });
    expect(res.status).toBe(200);
    expect(state.rpcs).toHaveLength(1);
    expect(state.rpcs[0]?.args.p_times).toBeNull();
    expect(state.rpcs[0]?.args.p_fields).toEqual({ title: 'Renamed' });
  });

  it('surfaces a failed combined write as one error (nothing was split off)', async () => {
    state.rpcError = { code: 'PT409', message: 'The plan changed since you opened it', hint: 'plan_changed' };
    const res = await request(app).patch(`/api/v1/plans/${PLAN}`).send({ title: 'Advent', times: TIMES, expected_revision: 3 });
    expect(res.status).toBe(409);
    expect(state.rpcs).toHaveLength(1);
    expect(state.plainUpdates).toBe(0);
  });
});
