import { beforeAll, describe, expect, it } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import type { OrgRole } from '@service-center/shared';
import type { Db } from '../lib/supabase.js';

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';
process.env.CRON_SECRET ||= 'test-worker-secret-long-enough';

const PEOPLE_COUNT = 1101;
const PAGE_CAP = 1000;

interface FakeRow {
  id: string;
  organization_id: string;
  first_name: string;
  last_name: string;
  profile_id: string | null;
  archived_at: string | null;
}

const rows: FakeRow[] = Array.from({ length: PEOPLE_COUNT }, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  organization_id: 'org',
  first_name: `First${index}`,
  last_name: 'Person',
  profile_id: null,
  archived_at: null,
}));

/** A pending `person_invitations` row, as GET /people selects it. */
interface FakeInvitation {
  person_id: string;
}

const invitations: FakeInvitation[] = rows.map((row) => ({ person_id: row.id }));

interface FakeResult {
  data: Array<FakeRow | FakeInvitation>;
  error: null;
}

/** A PostgREST stand-in that, like the real server, never returns more than 1000 rows per request. */
class FakeQuery implements PromiseLike<FakeResult> {
  private window: [number, number] = [0, PAGE_CAP - 1];
  constructor(private readonly source: Array<FakeRow | FakeInvitation>) {}
  select(): this { return this; }
  eq(): this { return this; }
  neq(): this { return this; }
  is(): this { return this; }
  gt(): this { return this; }
  order(): this { return this; }
  range(from: number, to: number): this {
    this.window = [from, to];
    return this;
  }
  then<R1 = FakeResult, R2 = never>(
    onfulfilled?: ((value: FakeResult) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    const [from, to] = this.window;
    const size = Math.min(to - from + 1, PAGE_CAP);
    return Promise.resolve({ data: this.source.slice(from, from + size), error: null }).then(onfulfilled, onrejected);
  }
}

describe('GET /people past the 1000-row PostgREST cap (W8-PERF-D2)', () => {
  let app: Express;
  let role: OrgRole = 'owner';
  const db = {
    from: (table: string) =>
      new FakeQuery(table === 'people' || table === 'people_directory' ? rows : table === 'person_invitations' ? invitations : []),
    rpc: () => new FakeQuery([]),
  } as unknown as Db;

  beforeAll(async () => {
    const { peopleRouter } = await import('./people.js');
    const { errorHandler } = await import('../middleware/error-handler.js');
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.orgRole = role;
      req.orgId = 'org';
      req.auth = { userId: 'self', email: 'self@example.test', accessToken: 'token' };
      req.access = { organization_id: 'org', user_id: 'self', role, access_mode: 'legacy', can_administer_access: false, entries: [] };
      req.db = db;
      next();
    });
    app.use('/people', peopleRouter);
    app.use(errorHandler);
  });

  for (const reader of ['owner', 'member'] as const) {
    it(`returns every person to a ${reader}, not the first 1000`, async () => {
      role = reader;
      const response = await request(app).get('/people');
      expect(response.status).toBe(200);
      const ids = (response.body as { id: string }[]).map((person) => person.id);
      expect(ids).toHaveLength(PEOPLE_COUNT);
      expect(new Set(ids).size).toBe(PEOPLE_COUNT);
    });
  }

  it('marks a pending invitation past row 1000 of person_invitations', async () => {
    role = 'owner';
    const response = await request(app).get('/people');
    const people = response.body as Array<{ id: string; invite_pending: boolean }>;
    expect(people.find((person) => person.id === rows.at(-1)?.id)?.invite_pending).toBe(true);
    expect(people.every((person) => person.invite_pending)).toBe(true);
  });
});
