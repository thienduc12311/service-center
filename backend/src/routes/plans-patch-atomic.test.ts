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

/**
 * W8-RES-D4 / W8-RT-D1: `PATCH /plans/:id` writes the plan fields and the time
 * list as ONE transaction. The fake database below behaves like
 * `update_plan_with_times` (revision check, then both writes or neither), so
 * these tests assert what a client observes: the saved plan, an unchanged plan
 * after a failure, and a retry with the same `expected_revision` succeeding.
 * The real transaction semantics are asserted in supabase/tests/qa-wave8-db.sql.
 */

/** A plan time as the fake stores it. */
interface StoredTime {
  id: string;
  kind: string;
  name: string | null;
  starts_at: string;
  ends_at: string | null;
}

/** The plan as the fake database holds it. */
interface StoredPlan {
  id: string;
  organization_id: string;
  title: string;
  location: string | null;
  content_revision: number;
  times: StoredTime[];
}

/** One way to make the next combined write fail after the fields were applied. */
type InjectedFailure = 'times' | null;

const store = vi.hoisted(() => ({ plan: null as StoredPlan | null, failNext: null as InjectedFailure, plainUpdates: 0 }));

vi.mock('../services/plans.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/plans.js')>()),
  fetchPlanDetail: vi.fn(async () => structuredClone(store.plan)),
}));
vi.mock('../services/delivery-worker.js', () => ({ deliverEffectNow: vi.fn(async () => undefined) }));

const ORG = '00000000-0000-4000-8000-000000000001';
const PLAN = '00000000-0000-4000-8000-0000000000c1';
const TIME = '00000000-0000-4000-8000-0000000000d1';

interface RpcFailure {
  code: string;
  message: string;
  hint?: string;
}

interface RpcResult {
  data: { invalidated_requests: number; notified_assignment_ids: string[]; effect_id: string | null } | null;
  error: RpcFailure | null;
}

/** The arguments `update_plan_with_times` receives. */
interface UpdatePlanWithTimesArgs {
  p_fields: Partial<Pick<StoredPlan, 'title' | 'location'>>;
  p_times: StoredTime[] | null;
  p_expected_revision: number | null;
}

/** Mirrors update_plan_with_times: revision check, then fields and times together or not at all. */
const updatePlanWithTimes = (args: UpdatePlanWithTimesArgs): RpcResult => {
  const current = store.plan;
  if (!current) return { data: null, error: { code: 'PT404', message: 'Plan not found' } };
  if (args.p_expected_revision !== null && args.p_expected_revision !== current.content_revision) {
    return { data: null, error: { code: 'PT409', message: 'The plan changed since you opened it', hint: 'plan_changed' } };
  }
  const draft: StoredPlan = { ...structuredClone(current), ...args.p_fields };
  if (args.p_times) {
    if (store.failNext === 'times') {
      store.failNext = null;
      // The transaction rolls back: the draft (with the new fields) is discarded.
      return { data: null, error: { code: '23514', message: 'new row for relation "plan_times" violates check constraint' } };
    }
    draft.times = args.p_times.map(({ id, kind, name, starts_at, ends_at }) => ({ id, kind, name, starts_at, ends_at }));
  }
  draft.content_revision = current.content_revision + 1;
  store.plan = draft;
  return { data: { invalidated_requests: 0, notified_assignment_ids: [], effect_id: null }, error: null };
};

const fakeDb = (): Db => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.single = () => Promise.resolve({ data: structuredClone(store.plan), error: null });
  chain.update = () => {
    store.plainUpdates += 1;
    return chain;
  };
  return {
    from: () => chain,
    rpc: (name: string, args: UpdatePlanWithTimesArgs) => {
      if (name !== 'update_plan_with_times') return Promise.resolve({ data: null, error: { code: 'XX000', message: `unexpected ${name}` } });
      return Promise.resolve(updatePlanWithTimes(args));
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

const TIMES = [{ id: TIME, kind: 'service', name: 'Main', starts_at: '2026-12-06T09:00:00.000Z', ends_at: '2026-12-06T10:00:00.000Z' }];

describe('PATCH /plans/:id is atomic', () => {
  let app: Express;

  beforeAll(async () => {
    const { plansRouter } = await import('./plans.js');
    const { errorHandler } = await import('../middleware/error-handler.js');
    app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.auth = { userId: 'user-1', email: 'sam@example.test', accessToken: 'token' };
      req.db = fakeDb();
      req.orgId = ORG;
      req.access = editorAccess;
      next();
    });
    app.use('/api/v1/plans', plansRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    store.plan = { id: PLAN, organization_id: ORG, title: 'Sunday', location: null, content_revision: 7, times: [] };
    store.failNext = null;
    store.plainUpdates = 0;
  });

  const patch = (body: Record<string, unknown>) => request(app).patch(`/api/v1/plans/${PLAN}`).send(body);

  it('saves the fields and the time list together and answers the saved plan', async () => {
    const res = await patch({ title: 'Advent', times: TIMES, expected_revision: 7 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: 'Advent', content_revision: 8, times: [{ id: TIME, name: 'Main' }] });
    expect(store.plan).toMatchObject({ title: 'Advent', times: [{ id: TIME }] });
    expect(store.plainUpdates).toBe(0);
  });

  it('leaves the times alone when only fields change', async () => {
    store.plan = { ...store.plan!, times: TIMES.map((time) => ({ ...time })) };
    const res = await patch({ title: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: 'Renamed', times: [{ id: TIME }] });
  });

  it('keeps the old title when the time list fails, and the same retry then succeeds (no false 409)', async () => {
    store.failNext = 'times';
    const failed = await patch({ title: 'Advent', times: TIMES, expected_revision: 7 });
    expect(failed.status).toBeGreaterThanOrEqual(400);
    expect(store.plan).toMatchObject({ title: 'Sunday', content_revision: 7, times: [] });

    const retried = await patch({ title: 'Advent', times: TIMES, expected_revision: 7 });
    expect(retried.status).toBe(200);
    expect(retried.body).toMatchObject({ title: 'Advent', content_revision: 8, times: [{ id: TIME }] });
  });

  it('refuses a stale revision with 409 and changes nothing', async () => {
    const res = await patch({ title: 'Advent', times: TIMES, expected_revision: 3 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('plan_revision_stale');
    expect(store.plan).toMatchObject({ title: 'Sunday', content_revision: 7, times: [] });
    expect(store.plainUpdates).toBe(0);
  });
});
