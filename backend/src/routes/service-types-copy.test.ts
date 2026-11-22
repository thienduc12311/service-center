import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import type { EffectiveAccess, ServiceTypeRow } from '@service-center/shared';
import type { Db } from '../lib/supabase.js';
import { resolveServiceTypeCopy } from '../services/service-type-copy.js';

// Hoisted above the imports: the service module loads the environment config.
vi.hoisted(() => {
  process.env.NODE_ENV ||= 'test';
  process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
  process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';
  process.env.CRON_SECRET ||= 'test-worker-secret-long-enough';
});

/**
 * `POST /service-types/:id/copy` and `POST /service-types/:id/archive`. The fake
 * database records the RPC arguments and update payloads; RLS and the SQL
 * itself are asserted in supabase/tests/copy-archive-service-type.sql.
 */

const ORG = '00000000-0000-4000-8000-000000000001';
const SOURCE = '00000000-0000-4000-8000-0000000000a1';
const COPY = '00000000-0000-4000-8000-0000000000c1';
const FOLDER = '00000000-0000-4000-8000-0000000000f1';
const OTHER_FOLDER = '00000000-0000-4000-8000-0000000000f2';
const BAND = '00000000-0000-4000-8000-0000000000e1';
const HOSTS = '00000000-0000-4000-8000-0000000000e2';

/** What a fake PostgREST call resolves to. */
interface FakeResult {
  data: unknown;
  error: { code: string; message: string; hint?: string } | null;
}

/** One `.from(table)` call the fake saw: its filters and any update payload. */
interface RecordedQuery {
  table: string;
  filters: Array<[string, unknown]>;
  update?: Record<string, unknown>;
}

interface FakeState {
  source: Pick<ServiceTypeRow, 'id' | 'description' | 'recurrence' | 'folder_id'> | null;
  sourceTeams: string[];
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  rpcResult: FakeResult;
  queries: RecordedQuery[];
  /** Rows an update matches (empty: RLS hid the row). */
  updateMatches: boolean;
}

const state: FakeState = {
  source: null,
  sourceTeams: [],
  rpcCalls: [],
  rpcResult: { data: COPY, error: null },
  queries: [],
  updateMatches: true,
};

const copiedRow = (): ServiceTypeRow => ({
  id: COPY,
  organization_id: ORG,
  name: 'Evening',
  description: null,
  recurrence: 'weekly',
  sort_order: 0,
  folder_id: null,
  archived_at: null,
  created_at: '2026-11-22T00:00:00Z',
  updated_at: '2026-11-22T00:00:00Z',
});

const fakeDb = (): Db => ({
  from: (table: string) => {
    const recorded: RecordedQuery = { table, filters: [] };
    state.queries.push(recorded);
    const result = (): FakeResult => {
      if (recorded.update) {
        if (!state.updateMatches) return { data: null, error: null };
        return { data: { ...copiedRow(), id: SOURCE, ...recorded.update }, error: null };
      }
      if (table === 'service_type_teams') return { data: state.sourceTeams.map((team_id) => ({ team_id })), error: null };
      const id = recorded.filters.find(([column]) => column === 'id')?.[1];
      if (id === COPY) return { data: copiedRow(), error: null };
      return { data: state.source, error: null };
    };
    const chain = {
      select: () => chain,
      update: (payload: Record<string, unknown>) => {
        recorded.update = payload;
        return chain;
      },
      eq: (column: string, value: unknown) => {
        recorded.filters.push([column, value]);
        return chain;
      },
      maybeSingle: () => Promise.resolve(result()),
      single: () => Promise.resolve(result()),
      then: (resolve: (value: FakeResult) => unknown) => resolve(result()),
    };
    return chain;
  },
  rpc: (name: string, args: Record<string, unknown>) => {
    state.rpcCalls.push({ name, args });
    return Promise.resolve(state.rpcResult);
  },
}) as unknown as Db;

const access = (capabilities: EffectiveAccess['entries']): EffectiveAccess => ({
  organization_id: ORG,
  user_id: 'user-1',
  role: 'member',
  access_mode: 'scoped',
  can_administer_access: false,
  entries: capabilities,
});

const editor = access([{ capability: 'plans.edit', scope_type: 'organization', scope_id: null, source: 'role:admin', grant_id: null }]);
const scheduler = access([
  { capability: 'scheduling.manage', scope_type: 'organization', scope_id: null, source: 'grant', grant_id: null },
]);

