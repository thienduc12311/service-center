import { describe, expect, it } from 'vitest';
import express, { type Express, type Router } from 'express';
import request from 'supertest';
import type { MediaList } from '@service-center/shared';
import type { Db } from '../lib/supabase.js';

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';
process.env.CRON_SECRET ||= 'test-worker-secret-long-enough';

/**
 * Large-list UX §5 contract tests for the API layer: what each list route
 * sends to PostgREST/the RPC and how it shapes the answer. Accent folding,
 * AND semantics and LIKE escaping inside SQL are covered by
 * supabase/tests/large-list-search.sql against the real database.
 */

type Row = Record<string, unknown>;

/** One builder method call the fake recorded: [method, ...args]. */
type Call = [string, ...unknown[]];

interface Recorded {
  table: string;
  calls: Call[];
}

interface FakeDbLog {
  queries: Recorded[];
  rpcs: Array<{ fn: string; args: Record<string, unknown> }>;
}

/** A query builder that records every call and answers with fixed rows (and their count). */
class RecordingQuery implements PromiseLike<{ data: Row[] | Row | null; error: null; count: number }> {
  constructor(private readonly recorded: Recorded, private readonly rows: Row[]) {}
  private record(method: string, args: unknown[]): this {
    this.recorded.calls.push([method, ...args]);
    return this;
  }
  select(...args: unknown[]): this { return this.record('select', args); }
  eq(...args: unknown[]): this { return this.record('eq', args); }
  neq(...args: unknown[]): this { return this.record('neq', args); }
  is(...args: unknown[]): this { return this.record('is', args); }
  in(...args: unknown[]): this { return this.record('in', args); }
  gte(...args: unknown[]): this { return this.record('gte', args); }
  lte(...args: unknown[]): this { return this.record('lte', args); }
  filter(...args: unknown[]): this { return this.record('filter', args); }
  or(...args: unknown[]): this { return this.record('or', args); }
  order(...args: unknown[]): this { return this.record('order', args); }
  limit(...args: unknown[]): this { return this.record('limit', args); }
  range(...args: unknown[]): this { return this.record('range', args); }
  maybeSingle(): PromiseLike<{ data: Row | null; error: null }> {
    return Promise.resolve({ data: this.rows[0] ?? null, error: null });
  }
  then<R1 = { data: Row[]; error: null; count: number }, R2 = never>(
    ok?: ((value: { data: Row[]; error: null; count: number }) => R1 | PromiseLike<R1>) | null,
    fail?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve({ data: this.rows, error: null, count: this.rows.length }).then(ok, fail);
  }
}

const fakeDb = (tables: Record<string, Row[]>, rpcs: Record<string, unknown>, log: FakeDbLog): Db =>
  ({
    from: (table: string) => {
      const recorded: Recorded = { table, calls: [] };
      log.queries.push(recorded);
      return new RecordingQuery(recorded, tables[table] ?? []);
    },
    rpc: (fn: string, args: Record<string, unknown> = {}) => {
      log.rpcs.push({ fn, args });
      return Promise.resolve({ data: rpcs[fn] ?? null, error: null });
    },
  }) as unknown as Db;

const mount = async (path: string, load: () => Promise<Router>, db: Db): Promise<Express> => {
  const { errorHandler } = await import('../middleware/error-handler.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.orgId = 'org';
    req.orgRole = 'owner';
    req.auth = { userId: 'self', email: 'self@example.test', accessToken: 'token' };
    req.access = { organization_id: 'org', user_id: 'self', role: 'owner', access_mode: 'legacy', can_administer_access: true, entries: [] };
    req.db = db;
    next();
  });
  app.use(path, await load());
  app.use(errorHandler);
  return app;
};

const filtersOf = (recorded: Recorded): Call[] => recorded.calls.filter(([method]) => method === 'filter');

const SONG_ID = '00000000-0000-4000-8000-000000000001';
const PLAN_ID = '00000000-0000-4000-8000-000000000002';
const TYPE_ID = '00000000-0000-4000-8000-000000000003';

const songRow = (overrides: Row = {}): Row => ({
  id: SONG_ID, organization_id: '00000000-0000-4000-8000-0000000000aa', created_by: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', archived_at: null, revision: 1,
  title: 'Chúa Là Tình Yêu', themes: [], song_types: [], arrangements: [],
  last_scheduled_at: '2026-11-14T10:00:00+00:00', usage_count: 3, in_plan: true,
  ...overrides,
});

