import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { decodePeopleCursor, encodePeopleCursor, staffingMatrixQuerySchema } from '@service-center/shared';
import type { Db } from '../lib/supabase.js';

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';
process.env.CRON_SECRET ||= 'test-worker-secret-long-enough';

type Row = Record<string, unknown>;
type Call = [string, ...unknown[]];

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Schedulable People with names out of id order, so name order differs from id order. */
const PEOPLE: Row[] = [
  { id: uuid(3), first_name: 'Anh', last_name: 'Lê', avatar_url: null, campus: null, sort_name: 'anh lê' },
  { id: uuid(1), first_name: 'Bảo', last_name: null, avatar_url: null, campus: null, sort_name: 'bảo' },
  { id: uuid(2), first_name: 'Bảo', last_name: null, avatar_url: null, campus: null, sort_name: 'bảo' },
  { id: uuid(9), first_name: 'Chi', last_name: null, avatar_url: null, campus: null, sort_name: 'chi' },
  { id: uuid(4), first_name: 'Dũng', last_name: null, avatar_url: null, campus: null, sort_name: 'dũng' },
];
const PLAN: Row = {
  id: uuid(100), title: 'Sunday', service_date: '2026-12-06T10:00:00Z', service_type_id: null, staffing_revision: 1,
  service_type: null, times: [], position_needs: [],
};

const compare = (a: Row, b: Row): number =>
  String(a.sort_name) < String(b.sort_name) ? -1 : String(a.sort_name) > String(b.sort_name) ? 1 : String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;

/** people_directory with the keyset `or` filter, order direction and limit applied; everything else recorded. */
class Query implements PromiseLike<{ data: Row[] | null; error: null }> {
  private ascending = true;
  private max = Infinity;
  private keyset: { op: 'gt' | 'lt'; name: string; id: string } | null = null;
  constructor(private readonly table: string, private readonly calls: Call[], private readonly rows: Row[]) {}
  select(...args: unknown[]): this { this.calls.push(['select', this.table, ...args]); return this; }
  private idEquals: unknown = undefined;
  eq(...args: unknown[]): this {
    this.calls.push(['eq', this.table, ...args]);
    if (args[0] === 'id') this.idEquals = args[1];
    return this;
  }
  neq(): this { return this; }
  gte(): this { return this; }
  lte(): this { return this; }
  in(...args: unknown[]): this { this.calls.push(['in', this.table, ...args]); return this; }
  filter(...args: unknown[]): this { this.calls.push(['filter', this.table, ...args]); return this; }
  or(filter: string): this {
    const match = /^sort_name\.(gt|lt)\."((?:[^"\\]|\\.)*)",and\(sort_name\.eq\."(?:[^"\\]|\\.)*",id\.(?:gt|lt)\.([0-9a-f-]+)\)$/.exec(filter);
    if (!match) throw new Error(`Unexpected or filter ${filter}`);
    this.keyset = { op: match[1] as 'gt' | 'lt', name: match[2]!.replace(/\\(.)/g, '$1'), id: match[3]! };
    return this;
  }
  order(column: string, options?: { ascending?: boolean }): this {
    if (column === 'sort_name') this.ascending = options?.ascending ?? true;
    return this;
  }
  limit(count: number): this { this.max = count; return this; }
  range(): this { return this; }
  maybeSingle(): PromiseLike<{ data: Row | null; error: null }> {
    return Promise.resolve({ data: this.rows.find((row) => row.id === this.idEquals) ?? null, error: null });
  }
  then<R1 = { data: Row[] | null; error: null }, R2 = never>(
    ok?: ((value: { data: Row[] | null; error: null }) => R1 | PromiseLike<R1>) | null,
    fail?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    let rows = [...this.rows];
    const keyset = this.keyset;
    if (keyset) {
      const cursor = { sort_name: keyset.name, id: keyset.id };
      rows = rows.filter((row) => (keyset.op === 'gt' ? compare(row, cursor) > 0 : compare(row, cursor) < 0));
    }
    rows.sort((a, b) => (this.ascending ? compare(a, b) : compare(b, a)));
    return Promise.resolve({ data: rows.slice(0, this.max), error: null }).then(ok, fail);
  }
}

