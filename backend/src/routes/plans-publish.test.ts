import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import type { AssignmentNotificationSendResult, EffectiveAccess } from '@service-center/shared';
import type { Db } from '../lib/supabase.js';

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';

/**
 * ADR-0006 at the API: draft plans are quiet and publishing notifies. The fake
 * database mirrors `publish_plan_notify` (asks released, undeclined,
 * never-notified people plan-wide; a past plan or an already published one
 * asks nobody; the same key returns the same effect) and the draft check of
 * `enqueue_assignment_requests`. The SQL itself is asserted in
 * supabase/tests/publish-notifies.sql.
 */

/** A request as the fake stores it. */
interface StoredAssignment {
  id: string;
  person_id: string;
  team_id: string;
  status: 'unconfirmed' | 'confirmed' | 'declined';
  visibility: 'prepared' | 'released';
  notified_at: string | null;
  has_email: boolean;
}

/** The plan as the fake database holds it. */
interface StoredPlan {
  id: string;
  organization_id: string;
  title: string;
  location: string | null;
  content_revision: number;
  status: 'draft' | 'published' | 'archived';
  service_date: string;
}

/** One recorded request effect. */
interface StoredEffect {
  id: string;
  key: string;
  assignment_ids: string[];
}

const store = vi.hoisted(() => ({
  plan: null as StoredPlan | null,
  assignments: [] as StoredAssignment[],
  effects: [] as StoredEffect[],
  fieldUpdates: [] as Record<string, unknown>[],
  deliverEffectNow: vi.fn(async (_effectId: string | null) => undefined),
  notifyPlanAssignments: vi.fn(),
}));

vi.mock('../services/plans.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/plans.js')>()),
  fetchPlanDetail: vi.fn(async () => structuredClone(store.plan)),
}));
vi.mock('../services/delivery-worker.js', () => ({ deliverEffectNow: store.deliverEffectNow }));
vi.mock('../services/deliveries.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/deliveries.js')>()),
  notifyPlanAssignments: store.notifyPlanAssignments,
  effectIdForKey: vi.fn(async (_db: Db, _org: string, key: string) => store.effects.find((e) => e.key === key)?.id ?? null),
  notificationSendResult: vi.fn(async (_db: Db, effectId: string | null): Promise<AssignmentNotificationSendResult> => {
    const effect = store.effects.find((e) => e.id === effectId);
    const asked = store.assignments.filter((a) => effect?.assignment_ids.includes(a.id));
    return {
      notified: asked.filter((a) => a.has_email).length,
      skipped: asked.filter((a) => !a.has_email).map((a) => a.person_id),
      effect_id: effectId,
      email_mode: 'simulated',
      outcomes: [],
      summary: { in_app: {}, push: {}, email: {} },
    };
  }),
}));
vi.mock('../services/attendance.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/attendance.js')>()),
  checkConflicts: vi.fn(async () => ({ conflicts: [], override_permitted: false })),
}));
vi.mock('../services/availability.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/availability.js')>()),
  preferenceWarnings: vi.fn(async () => []),
}));

const ORG = '00000000-0000-4000-8000-000000000001';
const PLAN = '00000000-0000-4000-8000-0000000000c1';
const BAND = '00000000-0000-4000-8000-0000000000b1';
const PRODUCTION = '00000000-0000-4000-8000-0000000000b2';
const NEW_PERSON = '00000000-0000-4000-8000-0000000000f9';

const isPast = (serviceDate: string): boolean => serviceDate.slice(0, 10) < new Date().toISOString().slice(0, 10);

/** Who `publish_plan_notify` asks: released, not declined, never notified. */
const unnotified = (): StoredAssignment[] =>
  store.assignments.filter((a) => a.visibility === 'released' && a.status !== 'declined' && a.notified_at === null);

/** The arguments the fake RPCs receive. */
interface RpcArgs {
  p_plan?: string;
  p_notify?: boolean;
  p_effect_key?: string;
  p_fields?: Record<string, unknown>;
  p_assignments?: Array<{ person_id: string | null; team_id: string; visibility: string | null }>;
}

