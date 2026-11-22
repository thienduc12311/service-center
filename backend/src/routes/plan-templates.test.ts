import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import type { AccessCapability, EffectiveAccess, PlanTemplateContent } from '@service-center/shared';
import type { Db } from '../lib/supabase.js';

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';
process.env.CRON_SECRET ||= 'test-worker-secret-long-enough';

/**
 * Template authoring routes: create from scratch (empty content), a content
 * save against the revision read, and duplicate. The fake database records
 * the RPC arguments; the SQL behind them is asserted in
 * supabase/tests/template-authoring.sql.
 */

const ORG = '00000000-0000-4000-8000-000000000001';
const SOURCE = '00000000-0000-4000-8000-0000000000a1';
const COPY = '00000000-0000-4000-8000-0000000000c1';
const SUNDAY = '00000000-0000-4000-8000-0000000000e1';
const MIDWEEK = '00000000-0000-4000-8000-0000000000e2';
const POSITION = '00000000-0000-4000-8000-0000000000f1';

/** One recorded `db.rpc` call. */
interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

/** What the fake returns from an RPC. */
interface RpcResult {
  data: unknown;
  error: { code: string; message: string; hint?: string } | null;
}

/** A template row as `TEMPLATE_SELECT` embeds it. */
interface FakeTemplateRow {
  id: string;
  organization_id: string;
  service_type_id: string | null;
  kind: 'plan';
  name: string;
  description: string | null;
  current_revision: number;
  archived_at: null;
  created_by: null;
  updated_by: null;
  created_at: string;
  updated_at: string;
  service_type: { id: string; name: string } | null;
  revisions: Array<{ id: string; revision: number; source_plan_id: null; created_by: null; created_at: string; content: PlanTemplateContent }>;
}

const EMPTY: PlanTemplateContent = { version: 1, notes: null, times: [], items: [], needs: [], roster: [] };

const templateRow = (id: string, name: string): FakeTemplateRow => ({
  id,
  organization_id: ORG,
  service_type_id: SUNDAY,
  kind: 'plan',
  name,
  description: null,
  current_revision: 1,
  archived_at: null,
  created_by: null,
  updated_by: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  service_type: { id: SUNDAY, name: 'Sunday' },
  revisions: [{ id: `${id}-r1`, revision: 1, source_plan_id: null, created_by: null, created_at: '2026-11-01T00:00:00Z', content: EMPTY }],
});

const state: { calls: RpcCall[]; next: RpcResult } = { calls: [], next: { data: null, error: null } };

const fakeDb = (): Db => {
  const chain: Record<string, unknown> = {};
  let id = '';
  chain.select = () => chain;
  chain.eq = (column: string, value: string) => {
    if (column === 'id') id = value;
    return chain;
  };
  chain.maybeSingle = () => Promise.resolve({ data: templateRow(id, id === COPY ? 'Sunday (copy)' : 'Sunday'), error: null });
  return {
    from: () => chain,
    rpc: (name: string, args: Record<string, unknown>) => {
      state.calls.push({ name, args });
      return Promise.resolve(state.next);
    },
  } as unknown as Db;
};

const access = (capabilities: AccessCapability[]): EffectiveAccess => ({
  organization_id: ORG,
  user_id: 'user-1',
  role: 'admin',
  access_mode: 'scoped',
  can_administer_access: true,
  entries: capabilities.map((capability) => ({ capability, scope_type: 'organization', scope_id: null, source: 'role:admin', grant_id: null })),
});

const buildApp = async (capabilities: AccessCapability[]): Promise<Express> => {
  const { planTemplatesRouter } = await import('./plan-templates.js');
  const { errorHandler } = await import('../middleware/error-handler.js');
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: 'user-1', email: 'sam@example.test', accessToken: 'token' };
    req.db = fakeDb();
    req.orgId = ORG;
    req.access = access(capabilities);
    next();
  });
  app.use('/api/v1/plan-templates', planTemplatesRouter);
  app.use(errorHandler);
  return app;
};