const requestFor = (calls: Call[]): Request => {
  const db = {
    from: (table: string) => {
      if (table === 'plans') return new Query(table, calls, [PLAN]);
      if (table === 'teams') return new Query(table, calls, [{ id: uuid(500), name: 'Band', service_type_id: null }]);
      if (table === 'people_directory') return new Query(table, calls, PEOPLE);
      return new Query(table, calls, []);
    },
    rpc: () => Promise.resolve({ data: [], error: null }),
  } as unknown as Db;
  return {
    db,
    orgId: 'org',
    auth: { userId: 'self', email: 'x@example.test', accessToken: 't' },
    access: {
      organization_id: 'org', user_id: 'self', role: 'owner', access_mode: 'legacy', can_administer_access: true,
      entries: [{ capability: 'scheduling.manage', scope_type: 'organization', scope_id: null, source: 'role:owner', grant_id: null }],
    },
  } as unknown as Request;
};

const FILTERS = { from: '2026-12-01T00:00:00Z', to: '2026-12-31T00:00:00Z' };
const names = (people: Array<{ id: string }>): string[] => people.map((person) => person.id);

describe('staffing matrix People paging', () => {
  it('orders by name then id, and pages forward and back with stable cursors', async () => {
    const { loadStaffingMatrix } = await import('./staffing-matrix.js');
    const first = await loadStaffingMatrix(requestFor([]), staffingMatrixQuerySchema.parse({ filters: FILTERS, page_size: 2 }));
    expect(names(first.people)).toEqual([uuid(3), uuid(1)]);
    expect(first.prev_cursor).toBeNull();
    expect(decodePeopleCursor(first.next_cursor!)).toEqual({ sort_name: 'bảo', id: uuid(1) });

    const second = await loadStaffingMatrix(requestFor([]), staffingMatrixQuerySchema.parse({ filters: FILTERS, page_size: 2, cursor: first.next_cursor }));
    // The two "bảo" rows split across pages without loss: equal names break by id.
    expect(names(second.people)).toEqual([uuid(2), uuid(9)]);
    expect(second.prev_cursor).not.toBeNull();

    const third = await loadStaffingMatrix(requestFor([]), staffingMatrixQuerySchema.parse({ filters: FILTERS, page_size: 2, cursor: second.next_cursor }));
    expect(names(third.people)).toEqual([uuid(4)]);
    expect(third.next_cursor).toBeNull();

    const back = await loadStaffingMatrix(requestFor([]), staffingMatrixQuerySchema.parse({ filters: FILTERS, page_size: 2, cursor: second.prev_cursor, direction: 'prev' }));
    expect(names(back.people)).toEqual(names(first.people));
    expect(back.prev_cursor).toBeNull();
    expect(back.next_cursor).toBe(first.next_cursor);
  });

  it('continues after a legacy bare-id cursor at that Person’s name', async () => {
    const { loadStaffingMatrix } = await import('./staffing-matrix.js');
    const calls: Call[] = [];
    const page = await loadStaffingMatrix(
      requestFor(calls),
      staffingMatrixQuerySchema.parse({ filters: FILTERS, page_size: 2, cursor: uuid(1) }),
    );
    expect(calls).toContainEqual(['eq', 'people_directory', 'id', uuid(1)]);
    // After "bảo"/uuid(1) by name: the other "bảo" (uuid(2)), then "chi".
    expect(names(page.people)).toEqual([uuid(2), uuid(9)]);
    expect(page.prev_cursor).not.toBeNull();
    await expect(loadStaffingMatrix(requestFor([]), staffingMatrixQuerySchema.parse({ filters: FILTERS, cursor: uuid(777) })))
      .rejects.toMatchObject({ status: 400 });
    expect(encodePeopleCursor({ sort_name: 'bảo', id: uuid(1) })).not.toBe(uuid(1));
  });

  it('searches search_text by folded word and filters teams in SQL (no id chunking)', async () => {
    const { loadStaffingMatrix } = await import('./staffing-matrix.js');
    const calls: Call[] = [];
    const team = uuid(500);
    await loadStaffingMatrix(
      requestFor(calls),
      staffingMatrixQuerySchema.parse({ filters: { ...FILTERS, search: 'Dũng  LÊ', team_ids: [team] }, page_size: 2 }),
    );
    const people = calls.filter((call) => call[1] === 'people_directory');
    expect(people).toContainEqual(['filter', 'people_directory', 'search_text', 'imatch', 'dung']);
    expect(people).toContainEqual(['filter', 'people_directory', 'search_text', 'imatch', 'le']);
    expect(people).toContainEqual(['in', 'people_directory', 'team_memberships.team_id', [team]]);
    expect(people.find((call) => call[0] === 'select')?.[2]).toContain('team_memberships!inner()');
    expect(calls.some((call) => call[1] === 'team_memberships')).toBe(false);
  });
});