const rpc = (name: string, args: RpcArgs): { data: unknown; error: { code: string; message: string } | null } => {
  const plan = store.plan;
  if (!plan) return { data: null, error: { code: 'PT404', message: 'Plan not found' } };
  if (name === 'update_plan_with_times') {
    store.fieldUpdates.push(args.p_fields ?? {});
    Object.assign(plan, args.p_fields);
    return { data: {}, error: null };
  }
  if (name === 'publish_plan_notify') {
    const existing = store.effects.find((e) => e.key === args.p_effect_key);
    if (existing || plan.status === 'published') {
      return { data: [{ plan: structuredClone(plan), effect_id: existing?.id ?? null }], error: null };
    }
    plan.status = 'published';
    const asked = args.p_notify && !isPast(plan.service_date) ? unnotified() : [];
    if (asked.length === 0) return { data: [{ plan: structuredClone(plan), effect_id: null }], error: null };
    const effect: StoredEffect = { id: `effect-${store.effects.length + 1}`, key: args.p_effect_key ?? '', assignment_ids: asked.map((a) => a.id) };
    store.effects.push(effect);
    return { data: [{ plan: structuredClone(plan), effect_id: effect.id }], error: null };
  }
  if (name === 'publish_plan_notify_preview') {
    const asked = plan.status === 'published' || isPast(plan.service_date) ? [] : unnotified();
    return {
      data: [{ will_notify: asked.filter((a) => a.has_email).length, no_email: asked.filter((a) => !a.has_email).map((a) => a.person_id) }],
      error: null,
    };
  }
  if (name === 'schedule_plan_assignments') {
    const created = (args.p_assignments ?? []).map((a, index) => ({
      id: `new-${index}`, plan_id: plan.id, person_id: a.person_id ?? NEW_PERSON, team_id: a.team_id,
      visibility: a.visibility ?? 'released', status: 'unconfirmed',
    }));
    // Mirrors enqueue_assignment_requests: nothing is recorded for a draft.
    if (plan.status === 'published' && args.p_effect_key) {
      store.effects.push({ id: `effect-${store.effects.length + 1}`, key: args.p_effect_key, assignment_ids: created.map((c) => c.id) });
    }
    return { data: created, error: null };
  }
  return { data: null, error: { code: 'XX000', message: `unexpected ${name}` } };
};

const fakeDb = (): Db => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.in = () => chain;
  chain.single = () => Promise.resolve({ data: structuredClone(store.plan), error: null });
  chain.maybeSingle = () => Promise.resolve({ data: structuredClone(store.plan), error: null });
  chain.insert = () => Promise.resolve({ data: null, error: null });
  return {
    from: () => chain,
    rpc: (name: string, args: RpcArgs) => Promise.resolve(rpc(name, args)),
  } as unknown as Db;
};

/** A plan editor who schedules nobody: publishing is a plan-level act. */
const editorAccess: EffectiveAccess = {
  organization_id: ORG,
  user_id: 'user-1',
  role: 'member',
  access_mode: 'scoped',
  can_administer_access: false,
  entries: [
    { capability: 'plans.edit', scope_type: 'organization', scope_id: null, source: 'grant', grant_id: 'g1' },
    { capability: 'scheduling.manage', scope_type: 'team', scope_id: BAND, source: 'grant', grant_id: 'g2' },
  ],
};

const assignment = (id: string, team: string, patch: Partial<StoredAssignment> = {}): StoredAssignment => ({
  id, person_id: `person-${id}`, team_id: team, status: 'unconfirmed', visibility: 'released', notified_at: null, has_email: true, ...patch,
});

const daysFromNow = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString();

