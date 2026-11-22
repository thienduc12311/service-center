import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import type { EffectiveAccess } from '@service-center/shared';
import type { Db } from '../lib/supabase.js';

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';
process.env.CRON_SECRET ||= 'test-worker-secret-long-enough';

/**
 * `DELETE /plans/:id/items` clears the whole order through one
 * `clear_plan_items` call. The fake below behaves like that function (editor
 * check, live-run guard, revision check, then every item or none), so these
 * tests assert what a client observes. The real transaction, RLS and cascade
 * are asserted in supabase/tests/order-clear.sql.
 */

const ORG = '00000000-0000-4000-8000-000000000001';
const PLAN = '00000000-0000-4000-8000-0000000000c1';

/** The plan as the fake database holds it. */
interface StoredOrder {
  itemIds: string[];
  contentRevision: number;
  /** Whether the caller may edit this plan (RLS / `can_edit_plan`). */
  editable: boolean;
  /** A live or paused run of the plan. */
  live: boolean;
}

interface RpcFailure {
  code: string;
  message: string;
  hint?: string;
}

interface ClearArgs {
  p_plan_id: string;
  p_expected_revision: number | null;
}

interface RpcResult {
  data: { removed: number; content_revision: number } | null;
  error: RpcFailure | null;
}

interface RpcCall {
  name: string;
  args: ClearArgs;
}

const store: { order: StoredOrder; calls: RpcCall[] } = {
  order: { itemIds: [], contentRevision: 0, editable: true, live: false },
  calls: [],
};

/** Mirrors clear_plan_items. */
const clearPlanItems = (args: ClearArgs): RpcResult => {
  const order = store.order;
  if (args.p_plan_id !== PLAN || !order.editable) return { data: null, error: { code: 'P0002', message: 'Plan not found' } };
  if (order.live) {
    return { data: null, error: { code: 'PT409', message: 'This plan is running live.', hint: 'live_run_active' } };
  }
  if (order.itemIds.length === 0) return { data: { removed: 0, content_revision: order.contentRevision }, error: null };
  if (args.p_expected_revision !== null && args.p_expected_revision !== order.contentRevision) {
    return { data: null, error: { code: 'PT409', message: 'This plan changed since you opened it.', hint: 'plan_changed' } };
  }
  const removed = order.itemIds.length;
  store.order = { ...order, itemIds: [], contentRevision: order.contentRevision + removed };
  return { data: { removed, content_revision: store.order.contentRevision }, error: null };
};

const fakeDb = (): Db =>
  ({
    rpc: (name: string, args: ClearArgs) => {
      store.calls.push({ name, args });
      if (name !== 'clear_plan_items') return Promise.resolve({ data: null, error: { code: 'XX000', message: `unexpected ${name}` } });
      return Promise.resolve(clearPlanItems(args));
    },
  }) as unknown as Db;

/** An admin who edits plans, or a member with only an unrelated capability. */
const accessWith = (canEditPlans: boolean): EffectiveAccess => ({
  organization_id: ORG,
  user_id: 'user-1',
  role: canEditPlans ? 'admin' : 'member',
  access_mode: 'scoped',
  can_administer_access: canEditPlans,
  entries: canEditPlans
    ? [{ capability: 'plans.edit', scope_type: 'organization', scope_id: null, source: 'role:admin', grant_id: null }]
    : [{ capability: 'songs.manage', scope_type: 'organization', scope_id: null, source: 'grant', grant_id: 'grant-1' }],
});

describe('DELETE /plans/:id/items clears the order', () => {
  let app: Express;
  let access: EffectiveAccess;

  beforeAll(async () => {
    const { plansRouter } = await import('./plans.js');
    const { errorHandler } = await import('../middleware/error-handler.js');
    app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.auth = { userId: 'user-1', email: 'sam@example.test', accessToken: 'token' };
      req.db = fakeDb();
      req.orgId = ORG;
      req.access = access;
      next();
    });
    app.use('/api/v1/plans', plansRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    access = accessWith(true);
    store.order = { itemIds: ['i-1', 'i-2', 'i-3'], contentRevision: 7, editable: true, live: false };
    store.calls = [];
  });

  const clear = (query = '') => request(app).delete(`/api/v1/plans/${PLAN}/items${query}`);

  it('removes every item in one call and answers the count and new revision', async () => {
    const res = await clear('?expected_revision=7');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ removed: 3, content_revision: 10 });
    expect(store.order.itemIds).toEqual([]);
    expect(store.calls).toEqual([{ name: 'clear_plan_items', args: { p_plan_id: PLAN, p_expected_revision: 7 } }]);
  });

  it('sends no revision when none is given', async () => {
    const res = await clear();
    expect(res.status).toBe(200);
    expect(store.calls[0]?.args.p_expected_revision).toBeNull();
  });

  it('answers a retry of a clear that already happened with success, not a conflict', async () => {
    await clear('?expected_revision=7');
    const retried = await clear('?expected_revision=7');
    expect(retried.status).toBe(200);
    expect(retried.body).toEqual({ removed: 0, content_revision: 10 });
  });

  it('refuses a stale revision with 409 plan_revision_stale and keeps the order', async () => {
    const res = await clear('?expected_revision=3');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('plan_revision_stale');
    expect(store.order.itemIds).toHaveLength(3);
  });

  it('refuses with 409 live_run_active while the plan runs live', async () => {
    store.order.live = true;
    const res = await clear('?expected_revision=7');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('live_run_active');
    expect(store.order.itemIds).toHaveLength(3);
  });

  it('is forbidden without the plans.edit capability, before touching the database', async () => {
    access = accessWith(false);
    const res = await clear();
    expect(res.status).toBe(403);
    expect(store.calls).toEqual([]);
    expect(store.order.itemIds).toHaveLength(3);
  });

  it('answers 404 when the database says the caller cannot edit this plan', async () => {
    store.order.editable = false;
    const res = await clear();
    expect(res.status).toBe(404);
    expect(store.order.itemIds).toHaveLength(3);
  });

  it('rejects a malformed revision', async () => {
    const res = await clear('?expected_revision=soon');
    expect(res.status).toBe(422);
    expect(store.calls).toEqual([]);
  });
});