describe('service type copy and archive routes', () => {
  let app: Express;
  let currentAccess: EffectiveAccess = editor;

  beforeAll(async () => {
    const { serviceTypesRouter } = await import('./service-types.js');
    const { errorHandler } = await import('../middleware/error-handler.js');
    app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.auth = { userId: 'user-1', email: 'sam@example.test', accessToken: 'token' };
      req.db = fakeDb();
      req.orgId = ORG;
      req.access = currentAccess;
      next();
    });
    app.use('/api/v1/service-types', serviceTypesRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    currentAccess = editor;
    state.source = { id: SOURCE, description: 'Morning notes', recurrence: 'biweekly', folder_id: FOLDER };
    state.sourceTeams = [BAND, HOSTS];
    state.rpcCalls = [];
    state.rpcResult = { data: COPY, error: null };
    state.queries = [];
    state.updateMatches = true;
  });

  const copy = (body: Record<string, unknown>) => request(app).post(`/api/v1/service-types/${SOURCE}/copy`).send(body);
  const archive = (body: Record<string, unknown>) => request(app).post(`/api/v1/service-types/${SOURCE}/archive`).send(body);

  it('copies with the chosen settings and exactly the chosen teams', async () => {
    const response = await copy({
      name: '  Evening  ',
      description: 'Evening notes',
      recurrence: 'monthly',
      folder_id: OTHER_FOLDER,
      team_ids: [HOSTS],
    });
    expect(response.status).toBe(201);
    expect(response.body.id).toBe(COPY);
    expect(state.rpcCalls).toEqual([
      {
        name: 'copy_service_type_as',
        args: {
          p_service_type: SOURCE,
          p_name: 'Evening',
          p_description: 'Evening notes',
          p_recurrence: 'monthly',
          p_folder: OTHER_FOLDER,
          p_team_ids: [HOSTS],
        },
      },
    ]);
    // The source's teams are not read when the request names them.
    expect(state.queries.some((query) => query.table === 'service_type_teams')).toBe(false);
  });

  it('a name-only request keeps the source settings and all its teams (the original contract)', async () => {
    const response = await copy({ name: 'Evening' });
    expect(response.status).toBe(201);
    expect(state.rpcCalls[0]?.args).toEqual({
      p_service_type: SOURCE,
      p_name: 'Evening',
      p_description: 'Morning notes',
      p_recurrence: 'biweekly',
      p_folder: FOLDER,
      p_team_ids: [BAND, HOSTS],
    });
  });

  it('include_teams false copies no teams; an explicit null folder and description clear them', async () => {
    await copy({ name: 'Evening', include_teams: false, folder_id: null, description: null });
    expect(state.rpcCalls[0]?.args).toMatchObject({ p_folder: null, p_description: null, p_team_ids: [] });
  });

  it('rejects a blank name, an unknown frequency and a malformed team id before touching the database', async () => {
    expect((await copy({ name: '   ' })).status).toBe(422);
    expect((await copy({ name: 'Evening', recurrence: 'daily' })).status).toBe(422);
    expect((await copy({ name: 'Evening', team_ids: ['not-a-uuid'] })).status).toBe(422);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it('answers 404 for a service type the caller cannot see', async () => {
    state.source = null;
    expect((await copy({ name: 'Evening' })).status).toBe(404);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it('answers 403 when the database refuses (another folder for a non-admin)', async () => {
    state.rpcResult = { data: null, error: { code: '42501', message: 'Only an administrator can put the copy in another folder' } };
    expect((await copy({ name: 'Evening', folder_id: OTHER_FOLDER })).status).toBe(403);
  });

  it('answers 403 without plans.edit anywhere', async () => {
    currentAccess = scheduler;
    expect((await copy({ name: 'Evening' })).status).toBe(403);
    expect((await archive({ archived: true })).status).toBe(403);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it('archives and restores by setting and clearing archived_at', async () => {
    const archived = await archive({ archived: true });
    expect(archived.status).toBe(200);
    expect(typeof state.queries.at(-1)?.update?.archived_at).toBe('string');
    expect(archived.body.archived_at).toBeTruthy();

    const restored = await archive({ archived: false });
    expect(restored.status).toBe(200);
    expect(state.queries.at(-1)?.update).toEqual({ archived_at: null });
    expect(restored.body.archived_at).toBeNull();
  });

  it('archive answers 404 when RLS hides the row and 422 without a flag', async () => {
    state.updateMatches = false;
    expect((await archive({ archived: true })).status).toBe(404);
    expect((await archive({})).status).toBe(422);
  });
});

describe('resolveServiceTypeCopy', () => {
  const source = { description: 'Notes', recurrence: 'weekly' as const, folder_id: FOLDER };

  it('takes each omitted field from the source', () => {
    expect(resolveServiceTypeCopy(source, [BAND], { name: 'Copy', include_teams: true })).toEqual({
      name: 'Copy',
      description: 'Notes',
      recurrence: 'weekly',
      folderId: FOLDER,
      teamIds: [BAND],
    });
  });

  it('prefers what the request sends, including explicit nulls and an empty team list', () => {
    expect(
      resolveServiceTypeCopy(source, [BAND], {
        name: 'Copy',
        include_teams: true,
        description: null,
        recurrence: 'monthly',
        folder_id: null,
        team_ids: [],
      }),
    ).toEqual({ name: 'Copy', description: null, recurrence: 'monthly', folderId: null, teamIds: [] });
  });
});
