import { describe, expect, it } from 'vitest';
import type { PersonIdentityReconciliationRow } from '@service-center/shared';
import type { Db } from '../lib/supabase.js';

/**
 * W10-MAIL-D4: resolving an identity report answers with the decided report.
 * The database is a fake; the merge itself (and the report surviving it) is
 * covered by supabase/tests/reconciliation-merge.sql.
 */

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';

const { resolveReconciliation } = await import('./roster.js');

const ORG = '00000000-0000-4000-8000-000000000001';
const REPORT = '00000000-0000-4000-8000-000000000010';
const KEEP = '00000000-0000-4000-8000-000000000020';
const DROP = '00000000-0000-4000-8000-000000000030';

interface DirectoryRow {
  id: string;
  first_name: string;
  last_name: string | null;
}

interface RpcError {
  code: string;
  message: string;
}

interface FakeState {
  report: PersonIdentityReconciliationRow | null;
  directory: DirectoryRow[];
  rpcResult: PersonIdentityReconciliationRow | null;
  rpcError: RpcError | null;
  inCalls: unknown[][];
}

const openReport: PersonIdentityReconciliationRow = {
  id: REPORT,
  organization_id: ORG,
  profile_id: '00000000-0000-4000-8000-000000000040',
  person_id: KEEP,
  candidate_person_id: DROP,
  reason: 'invitation_conflict',
  status: 'open',
  resolved_by: null,
  resolved_at: null,
  created_at: '2026-11-22T10:00:00Z',
};

class FakeQuery implements PromiseLike<{ data: unknown; error: null }> {
  constructor(private readonly table: string, private readonly state: FakeState) {}
  select(): this { return this; }
  eq(): this { return this; }
  in(column: string, values: unknown[]): this {
    this.state.inCalls.push([this.table, column, values]);
    return this;
  }
  maybeSingle(): PromiseLike<{ data: unknown; error: null }> {
    return Promise.resolve({ data: this.state.report, error: null });
  }
  then<R1, R2 = never>(
    ok?: ((value: { data: unknown; error: null }) => R1 | PromiseLike<R1>) | null,
    fail?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    const ids = (this.state.inCalls.at(-1)?.[2] ?? []) as string[];
    const data = this.state.directory.filter((row) => ids.includes(row.id));
    return Promise.resolve({ data, error: null as null }).then(ok, fail);
  }
}

const fakeDb = (state: FakeState): Db =>
  ({
    from: (table: string) => new FakeQuery(table, state),
    rpc: async () => ({ data: state.rpcResult, error: state.rpcError }),
  }) as unknown as Db;

const baseState = (): FakeState => ({
  report: openReport,
  directory: [
    { id: KEEP, first_name: 'Sam', last_name: 'Member' },
    { id: DROP, first_name: 'Sam', last_name: 'Duplicate' },
  ],
  rpcResult: null,
  rpcError: null,
  inCalls: [],
});

describe('resolveReconciliation', () => {
  it('answers a merge with the merged report, naming the removed candidate', async () => {
    const state = baseState();
    state.rpcResult = {
      ...openReport,
      candidate_person_id: null,
      status: 'merged',
      resolved_by: '00000000-0000-4000-8000-000000000001',
      resolved_at: '2026-11-22T10:05:00Z',
    };
    const result = await resolveReconciliation({ db: fakeDb(state), orgId: ORG, id: REPORT, action: 'merge' });
    expect(result).toMatchObject({
      id: REPORT,
      status: 'merged',
      candidate_person_id: null,
      person_name: 'Sam Member',
      candidate_name: 'Sam Duplicate',
    });
  });

  it('never filters the directory by a missing id', async () => {
    const state = baseState();
    state.report = { ...openReport, status: 'merged', candidate_person_id: null, resolved_at: '2026-11-22T10:05:00Z' };
    state.rpcResult = state.report;
    const result = await resolveReconciliation({ db: fakeDb(state), orgId: ORG, id: REPORT, action: 'merge' });
    expect(state.inCalls).toEqual([['people_directory', 'id', [KEEP]]]);
    expect(result.candidate_name).toBe('Removed person');
  });

  it('answers 404 for a report the caller cannot see', async () => {
    const state = baseState();
    state.report = null;
    await expect(
      resolveReconciliation({ db: fakeDb(state), orgId: ORG, id: REPORT, action: 'merge' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('maps a blocked merge to 409', async () => {
    const state = baseState();
    state.rpcError = { code: 'PT409', message: 'Both records are on the same request; remove one first' };
    await expect(
      resolveReconciliation({ db: fakeDb(state), orgId: ORG, id: REPORT, action: 'merge' }),
    ).rejects.toMatchObject({ status: 409, code: 'reconciliation_blocked' });
  });

  it('answers 404 instead of an empty report when the function returns nothing', async () => {
    const state = baseState();
    state.rpcResult = null;
    await expect(
      resolveReconciliation({ db: fakeDb(state), orgId: ORG, id: REPORT, action: 'keep_separate' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
