import { beforeAll, describe, expect, it } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import type { OrgRole, RosterPersonPage } from '@service-center/shared';
import type { Db } from '../lib/supabase.js';

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';
process.env.CRON_SECRET ||= 'test-worker-secret-long-enough';

type Row = Record<string, unknown>;
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// 70 people; names repeat every 10 so equal sort_names must be ordered by id.
// Person 5 is archived, person 6 has a login (member) and person 7 a login that is inactive.
const people: Row[] = Array.from({ length: 70 }, (_, index) => {
  const first = `Name${String(index % 10).padStart(2, '0')}`;
  const last = index === 33 ? 'Zebra' : 'Person';
  return {
    id: uuid(index),
    organization_id: 'org',
    profile_id: index === 6 ? uuid(1006) : index === 7 ? uuid(1007) : null,
    first_name: first,
    last_name: last,
    sort_name: `${first} ${last}`.toLowerCase(),
    avatar_url: null,
    email: `p${index}@example.test`,
    phone: null,
    campus: index % 2 ? 'East' : 'West',
    archived_at: index === 5 ? '2026-01-01T00:00:00Z' : null,
    secret_note: 'owner only',
  };
});
const members: Row[] = [
  { organization_id: 'org', role: 'member', status: 'active', user_id: uuid(1006), profile: { id: uuid(1006), full_name: 'Login Six', avatar_url: null, created_at: 'x', updated_at: 'x' } },
];

