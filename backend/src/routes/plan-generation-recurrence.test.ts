import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import type { EffectiveAccess, PlanTemplateContent } from '@service-center/shared';
import type { Db } from '../lib/supabase.js';

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';
process.env.CRON_SECRET ||= 'test-worker-secret-long-enough';

/**
 * Flexible plan generation: the API expands the recurrence itself, enforces
 * the 52-plan cap and the two-year range, rejects impossible dates, and sends
 * the database plans in date order. The SQL re-checks are in
 * supabase/tests/flexible-plan-generation.sql.
 */

const ORG = '00000000-0000-4000-8000-000000000001';
const REVISION = '00000000-0000-4000-8000-0000000000a1';

/** One proposed plan as the API sends it to the generation RPCs. */
interface RpcPlan {
  local_date: string;
  title: string;
  service_date: string;
  times: Array<{ starts_at: string; ends_at: string }>;
}

/** What the fake records of each RPC call. */
interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

const content: PlanTemplateContent = {
  version: 1,
  notes: null,
  times: [{ kind: 'service', name: 'Service', day_offset: 0, local_start: '10:00', duration_minutes: 90 }],
  items: [],
  needs: [],
  roster: [],
};

const calls: RpcCall[] = [];

const rows: Record<string, unknown> = {
  organizations: { timezone: 'America/Los_Angeles' },
  plan_template_revisions: { template_id: 'tpl', content, template: { name: 'Sunday' } },
};

const fakeDb = (): Db => {
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.maybeSingle = () => Promise.resolve({ data: rows[table] ?? null, error: null });
    return chain;
  };
  return {
    from,
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      const plans = args.p_plans as RpcPlan[];
      if (name === 'preview_plan_generation') {
        return Promise.resolve({
          data: {
            template_id: 'tpl',
            service_type_id: null,
            revision_id: REVISION,
            timezone: 'America/Los_Angeles',
            plans: plans.map((plan) => ({ ...plan, preview: { blocking: [] }, existing_plans: [] })),
            preview_hash: 'a'.repeat(32),
          },
          error: null,
        });
      }
      if (name === 'generate_plans_from_template') {
        return Promise.resolve({ data: { batch_id: 'batch', plan_ids: [], replayed: false }, error: null });
      }
      return Promise.resolve({ data: null, error: { code: 'XX000', message: `unexpected ${name}` } });
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

describe('plan generation with flexible recurrence', () => {
  let app: Express;

  beforeAll(async () => {
    const { planTemplateUseRouter } = await import('./plan-templates.js');
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
    app.use('/api/v1/plans', planTemplateUseRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    calls.length = 0;
  });

  const preview = (body: Record<string, unknown>) =>
    request(app).post('/api/v1/plans/generate/preview').send({ revision_id: REVISION, start_date: '2027-02-01', ...body });
  const generate = (body: Record<string, unknown>) =>
    request(app).post('/api/v1/plans/generate').send({
      revision_id: REVISION,
      start_date: '2027-02-01',
      preview_hash: 'a'.repeat(32),
      idempotency_key: 'flexible-generation-key',
      ...body,
    });
  const sentPlans = (): RpcPlan[] => (calls.at(-1)?.args.p_plans as RpcPlan[] | undefined) ?? [];

  it('expands "every 2nd Sunday" on the server and keeps 10:00 local across DST', async () => {
    const response = await preview({ recurrence: { frequency: 'monthly_weekday', ordinal: 'second', weekday: 0 }, count: 4 });
    expect(response.status).toBe(200);
    expect(response.body.max_plans).toBe(52);
    expect(response.body.problems).toEqual([]);
    expect(sentPlans().map((plan) => plan.local_date)).toEqual(['2027-02-14', '2027-03-14', '2027-04-11', '2027-05-09']);
    expect(sentPlans().map((plan) => plan.service_date)).toEqual([
      '2027-02-14T18:00:00.000Z',
      '2027-03-14T17:00:00.000Z',
      '2027-04-11T17:00:00.000Z',
      '2027-05-09T17:00:00.000Z',
    ]);
  });

  it('enforces the 52-plan cap', async () => {
    const tooMany = await preview({ count: 53 });
    expect(tooMany.status).toBe(422);
    expect(calls).toHaveLength(0);

    const year = await generate({ start_date: '2027-01-03', count: 52 });
    expect(year.status).toBe(201);
    expect(calls.at(-1)?.name).toBe('generate_plans_from_template');
    expect(sentPlans()).toHaveLength(52);
    expect(calls.at(-1)?.args.p_series).toMatchObject({ recurrence: { frequency: 'weekly', interval_weeks: 1 }, count: 52 });
  });

  it('reports an until date that needs more than 52 plans and refuses to create them', async () => {
    const body = { start_date: '2027-01-03', count: 52, end_date: '2028-06-30' };
    const reviewed = await preview(body);
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.preview_hash).toBeNull();
    expect(reviewed.body.problems.map((problem: { problem: { code: string } }) => problem.problem.code)).toEqual(['too_many_dates']);

    calls.length = 0;
    const created = await generate(body);
    expect(created.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('rejects impossible dates, an end beyond two years and out-of-range rules', async () => {
    expect((await preview({ start_date: '2027-02-30' })).status).toBe(422);
    expect((await preview({ start_date: '2027-2-03' })).status).toBe(422);
    expect((await preview({ end_date: '2029-02-02' })).status).toBe(422);
    expect((await preview({ end_date: '2027-01-31' })).status).toBe(422);
    expect((await preview({ recurrence: { frequency: 'weekly', interval_weeks: 9 } })).status).toBe(422);
    expect((await preview({ recurrence: { frequency: 'monthly_day', day_of_month: 0 } })).status).toBe(422);
    expect((await preview({ edits: [{ local_date: '2027-02-01', move_to: '2027-04-31' }] })).status).toBe(422);
    expect(calls).toHaveLength(0);
  });

  it('sends moved dates to the database in date order', async () => {
    const response = await preview({
      start_date: '2027-02-07',
      count: 3,
      edits: [{ local_date: '2027-02-07', move_to: '2027-02-16' }],
    });
    expect(response.status).toBe(200);
    expect(sentPlans().map((plan) => plan.local_date)).toEqual(['2027-02-14', '2027-02-16', '2027-02-21']);
  });

  it('still accepts an older weekly request', async () => {
    const response = await preview({ start_date: '2027-02-07', interval_weeks: 2, count: 3 });
    expect(response.status).toBe(200);
    expect(sentPlans().map((plan) => plan.local_date)).toEqual(['2027-02-07', '2027-02-21', '2027-03-07']);
  });
});
