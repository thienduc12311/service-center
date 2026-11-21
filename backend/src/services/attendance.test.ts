import { describe, expect, it } from 'vitest';
import { pagedDb, uuid, type FakeLog, type FakeRow } from '../routes/paged-fake.js';

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';
process.env.CRON_SECRET ||= 'test-worker-secret-long-enough';

const ASSIGNMENTS = 400;
const TIMES_EACH = 3;

describe('attendanceFor past the 1000-row cap', () => {
  it('keeps every interval when one chunk yields more than 1000 rows', async () => {
    const assignmentIds = Array.from({ length: ASSIGNMENTS }, (_, index) => uuid(index));
    const rows: FakeRow[] = assignmentIds.flatMap((assignmentId, a) =>
      Array.from({ length: TIMES_EACH }, (_, t) => ({
        assignment_id: assignmentId,
        plan_time_id: uuid(100_000 + a * TIMES_EACH + t),
        kind: 'service',
        name: null,
        starts_at: new Date(Date.UTC(2026, 11, 6, 9 + t)).toISOString(),
        ends_at: new Date(Date.UTC(2026, 11, 6, 10 + t)).toISOString(),
        source: 'plan_time',
      })),
    );
    const log: FakeLog = { inCalls: [], rpcCalls: [] };
    const db = pagedDb({}, log.inCalls, { assignment_attendance_for: rows }, log);
    const { attendanceFor } = await import('./attendance.js');

    const grouped = await attendanceFor(db, assignmentIds);

    expect(rows.length).toBeGreaterThan(1000);
    expect(grouped.size).toBe(ASSIGNMENTS);
    expect(grouped.get(uuid(ASSIGNMENTS - 1))).toHaveLength(TIMES_EACH);
    expect([...grouped.values()].every((list) => list.length === TIMES_EACH)).toBe(true);
    expect(log.rpcCalls).toHaveLength(2);
    expect(log.rpcCalls[0]?.order).toEqual(['assignment_id', 'plan_time_id']);
    expect(log.rpcCalls.map((call) => call.range)).toEqual([[0, 999], [1000, 1999]]);
  });

  it('asks the resolver for bounded id chunks', async () => {
    const assignmentIds = Array.from({ length: 1201 }, (_, index) => uuid(index));
    const log: FakeLog = { inCalls: [], rpcCalls: [] };
    const db = pagedDb({}, log.inCalls, {}, log);
    const { attendanceFor, ATTENDANCE_ID_CHUNK } = await import('./attendance.js');

    await attendanceFor(db, assignmentIds);

    const sent = log.rpcCalls.map((call) => (call.args.p_assignment_ids as string[]).length);
    expect(sent).toEqual([ATTENDANCE_ID_CHUNK, ATTENDANCE_ID_CHUNK, 1201 - 2 * ATTENDANCE_ID_CHUNK]);
  });
});