describe('plan template authoring routes', () => {
  let app: Express;

  beforeAll(async () => {
    app = await buildApp(['plans.edit']);
  });

  beforeEach(() => {
    state.calls = [];
    state.next = { data: null, error: null };
  });

  it('creates an empty template from scratch', async () => {
    state.next = { data: { template_id: SOURCE, revision: 1 }, error: null };
    const response = await request(app)
      .post('/api/v1/plan-templates')
      .send({ name: 'Sunday', service_type_id: SUNDAY, description: 'Usual', content: {} });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ id: SOURCE, content: EMPTY });
    expect(state.calls[0]).toEqual({
      name: 'save_plan_template',
      args: expect.objectContaining({
        p_organization_id: ORG, p_kind: 'plan', p_service_type_id: SUNDAY, p_name: 'Sunday', p_description: 'Usual',
        p_content: EMPTY, p_source_plan_id: null,
      }),
    });
  });

  it('saves added content as a new revision of the revision read, and reports template_changed', async () => {
    state.next = { data: { template_id: SOURCE, revision: 2 }, error: null };
    const content = { items: [{ item_type: 'header', title: 'Worship' }], needs: [{ position_id: POSITION, needed: 2 }] };
    const saved = await request(app).patch(`/api/v1/plan-templates/${SOURCE}`).send({ expected_revision: 1, content });
    expect(saved.status).toBe(200);
    expect(state.calls[0]?.args).toMatchObject({
      p_template_id: SOURCE,
      p_expected_revision: 1,
      p_content: { items: [{ item_type: 'header', title: 'Worship', length_seconds: 0 }], needs: [{ position_id: POSITION, needed: 2 }] },
    });

    state.next = { data: null, error: { code: 'PT409', message: 'This template changed since you opened it', hint: 'template_changed' } };
    const stale = await request(app).patch(`/api/v1/plan-templates/${SOURCE}`).send({ expected_revision: 1, content });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('template_changed');
  });

  it('refuses a song item without a song before reaching the database', async () => {
    const response = await request(app)
      .patch(`/api/v1/plan-templates/${SOURCE}`)
      .send({ expected_revision: 1, content: { items: [{ item_type: 'song', title: 'Amazing Grace' }] } });
    expect(response.status).toBe(422);
    expect(state.calls).toHaveLength(0);
  });

  describe('duplicate', () => {
    it('keeps the service type when none is sent and returns the new template', async () => {
      state.next = { data: { template_id: COPY, revision: 1, unavailable: { needs: 0, roster: 0 } }, error: null };
      const response = await request(app).post(`/api/v1/plan-templates/${SOURCE}/duplicate`).send({ name: 'Sunday (copy)' });
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ id: COPY, name: 'Sunday (copy)' });
      expect(state.calls[0]).toEqual({
        name: 'duplicate_plan_template',
        args: {
          p_organization_id: ORG, p_template_id: SOURCE, p_name: 'Sunday (copy)',
          p_change_service_type: false, p_service_type_id: null, p_drop_unavailable: false,
        },
      });
    });

    it('targets another service type, or every service type for null', async () => {
      state.next = { data: { template_id: COPY, revision: 1, unavailable: { needs: 0, roster: 0 } }, error: null };
      await request(app).post(`/api/v1/plan-templates/${SOURCE}/duplicate`).send({ service_type_id: MIDWEEK, drop_unavailable: true });
      expect(state.calls[0]?.args).toMatchObject({ p_name: null, p_change_service_type: true, p_service_type_id: MIDWEEK, p_drop_unavailable: true });
      await request(app).post(`/api/v1/plan-templates/${SOURCE}/duplicate`).send({ service_type_id: null });
      expect(state.calls[1]?.args).toMatchObject({ p_change_service_type: true, p_service_type_id: null });
    });

    it('answers 409 template_copy_unavailable with the counts when staffing would be left out', async () => {
      state.next = { data: { template_id: null, revision: null, unavailable: { needs: 2, roster: 1 } }, error: null };
      const response = await request(app).post(`/api/v1/plan-templates/${SOURCE}/duplicate`).send({ service_type_id: MIDWEEK });
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: 'template_copy_unavailable', details: { needs: 2, roster: 1 } });
    });

    it('maps a denied target scope to 403 and a hidden source to 404', async () => {
      state.next = { data: null, error: { code: '42501', message: 'Only a plan editor for this service type can save templates' } };
      expect((await request(app).post(`/api/v1/plan-templates/${SOURCE}/duplicate`).send({ service_type_id: MIDWEEK })).status).toBe(403);
      state.next = { data: null, error: { code: 'P0002', message: 'Template not found' } };
      expect((await request(app).post(`/api/v1/plan-templates/${SOURCE}/duplicate`).send({})).status).toBe(404);
    });

    it('validates the body', async () => {
      const response = await request(app).post(`/api/v1/plan-templates/${SOURCE}/duplicate`).send({ name: ' ', service_type_id: 'midweek' });
      expect(response.status).toBe(422);
      expect(state.calls).toHaveLength(0);
    });
  });

  it('refuses callers without plans.edit anywhere', async () => {
    const memberApp = await buildApp([]);
    const response = await request(memberApp).post(`/api/v1/plan-templates/${SOURCE}/duplicate`).send({});
    expect(response.status).toBe(403);
    expect(state.calls).toHaveLength(0);
  });
});
