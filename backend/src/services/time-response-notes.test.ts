import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key-that-is-long-enough';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-that-is-long-enough';
});

import type { AssignmentTimeResponseNote } from '@service-center/shared';
import type { Db } from '../lib/supabase.js';
import { PLAN_DETAIL_SELECT, fetchPlanDetail } from './plans.js';
import { timeResponseNotesFor } from './time-response-notes.js';
import { TIME_RESPONSE_COLUMNS, withResponseNote, type PublicTimeResponseRow } from '../model/time-response.model.js';

/**
 * W9-JRN-D1: a per-time decline reason is private. Postgres refuses the
 * `response_note` column to signed-in callers and hands it out only through
 * `assignment_time_response_notes` (assignee, response owner, schedulers).
 * These tests pin the API side: explicit columns, and a note only where that
 * function returned one. The audience itself is asserted in
 * supabase/tests/qa-wave9-time-response-privacy.sql.
 */

const ASSIGNMENT = '00000000-0000-4000-8000-0000000000a1';
const T09 = '00000000-0000-4000-8000-0000000000d1';
const T11 = '00000000-0000-4000-8000-0000000000d2';

const declined: PublicTimeResponseRow = {
  assignment_id: ASSIGNMENT,
  plan_time_id: T11,
  status: 'declined',
  actor_id: 'assignee',
  responded_at: '2026-11-21T00:00:00.000Z',
};
const confirmed: PublicTimeResponseRow = { ...declined, plan_time_id: T09, status: 'confirmed' };
const NOTE: AssignmentTimeResponseNote = { assignment_id: ASSIGNMENT, plan_time_id: T11, response_note: 'Out of town at 11' };

/** One PostgREST call the fake saw. */
interface RecordedCall {
  kind: 'from' | 'rpc';
  name: string;
  select?: string;
  args?: unknown;
}

/** A query builder whose every method chains and which resolves to `data`. */
const resolvingChain = (data: unknown, onSelect?: (columns: string) => void): unknown => {
  const chain: Record<string, unknown> = {};
  for (const method of ['eq', 'in', 'order', 'range', 'maybeSingle', 'is']) chain[method] = () => chain;
  chain.select = (columns: string) => {
    onSelect?.(columns);
    return chain;
  };
  chain.then = (resolve: (value: { data: unknown; error: null }) => unknown) => resolve({ data, error: null });
  return chain;
};

/** A database that holds one plan with one split per-time answer; `notes` is what Postgres would let the caller read. */
const fakeDb = (notes: AssignmentTimeResponseNote[]) => {
  const calls: RecordedCall[] = [];
  const plan = {
    id: 'plan',
    organization_id: 'org',
    title: 'Sunday',
    times: [],
    items: [],
    position_needs: [],
    plan_positions: [],
    assignments: [
      {
        id: ASSIGNMENT,
        person_id: 'person',
        user_id: null,
        status: 'unconfirmed',
        visibility: 'released',
        team: null,
        position: null,
        person: null,
        attendance_times: [],
        time_responses: [confirmed, declined],
      },
    ],
  };
  const db = {
    from: (name: string) => {
      const call: RecordedCall = { kind: 'from', name };
      calls.push(call);
      const data = name === 'plans' ? plan : name === 'organizations' ? null : [];
      return resolvingChain(data, (columns) => {
        call.select = columns;
      });
    },
    rpc: (name: string, args: unknown) => {
      calls.push({ kind: 'rpc', name, args });
      return resolvingChain(name === 'assignment_time_response_notes' ? notes : []);
    },
  } as unknown as Db;
  return { db, calls };
};

describe('time response columns', () => {
  it('never selects the private note or * for per-time answers on the plan detail', () => {
    expect(PLAN_DETAIL_SELECT).toContain(`time_responses:assignment_time_responses(${TIME_RESPONSE_COLUMNS})`);
    expect(PLAN_DETAIL_SELECT).not.toMatch(/assignment_time_responses\(\*\)/);
    expect(TIME_RESPONSE_COLUMNS).not.toContain('response_note');
    expect(TIME_RESPONSE_COLUMNS).not.toContain('*');
  });
});

describe('withResponseNote', () => {
  it('attaches the note only where the caller may read it', () => {
    const notes = new Map([[`${ASSIGNMENT}:${T11}`, 'Out of town at 11']]);
    expect(withResponseNote(declined, notes).response_note).toBe('Out of town at 11');
    expect(withResponseNote(confirmed, notes)).toEqual({ ...confirmed, response_note: null });
    expect(withResponseNote(declined, new Map()).response_note).toBeNull();
  });
});

describe('timeResponseNotesFor', () => {
  it('asks Postgres once per URL-safe batch of distinct ids', async () => {
    const { db, calls } = fakeDb([NOTE]);
    const ids = Array.from({ length: 150 }, (_, i) => `id-${i}`);
    const notes = await timeResponseNotesFor(db, [...ids, ...ids]);
    const rpcCalls = calls.filter((call) => call.name === 'assignment_time_response_notes');
    expect(rpcCalls.map((call) => (call.args as { p_assignment_ids: string[] }).p_assignment_ids.length)).toEqual([100, 50]);
    expect(notes.get(`${ASSIGNMENT}:${T11}`)).toBe('Out of town at 11');
  });

  it('makes no call without assignments', async () => {
    const { db, calls } = fakeDb([NOTE]);
    expect((await timeResponseNotesFor(db, [])).size).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe('GET /plans/:id shape (fetchPlanDetail)', () => {
  it('returns per-time statuses without the reason to a member outside the audience', async () => {
    const { db } = fakeDb([]);
    const detail = await fetchPlanDetail(db, 'org', 'plan');
    expect(detail.assignments[0]!.time_responses).toEqual([
      { ...confirmed, response_note: null },
      { ...declined, response_note: null },
    ]);
  });

  it('returns the reason to the assignee, response owner or a scheduler', async () => {
    const { db, calls } = fakeDb([NOTE]);
    const detail = await fetchPlanDetail(db, 'org', 'plan');
    expect(detail.assignments[0]!.time_responses).toEqual([
      { ...confirmed, response_note: null },
      { ...declined, response_note: 'Out of town at 11' },
    ]);
    expect(calls).toContainEqual({ kind: 'rpc', name: 'assignment_time_response_notes', args: { p_assignment_ids: [ASSIGNMENT] } });
  });
});
