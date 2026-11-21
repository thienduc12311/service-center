import type { Db } from '../lib/supabase.js';

/** PostgREST never returns more than this many rows per request. */
export const PAGE_CAP = 1000;

export type FakeRow = Record<string, unknown>;

export interface FakeResult {
  data: FakeRow[];
  error: null;
}

/** One `.rpc()` call as the fake saw it. */
export interface FakeRpcCall {
  fn: string;
  args: Record<string, unknown>;
  eq: Array<[string, unknown]>;
  order: string[];
  range: [number, number] | null;
}

/** What `pagedDb` records, for assertions. */
export interface FakeLog {
  /** Every `.in()` list, in call order. */
  inCalls: string[][];
  rpcCalls: FakeRpcCall[];
}

/**
 * Test stand-in for a PostgREST query that, like the real server, never
 * returns more than 1000 rows per request. It records every `.in()` list so
 * tests can assert how ids were chunked. Table queries ignore `.eq()`; a
 * function result (`rpc`) applies it, since its rows carry the output columns.
 */
export class PagedFakeQuery implements PromiseLike<FakeResult> {
  private window: [number, number] = [0, PAGE_CAP - 1];
  private inFilter: { column: string; values: readonly string[] } | null = null;
  private readonly eqFilters: Array<[string, unknown]> = [];
  constructor(
    private readonly source: FakeRow[],
    private readonly inCalls: string[][] = [],
    private readonly rpcCall: FakeRpcCall | null = null,
  ) {}
  select(): this { return this; }
  eq(column: string, value: unknown): this {
    if (this.rpcCall) {
      this.eqFilters.push([column, value]);
      this.rpcCall.eq.push([column, value]);
    }
    return this;
  }
  is(): this { return this; }
  gte(): this { return this; }
  lte(): this { return this; }
  not(): this { return this; }
  order(column: string): this {
    this.rpcCall?.order.push(column);
    return this;
  }
  in(column: string, values: readonly string[]): this {
    this.inFilter = { column, values };
    this.inCalls.push([...values]);
    return this;
  }
  maybeSingle(): PromiseLike<{ data: FakeRow | null; error: null }> {
    return Promise.resolve({ data: this.source[0] ?? null, error: null });
  }
  range(from: number, to: number): this {
    this.window = [from, to];
    if (this.rpcCall) this.rpcCall.range = [from, to];
    return this;
  }
  then<R1 = FakeResult, R2 = never>(
    onfulfilled?: ((value: FakeResult) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    const filter = this.inFilter;
    let rows = filter ? this.source.filter((row) => filter.values.includes(String(row[filter.column]))) : this.source;
    for (const [column, value] of this.eqFilters) rows = rows.filter((row) => row[column] === value);
    const [from, to] = this.window;
    const size = Math.min(to - from + 1, PAGE_CAP);
    return Promise.resolve({ data: rows.slice(from, from + size), error: null }).then(onfulfilled, onrejected);
  }
}

/**
 * A `Db` whose tables (and function results, `rpcs`) are the given row
 * arrays; unknown tables and functions are empty.
 */
export const pagedDb = (
  tables: Record<string, FakeRow[]>,
  inCalls: string[][] = [],
  rpcs: Record<string, FakeRow[]> = {},
  log: FakeLog = { inCalls, rpcCalls: [] },
): Db =>
  ({
    from: (table: string) => new PagedFakeQuery(tables[table] ?? [], inCalls),
    rpc: (fn: string, args: Record<string, unknown> = {}) => {
      const call: FakeRpcCall = { fn, args, eq: [], order: [], range: null };
      log.rpcCalls.push(call);
      return new PagedFakeQuery(rpcs[fn] ?? [], inCalls, call);
    },
  }) as unknown as Db;

export const uuid = (index: number): string => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