describe('ADR-0006: draft plans are quiet; publishing notifies', () => {
  let app: Express;

  beforeAll(async () => {
    const { plansRouter } = await import('./plans.js');
    const { planAssignmentsRouter, planNotifyRouter } = await import('./assignments.js');
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
    app.use('/api/v1/plans/:planId/assignments', planAssignmentsRouter);
    app.use('/api/v1/plans/:planId/notify', planNotifyRouter);
    app.use('/api/v1/plans', plansRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    store.plan = {
      id: PLAN, organization_id: ORG, title: 'Sunday', location: null, content_revision: 3,
      status: 'draft', service_date: daysFromNow(3),
    };
    store.assignments = [
      assignment('a-band', BAND),
      // A team the editor does not schedule: publishing still asks them.
      assignment('a-production', PRODUCTION, { has_email: false }),
      assignment('a-notified', BAND, { notified_at: daysFromNow(-1) }),
      assignment('a-prepared', BAND, { visibility: 'prepared' }),
      assignment('a-declined', BAND, { status: 'declined' }),
    ];
    store.effects = [];
    store.fieldUpdates = [];
    store.deliverEffectNow.mockClear();
    store.notifyPlanAssignments.mockClear();
  });

  const publish = (body: Record<string, unknown> = {}) =>
    request(app).patch(`/api/v1/plans/${PLAN}`).send({ status: 'published', ...body });

  it('scheduling on a draft plan sends nothing and says it is held until publish', async () => {
    const res = await request(app)
      .post(`/api/v1/plans/${PLAN}/assignments`)
      .send({ assignments: [{ person_id: NEW_PERSON, team_id: BAND }], notify: true });
    expect(res.status).toBe(201);
    expect(res.body.held_until_publish).toBe(true);
    expect(store.effects).toEqual([]);
    expect(store.deliverEffectNow).not.toHaveBeenCalled();
  });

  it('scheduling on a published plan still notifies right away', async () => {
    store.plan = { ...store.plan!, status: 'published' };
    const res = await request(app)
      .post(`/api/v1/plans/${PLAN}/assignments`)
      .send({ assignments: [{ person_id: NEW_PERSON, team_id: BAND }], notify: true });
    expect(res.status).toBe(201);
    expect(res.body.held_until_publish).toBeUndefined();
    expect(store.deliverEffectNow).toHaveBeenCalledWith('effect-1');
  });

  it('"notify" on a draft plan sends nothing and says it is held until publish', async () => {
    const res = await request(app).post(`/api/v1/plans/${PLAN}/notify`).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ held_until_publish: true, effect_id: null, notified: 0 });
    expect(store.notifyPlanAssignments).not.toHaveBeenCalled();
  });

  it('previews who publishing would email and who has no address', async () => {
    const res = await request(app).get(`/api/v1/plans/${PLAN}/publish-preview`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ will_notify: 1, no_email: ['person-a-production'] });
  });

  it('publishing asks exactly the released, never-notified people, across every team', async () => {
    const res = await publish({ idempotency_key: 'publish-key-0001' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('published');
    expect(store.effects).toEqual([
      { id: 'effect-1', key: `publish:${PLAN}:publish-key-0001`, assignment_ids: ['a-band', 'a-production'] },
    ]);
    expect(store.deliverEffectNow).toHaveBeenCalledWith('effect-1');
    expect(res.body.publish_notification).toMatchObject({ effect_id: 'effect-1', notified: 1, skipped: ['person-a-production'] });
    // The status never goes through the plain field update.
    expect(store.fieldUpdates).toEqual([]);
  });

  it('saves other fields first, then publishes', async () => {
    const res = await publish({ title: 'Easter' });
    expect(res.status).toBe(200);
    expect(store.fieldUpdates).toEqual([{ title: 'Easter' }]);
    expect(store.effects).toHaveLength(1);
  });

  it('a retried publish with the same key returns the first outcome without asking again', async () => {
    await publish({ idempotency_key: 'publish-key-0002' });
    const retry = await publish({ idempotency_key: 'publish-key-0002' });
    expect(retry.status).toBe(200);
    expect(store.effects).toHaveLength(1);
    expect(retry.body.publish_notification).toMatchObject({ effect_id: 'effect-1' });
  });

  it('re-publishing never re-asks people already notified', async () => {
    store.assignments = store.assignments.map((a) => ({ ...a, notified_at: daysFromNow(-1) }));
    const res = await publish();
    expect(res.status).toBe(200);
    expect(store.effects).toEqual([]);
    expect(res.body.publish_notification).toBeNull();
    expect(store.deliverEffectNow).toHaveBeenCalledWith(null);
  });

  it('publishing a past plan sends nothing', async () => {
    store.plan = { ...store.plan!, service_date: daysFromNow(-3) };
    const res = await publish();
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('published');
    expect(store.effects).toEqual([]);
    expect(res.body.publish_notification).toBeNull();
  });

  it('publishing with "Notify people" off is silent', async () => {
    const res = await publish({ notify: false });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('published');
    expect(store.effects).toEqual([]);
  });

  it('unpublishing is a plain field update and asks nobody', async () => {
    store.plan = { ...store.plan!, status: 'published' };
    const res = await request(app).patch(`/api/v1/plans/${PLAN}`).send({ status: 'draft' });
    expect(res.status).toBe(200);
    expect(store.fieldUpdates).toEqual([{ status: 'draft' }]);
    expect(res.body.publish_notification).toBeUndefined();
    expect(store.effects).toEqual([]);
  });
});