describe('GET /songs (large-list contract)', () => {
  const load = async (): Promise<Router> => (await import('./songs.js')).songsRouter;

  it('forwards the new sorts and scopes to list_curated_songs and returns usage_count/in_plan', async () => {
    const log: FakeDbLog = { queries: [], rpcs: [] };
    const db = fakeDb({}, { list_curated_songs: { data: [songRow()], page: 1, per_page: 25, total: 1 } }, log);
    const app = await mount('/songs', load, db);
    const response = await request(app).get('/songs').query({
      q: 'chua yeu', sort: 'most_used', service_type_id: TYPE_ID, plan_id: PLAN_ID,
      not_scheduled_since: '2026-10-01T00:00:00Z',
    });
    expect(response.status).toBe(200);
    expect(log.rpcs[0]?.fn).toBe('list_curated_songs');
    expect(log.rpcs[0]?.args.p_query).toMatchObject({
      q: 'chua yeu', sort: 'most_used', service_type_id: TYPE_ID, plan_id: PLAN_ID, not_scheduled_since: '2026-10-01T00:00:00Z',
    });
    expect(response.body.total).toBe(1);
    expect(response.body.data[0]).toMatchObject({ usage_count: 3, in_plan: true, last_scheduled_at: '2026-11-14T10:00:00+00:00' });
  });

  it('accepts last_used and rejects unknown sorts and malformed scopes', async () => {
    const log: FakeDbLog = { queries: [], rpcs: [] };
    const db = fakeDb({}, { list_curated_songs: { data: [], page: 1, per_page: 25, total: 0 } }, log);
    const app = await mount('/songs', load, db);
    expect((await request(app).get('/songs').query({ sort: 'last_used' })).status).toBe(200);
    expect((await request(app).get('/songs').query({ sort: 'popular' })).status).toBe(422);
    expect((await request(app).get('/songs').query({ plan_id: 'nope' })).status).toBe(422);
    expect((await request(app).get('/songs').query({ service_type_id: 'nope' })).status).toBe(422);
    expect((await request(app).get('/songs').query({ not_scheduled_since: 'yesterday' })).status).toBe(422);
  });

  it('refuses an RPC answer without the new row fields rather than passing it on', async () => {
    const log: FakeDbLog = { queries: [], rpcs: [] };
    const { usage_count: _usage, ...legacy } = songRow();
    const db = fakeDb({}, { list_curated_songs: { data: [legacy], page: 1, per_page: 25, total: 1 } }, log);
    const app = await mount('/songs', load, db);
    expect((await request(app).get('/songs')).status).toBe(500);
  });
});

describe('GET /plans ?q (large-list contract)', () => {
  const load = async (): Promise<Router> => (await import('./plans.js')).plansRouter;

  it('folds the title search and adds one literal search_text filter per word', async () => {
    const log: FakeDbLog = { queries: [], rpcs: [] };
    const db = fakeDb({ plans: [] }, {}, log);
    const app = await mount('/plans', load, db);
    const response = await request(app).get('/plans').query({ q: '  Lễ  GIÁNG_sinh% ' });
    expect(response.status).toBe(200);
    const plans = log.queries.find((query) => query.table === 'plans')!;
    expect(filtersOf(plans)).toEqual([
      ['filter', 'search_text', 'imatch', 'le'],
      ['filter', 'search_text', 'imatch', 'giang\\_sinh\\%'],
    ]);
    expect(plans.calls).toContainEqual(['eq', 'organization_id', 'org']);
  });

  it('adds no search filter without q', async () => {
    const log: FakeDbLog = { queries: [], rpcs: [] };
    const app = await mount('/plans', load, fakeDb({ plans: [] }, {}, log));
    expect((await request(app).get('/plans')).status).toBe(200);
    expect(filtersOf(log.queries.find((query) => query.table === 'plans')!)).toEqual([]);
  });
});

describe('GET /media (large-list contract)', () => {
  const load = async (): Promise<Router> => (await import('./rehearsal.js')).mediaRouter;
  const mediaRow = (index: number, overrides: Row = {}): Row => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, organization_id: 'org', title: `Clip ${index}`,
    creator: null, duration_seconds: null, themes: [], tags: [], notes: null, thumbnail_file_id: null,
    archive_on: null, archived_at: null, archived_by: null, revision: 1, created_by: null, created_at: 'x',
    updated_by: null, updated_at: 'x', is_archived: false, usage_count: 0, last_used_on: null, ...overrides,
  });

  it('lets SQL apply the archived filter and the cap, and reports total/truncated', async () => {
    const log: FakeDbLog = { queries: [], rpcs: [] };
    const rows = Array.from({ length: 200 }, (_, index) => mediaRow(index, index === 0 ? { usage_count: 4321, last_used_on: '2026-11-01T10:00:00+00:00' } : {}));
    const db = fakeDb(
      { organizations: [{ timezone: 'UTC' }] },
      { list_media: { media: rows, total: 950, truncated: true }, has_capability: true },
      log,
    );
    const app = await mount('/media', load, db);
    const response = await request(app).get('/media').query({ q: 'giang sinh' });
    expect(response.status).toBe(200);
    const call = log.rpcs.find((rpc) => rpc.fn === 'list_media')!;
    expect(call.args).toMatchObject({ p_org: 'org', p_query: { q: 'giang sinh', include_archived: false, limit: 200 } });
    expect((call.args.p_query as Row).today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const body = response.body as MediaList;
    expect(body).toMatchObject({ total: 950, truncated: true, can_create: true });
    expect(body.media).toHaveLength(200);
    // Counts come from SQL: no 4000-row usage read in JS any more.
    expect(body.media[0]).toMatchObject({ usage_count: 4321, last_used_on: '2026-11-01T10:00:00+00:00' });
    expect(log.queries.some((query) => query.table === 'plan_items')).toBe(false);
  });

  it('asks for archived bundles only on request', async () => {
    const log: FakeDbLog = { queries: [], rpcs: [] };
    const db = fakeDb({ organizations: [{ timezone: 'UTC' }] }, { list_media: { media: [], total: 0, truncated: false } }, log);
    const app = await mount('/media', load, db);
    await request(app).get('/media').query({ include_archived: 'true' });
    expect(log.rpcs.find((rpc) => rpc.fn === 'list_media')?.args.p_query).toMatchObject({ include_archived: true });
  });

  it('refuses a malformed RPC answer', async () => {
    const log: FakeDbLog = { queries: [], rpcs: [] };
    const db = fakeDb({ organizations: [{ timezone: 'UTC' }] }, { list_media: { media: [{ id: 'x' }], total: 1 } }, log);
    const app = await mount('/media', load, db);
    expect((await request(app).get('/media')).status).toBe(500);
  });
});
