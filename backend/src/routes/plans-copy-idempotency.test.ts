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
 * W9-API-D1: `POST /plans/:id/duplicate` and `POST /plans/:id/import` replayed an idempotency
 * key without comparing the request. The database now hashes the request with the key
 * (`duplicate_plan` / `import_plan_contents` → `claim_plan_copy_key`); the fake below behaves
 * like that claim, so these tests assert what a client sees: a replay for the same body and
 * 409 `idempotency_key_reused` for another one. The SQL itself is asserted in
 * supabase/tests/qa-wave9-db-fixes.sql.
 */

/** A claimed key as `plan_copy_operations` holds it. */
interface ClaimedKey {
  requestHash: string;
  targetPlanId: string;
}

/** What the fake returns from an RPC. */
interface RpcResult {
  data: string | number | null;
  error: { code: string; message: string; hint?: string } | null;
}

const store = vi.hoisted(() => ({ keys: new Map<string, { requestHash: string; targetPlanId: string }>(), created: 0, revision: 3 }));

vi.mock('../services/plans.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/plans.js')>()),
  fetchPlanDetail: vi.fn(async (_db: unknown, _org: string, planId: string) => ({ id: planId })),
}));

const ORG = '00000000-0000-4000-8000-000000000001';
const SOURCE = '00000000-0000-4000-8000-0000000000a1';
const TARGET = '00000000-0000-4000-8000-0000000000b1';
const KEY = 'w9-duplicate-key-0001';

const reused: RpcResult = {
  data: null,
  error: { code: 'PT409', message: 'That idempotency key was used for a different request', hint: 'idempotency_key_reused' },
};

/** Mirrors claim_plan_copy_key: first claim wins, a replay must carry the same request hash. */
const claim = (key: string | null, requestHash: string, newTarget: () => string): RpcResult => {
  if (key === null) return { data: newTarget(), error: null };
  const existing: ClaimedKey | undefined = store.keys.get(key);
  if (!existing) {
    const targetPlanId = newTarget();
    store.keys.set(key, { requestHash, targetPlanId });
    return { data: targetPlanId, error: null };
  }
  if (existing.requestHash !== requestHash) return reused;
  return { data: existing.targetPlanId, error: null };
};

const fakeDb = (): Db => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.maybeSingle = () => Promise.resolve({ data: { id: TARGET }, error: null });
  return {
    from: () => chain,
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name === 'duplicate_plan') {
        const hash = JSON.stringify([args.p_service_date, args.p_title, args.p_copy_assignments, args.p_conflict_override_reason]);
        return Promise.resolve(claim(args.p_idempotency_key as string | null, hash, () => {
          store.created += 1;
          return `00000000-0000-4000-8000-${String(store.created).padStart(12, '0')}`;
        }));
      }
      if (name === 'import_plan_contents') {
        const hash = JSON.stringify([args.p_items, args.p_needs, args.p_assignments, args.p_conflict_override_reason]);
        const result = claim(args.p_idempotency_key as string | null, hash, () => {
          store.revision += 1;
          return TARGET;
        });
        return Promise.resolve(result.error ? result : { data: store.revision, error: null });
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

describe('plan copy idempotency (W9-API-D1)', () => {
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
    store.keys.clear();
    store.created = 0;
    store.revision = 3;
  });

  const duplicate = (body: Record<string, unknown>) => request(app).post(`/api/v1/plans/${SOURCE}/duplicate`).send(body);
  const importContents = (body: Record<string, unknown>) => request(app).post(`/api/v1/plans/${TARGET}/import`).send(body);

  it('duplicate: same key and same body replays the first copy with 201', async () => {
    const body = { service_date: '2027-09-01T15:00:00Z', idempotency_key: KEY };
    const first = await duplicate(body);
    const replay = await duplicate(body);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(store.created).toBe(1);
  });

  it('duplicate: same key with another service_date answers 409 idempotency_key_reused', async () => {
    const first = await duplicate({ service_date: '2027-09-01T15:00:00Z', idempotency_key: KEY });
    expect(first.status).toBe(201);
    const other = await duplicate({ service_date: '2027-09-08T15:00:00Z', idempotency_key: KEY });
    expect(other.status).toBe(409);
    expect(other.body.code).toBe('idempotency_key_reused');
    expect(store.created).toBe(1);
  });

  it('import: same key and same body replays; another body answers 409 idempotency_key_reused, not plan_revision_stale', async () => {
    const body = { source_plan_id: SOURCE, items: true, idempotency_key: KEY };
    const first = await importContents(body);
    const replay = await importContents(body);
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.body.content_revision).toBe(first.body.content_revision);

    const other = await importContents({ ...body, assignments: true });
    expect(other.status).toBe(409);
    expect(other.body.code).toBe('idempotency_key_reused');
  });
});
