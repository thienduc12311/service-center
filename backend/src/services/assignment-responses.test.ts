import { describe, expect, it, vi } from 'vitest';
import type { AssignmentRow } from '@service-center/shared';

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';

const { latestDeclineReasons, respondToOwnAssignment, STALE_RESPONSE_CODE, FORBIDDEN_RESPONSE_CODE } =
  await import('./assignment-responses.js');
type Db = import('../lib/supabase.js').Db;

interface RecordedQuery {
  /** Table name, or `rpc:<function>` for a database function call. */
  target: string;
  calls: Array<[string, unknown[]]>;
}

/**
 * A PostgREST stand-in: each `from()`/`rpc()` takes the next queued result,
 * and every chained call is recorded so tests can assert what was sent.
 */
const fakeDb = (results: Array<{ data: unknown; error: null }>) => {
  const queries: RecordedQuery[] = [];
  const start = (target: string, initial: Array<[string, unknown[]]> = []) => {
    const recorded: RecordedQuery = { target, calls: [...initial] };
    queries.push(recorded);
    const result = results.shift() ?? { data: null, error: null };
    const builder: Record<string, unknown> = {
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
      maybeSingle: () => Promise.resolve(result),
    };
    for (const method of ['select', 'eq', 'in', 'order']) {
      builder[method] = (...args: unknown[]) => {
        recorded.calls.push([method, args]);
        return builder;
      };
    }
    return builder;
  };
  const from = vi.fn((table: string) => start(table));
  const rpc = vi.fn((name: string, args: unknown) => start(`rpc:${name}`, [['args', [args]]]));
  return { db: { from, rpc } as unknown as Db, queries };
};

const assignment = (status: AssignmentRow['status']): AssignmentRow & { plan: unknown } => ({
  id: 'assignment-1',
  plan_id: 'plan-1',
  user_id: 'user-1',
  team_id: 'team-1',
  position_id: 'position-1',
  status,
  notes: 'Bring your in-ears',
  notified_at: null,
  responded_at: null,
  created_by: 'scheduler-1',
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
  plan: { organization_id: 'org-1' },
});

const base = { orgId: 'org-1', userId: 'user-1', assignmentId: 'assignment-1' } as const;

describe('respondToOwnAssignment', () => {
  it('withdraws a confirmation with its reason, compare-and-set on the status read', async () => {
    const { db, queries } = fakeDb([
      { data: assignment('confirmed'), error: null },
      { data: [assignment('declined')], error: null },
    ]);

    const outcome = await respondToOwnAssignment({
      ...base,
      db,
      status: 'declined',
      reason: 'Travelling',
      expectedStatus: 'confirmed',
    });

    expect(outcome.transition).toBe('withdrawal');
    expect(outcome.previousStatus).toBe('confirmed');
    expect(queries[1]).toEqual({
      target: 'rpc:respond_to_own_assignment',
      calls: [
        [
          'args',
          [
            {
              p_assignment_id: 'assignment-1',
              p_status: 'declined',
              p_expected_status: 'confirmed',
              p_reason: 'Travelling',
            },
          ],
        ],
      ],
    });
  });

  it('only reads the assignment within the active organization', async () => {
    const { db, queries } = fakeDb([{ data: null, error: null }]);
    await expect(
      respondToOwnAssignment({ ...base, db, status: 'confirmed', reason: null }),
    ).rejects.toMatchObject({ status: 404 });
    expect(queries[0]!.calls).toContainEqual(['eq', ['plan.organization_id', 'org-1']]);
  });

  it('refuses a stale answer instead of turning a decline into an unreviewed withdrawal', async () => {
    const { db, queries } = fakeDb([{ data: assignment('confirmed'), error: null }]);
    await expect(
      respondToOwnAssignment({ ...base, db, status: 'declined', reason: null, expectedStatus: 'unconfirmed' }),
    ).rejects.toMatchObject({ status: 409, code: STALE_RESPONSE_CODE, details: { status: 'confirmed' } });
    expect(queries).toHaveLength(1);
  });

  it('never re-accepts a declined assignment', async () => {
    const { db, queries } = fakeDb([{ data: assignment('declined'), error: null }]);
    await expect(
      respondToOwnAssignment({ ...base, db, status: 'confirmed', reason: null }),
    ).rejects.toMatchObject({ status: 409, code: FORBIDDEN_RESPONSE_CODE });
    expect(queries).toHaveLength(1);
  });

  it('treats a retry of an answer that already committed as unchanged', async () => {
    const { db, queries } = fakeDb([{ data: assignment('confirmed'), error: null }]);
    // The client still believes it is unconfirmed: its first attempt timed out.
    const outcome = await respondToOwnAssignment({
      ...base,
      db,
      status: 'confirmed',
      reason: null,
      expectedStatus: 'unconfirmed',
    });
    expect(outcome.transition).toBe('unchanged');
    expect(queries).toHaveLength(1);
  });

  it('reports a status changed between read and write as stale', async () => {
    const { db } = fakeDb([
      { data: assignment('unconfirmed'), error: null },
      { data: [], error: null },
      { data: { status: 'declined' }, error: null },
    ]);
    await expect(
      respondToOwnAssignment({ ...base, db, status: 'confirmed', reason: null, expectedStatus: 'unconfirmed' }),
    ).rejects.toMatchObject({ status: 409, code: STALE_RESPONSE_CODE, details: { status: 'declined' } });
  });

  it("refuses someone else's assignment", async () => {
    const { db } = fakeDb([{ data: { ...assignment('unconfirmed'), user_id: 'user-2' }, error: null }]);
    await expect(
      respondToOwnAssignment({ ...base, db, status: 'confirmed', reason: null }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('latestDeclineReasons', () => {
  it('uses only the most recent decline, even when it had no reason', async () => {
    const { db, queries } = fakeDb([
      {
        data: [
          { assignment_id: 'a1', response_note: null, created_at: '2026-10-10T00:00:00.000Z' },
          { assignment_id: 'a1', response_note: 'Old reason', created_at: '2026-10-01T00:00:00.000Z' },
          { assignment_id: 'a2', response_note: 'Travelling', created_at: '2026-10-05T00:00:00.000Z' },
        ],
        error: null,
      },
    ]);

    const reasons = await latestDeclineReasons(db, ['a1', 'a2']);
    expect([...reasons]).toEqual([['a2', 'Travelling']]);
    expect(queries[0]!.calls).toContainEqual(['order', ['created_at', { ascending: false }]]);
  });

  it('does not query for an empty list', async () => {
    const { db, queries } = fakeDb([]);
    expect((await latestDeclineReasons(db, [])).size).toBe(0);
    expect(queries).toHaveLength(0);
  });
});