const unquote = (value: string): string => value.replace(/^"|"$/g, '').replace(/\\(["\\])/g, '$1');

class FakeQuery implements PromiseLike<{ data: Row[]; error: null }> {
  private rows: Row[];
  constructor(private readonly table: string, source: Row[], private readonly columns: string[] | null) {
    this.rows = [...source];
  }
  select(): this { return this; }
  neq(): this { return this; }
  eq(column: string, value: unknown): this { this.rows = this.rows.filter((r) => r[column] === value); return this; }
  is(column: string, value: null): this { this.rows = this.rows.filter((r) => (r[column] ?? null) === value); return this; }
  in(column: string, values: unknown[]): this {
    const key = this.table === 'organization_members' && column === 'user_id' ? 'user_id' : column;
    this.rows = this.rows.filter((r) => values.includes(r[key]));
    return this;
  }
  gt(): this { return this; }
  or(filter: string): this {
    const ilike = [...filter.matchAll(/(\w+)\.ilike\.("(?:[^"\\]|\\.)*")/g)];
    if (ilike.length) {
      const needle = unquote(ilike[0]![2]!).replace(/^%|%$/g, '');
      this.rows = this.rows.filter((r) => ilike.some((m) => String(r[m[1]!] ?? '').toLowerCase().includes(needle)));
      return this;
    }
    const gt = /^sort_name\.gt\.("(?:[^"\\]|\\.)*"),and\(sort_name\.eq\.("(?:[^"\\]|\\.)*"),id\.gt\.([0-9a-f-]+)\)$/.exec(filter);
    if (!gt) throw new Error(`Unexpected or filter: ${filter}`);
    const [, name, , id] = gt.map((part, index) => (index === 1 || index === 2 ? unquote(part!) : part)) as string[];
    this.rows = this.rows.filter((r) => String(r.sort_name) > name! || (r.sort_name === name && String(r.id) > id!));
    return this;
  }
  private orderBy: string[] = [];
  private max = Infinity;
  order(column: string): this { this.orderBy.push(column); return this; }
  limit(count: number): this { this.max = count; return this; }
  then<R1 = { data: Row[]; error: null }, R2 = never>(
    ok?: ((value: { data: Row[]; error: null }) => R1 | PromiseLike<R1>) | null,
    fail?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    this.rows.sort((a, b) => {
      for (const column of this.orderBy) {
        const left = String(a[column]);
        const right = String(b[column]);
        if (left !== right) return left < right ? -1 : 1;
      }
      return 0;
    });
    this.rows = this.rows.slice(0, this.max);
    // people_directory has no secret column; people (owner) does not either in PERSON_COLUMNS.
    const data = this.rows.map((row) => {
      if (this.table !== 'people_directory') return row;
      const { secret_note: _drop, email: _email, ...rest } = row;
      return rest;
    });
    void this.columns;
    return Promise.resolve({ data, error: null }).then(ok, fail);
  }
}

describe('GET /people/page', () => {
  let app: Express;
  let role: OrgRole = 'owner';
  const tables: string[] = [];
  const db = {
    from: (table: string) => {
      tables.push(table);
      if (table === 'people' || table === 'people_directory') return new FakeQuery(table, people, null);
      if (table === 'organization_members') return new FakeQuery(table, members, null);
      return new FakeQuery(table, [], null);
    },
    rpc: () => new FakeQuery('rpc', [], null),
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

  const readAll = async (query: Record<string, string>): Promise<string[]> => {
    const ids: string[] = [];
    let cursor: string | null = null;
    for (let pages = 0; pages < 10; pages += 1) {
      const response: request.Response = await request(app).get('/people/page').query({ ...query, ...(cursor ? { cursor } : {}) });
      expect(response.status).toBe(200);
      const body = response.body as RosterPersonPage;
      expect(body.items.length).toBeLessThanOrEqual(25);
      ids.push(...body.items.map((item) => item.person_id as string));
      cursor = body.next_cursor;
      if (!cursor) return ids;
    }
    throw new Error('did not terminate');
  };

  it('defaults to 25 rows and reaches every active person across 3 pages without loss or repeats', async () => {
    role = 'owner';
    const first = await request(app).get('/people/page');
    expect((first.body as RosterPersonPage).items).toHaveLength(25);
    const ids = await readAll({});
    // 70 people minus the archived one and the inactive-login one.
    expect(ids).toHaveLength(68);
    expect(new Set(ids).size).toBe(68);
    expect(ids).not.toContain(uuid(5));
    expect(ids).not.toContain(uuid(7));
  });

  it('orders by name, breaking equal names by id', async () => {
    const ids = await readAll({});
    const names = ids.map((id) => people.find((p) => p.id === id)!.sort_name as string);
    expect(names).toEqual([...names].sort());
    const sameName = ids.filter((id) => people.find((p) => p.id === id)!.sort_name === 'name00 person');
    expect(sameName).toEqual([...sameName].sort());
    expect(sameName.length).toBeGreaterThan(1);
  });

  it('includes archived people on request', async () => {
    expect(await readAll({ include_archived: 'true' })).toContain(uuid(5));
  });

  it('finds a person beyond the first page by search', async () => {
    const ids = await readAll({ q: 'zebra' });
    expect(ids).toEqual([uuid(33)]);
    expect(await readAll({ q: 'p41@example' })).toEqual([uuid(41)]);
  });

  it('shapes a has-login member like GET /people', async () => {
    const ids = await readAll({ q: 'name06' });
    expect(ids).toContain(uuid(6));
    const response = await request(app).get('/people/page').query({ q: 'name06 person', limit: 100 });
    const six = (response.body as RosterPersonPage).items.find((item) => item.person_id === uuid(6));
    expect(six).toMatchObject({ id: uuid(1006), has_login: true, full_name: 'Login Six', role: 'member' });
  });

  it('gives a non-owner the directory only, without email or phone', async () => {
    role = 'member';
    tables.length = 0;
    const response = await request(app).get('/people/page').query({ limit: 100 });
    expect(response.status).toBe(200);
    expect(tables).toContain('people_directory');
    expect(tables).not.toContain('people');
    const items = (response.body as RosterPersonPage).items;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.email).toBeNull();
      expect(item.phone).toBeNull();
    }
    // Searching by an email the caller cannot read finds nothing.
    expect(await readAll({ q: 'p41@example' })).toEqual([]);
  });

  it('rejects a forged cursor and an oversize limit', async () => {
    role = 'owner';
    expect((await request(app).get('/people/page').query({ cursor: 'forged' })).status).toBe(400);
    expect((await request(app).get('/people/page').query({ limit: 101 })).status).toBe(422);
  });
});
