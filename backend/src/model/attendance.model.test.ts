import { describe, expect, it } from 'vitest';
import type { AttendanceConflict, AttendanceInterval, PlanTimeImpactAssignment, PlanTimeRow } from '@service-center/shared';
import {
  assignLegacyTimeIds,
  impactConflictCandidates,
  isUntimed,
  parseConflictDetail,
  recipientSequence,
  summarizeConflicts,
  timesForAttendance,
} from './attendance.model.js';

const NINE = { id: 't-9', kind: 'service' as const, starts_at: '2027-01-03T09:00:00.000Z', ends_at: '2027-01-03T10:00:00.000Z' };
const ELEVEN = { id: 't-11', kind: 'service' as const, starts_at: '2027-01-03T11:00:00.000Z', ends_at: '2027-01-03T12:00:00.000Z' };

const sequentialIds = () => {
  let next = 0;
  return () => `new-${++next}`;
};

describe('assignLegacyTimeIds', () => {
  it('keeps the identity of unchanged times regardless of list order', () => {
    const result = assignLegacyTimeIds(
      [
        { kind: 'service', starts_at: '2027-01-03T11:00:00Z', ends_at: '2027-01-03T12:00:00Z' },
        { kind: 'service', starts_at: '2027-01-03T09:00:00Z', ends_at: '2027-01-03T10:00:00Z' },
      ],
      [NINE, ELEVEN],
      sequentialIds(),
    );
    expect(result.map((time) => time.id)).toEqual(['t-11', 't-9']);
    expect(result.map((time) => time.sort_order)).toEqual([0, 1]);
  });

  it('never moves an id onto an edited time by position', () => {
    const result = assignLegacyTimeIds(
      [
        { kind: 'service', starts_at: '2027-01-03T09:30:00Z', ends_at: '2027-01-03T10:30:00Z' },
        { kind: 'service', starts_at: '2027-01-03T11:00:00Z', ends_at: '2027-01-03T12:00:00Z' },
      ],
      [NINE, ELEVEN],
      sequentialIds(),
    );
    expect(result.map((time) => time.id)).toEqual(['new-1', 't-11']);
  });

  it('does not claim an id twice and respects explicit ids', () => {
    const result = assignLegacyTimeIds(
      [
        { id: 't-9', kind: 'service', starts_at: NINE.starts_at, ends_at: NINE.ends_at },
        { kind: 'service', starts_at: NINE.starts_at, ends_at: NINE.ends_at },
      ],
      [NINE],
      sequentialIds(),
    );
    expect(result.map((time) => time.id)).toEqual(['t-9', 'new-1']);
  });

  it('treats a changed kind as a different time', () => {
    const [time] = assignLegacyTimeIds(
      [{ kind: 'rehearsal', starts_at: NINE.starts_at, ends_at: NINE.ends_at, name: '  ' }],
      [NINE],
      sequentialIds(),
    );
    expect(time).toMatchObject({ id: 'new-1', name: null });
  });
});

const conflict = (overrides: Partial<AttendanceConflict>): AttendanceConflict => ({
  candidate_key: '0',
  person_id: 'p1',
  kind: 'overlapping_commitment',
  severity: 'blocking',
  plan_time_id: 't-9',
  interval_source: 'plan_time',
  starts_at: NINE.starts_at,
  ends_at: NINE.ends_at,
  other_plan_id: null,
  other_assignment_id: null,
  other_plan_time_id: null,
  other_time_kind: null,
  detail: 'Another commitment',
  redacted: true,
  ...overrides,
});

describe('summarizeConflicts', () => {
  it('lists only candidates with blocking conflicts', () => {
    const result = summarizeConflicts([
      conflict({ candidate_key: '0', override_permitted: true }),
      conflict({ candidate_key: '1', severity: 'warning', override_permitted: false }),
    ]);
    expect(result.blocked_candidates).toEqual(['0']);
    expect(result.override_permitted).toBe(true);
  });

  it('refuses the override when any blocking conflict is not permitted', () => {
    const result = summarizeConflicts([
      conflict({ candidate_key: '0', override_permitted: true }),
      conflict({ candidate_key: '1', kind: 'blockout', override_permitted: false }),
    ]);
    expect(result.override_permitted).toBe(false);
  });
});

describe('parseConflictDetail', () => {
  it('reads the commit-time trigger detail', () => {
    const detail = JSON.stringify([
      {
        candidate_key: 'a1',
        person_id: 'p1',
        kind: 'blockout',
        severity: 'blocking',
        plan_time_id: null,
        interval_source: 'untimed_fallback',
        starts_at: NINE.starts_at,
        ends_at: NINE.ends_at,
        other_time_kind: 'rehearsal',
        detail: 'Unavailable',
        redacted: false,
      },
    ]);
    expect(parseConflictDetail(detail)).toEqual([
      expect.objectContaining({ kind: 'blockout', interval_source: 'untimed_fallback', other_time_kind: 'rehearsal' }),
    ]);
  });

  it('drops malformed entries and non-JSON detail', () => {
    expect(parseConflictDetail('not json')).toEqual([]);
    expect(parseConflictDetail(null)).toEqual([]);
    expect(parseConflictDetail(JSON.stringify([{ kind: 'nope' }, 'x', null]))).toEqual([]);
    expect(parseConflictDetail(JSON.stringify({ kind: 'blockout' }))).toEqual([]);
  });
});

const interval = (overrides: Partial<AttendanceInterval>): AttendanceInterval => ({
  assignment_id: 'a1',
  plan_time_id: 't-9',
  kind: 'service',
  name: null,
  starts_at: NINE.starts_at,
  ends_at: NINE.ends_at,
  source: 'plan_time',
  ...overrides,
});

describe('attendance helpers', () => {
  it('keeps only the stored times an assignment covers, in time order', () => {
    const times = [ELEVEN, NINE].map((time) => ({ ...time, plan_id: 'p', name: null, ics_sequence: 0, revision: 0, sort_order: 0, created_at: '' })) as PlanTimeRow[];
    expect(timesForAttendance([interval({})], times).map((time) => time.id)).toEqual(['t-9']);
  });

  it('labels a plan without times as untimed, never a real time', () => {
    expect(isUntimed([interval({ plan_time_id: null, source: 'untimed_fallback' })])).toBe(true);
    expect(isUntimed([interval({})])).toBe(false);
    expect(isUntimed([])).toBe(false);
  });

  it('adds the recipient offset to the time sequence', () => {
    expect(recipientSequence(3, 2)).toBe(5);
    expect(recipientSequence(3, undefined)).toBe(3);
  });
});

describe('impactConflictCandidates', () => {
  const affected = (overrides: Partial<PlanTimeImpactAssignment>): PlanTimeImpactAssignment => ({
    assignment_id: 'a1',
    person_id: 'p1',
    team_id: 'team',
    position_id: null,
    status: 'confirmed',
    visibility: 'released',
    attendance_mode: 'all',
    request_revision: 1,
    gains: [],
    loses: [],
    changed: [],
    after: ['t-9', 'new-1'],
    orphaned: false,
    ...overrides,
  });

  it('checks only the times a request gains or that move, with their proposed intervals', () => {
    const proposed = assignLegacyTimeIds(
      [
        { id: 't-9', kind: 'service', starts_at: '2027-01-03T09:30:00Z', ends_at: '2027-01-03T10:30:00Z' },
        { kind: 'rehearsal', starts_at: '2027-01-01T19:00:00Z', ends_at: '2027-01-01T21:00:00Z' },
      ],
      [NINE],
      sequentialIds(),
    );
    const candidates = impactConflictCandidates(
      { plan_id: 'plan', assignments: [affected({ gains: ['new-1'] }), affected({ assignment_id: 'a2', loses: ['t-11'], after: ['t-9'] })] },
      proposed,
    );
    expect(candidates).toEqual([
      {
        key: 'a1',
        person_id: 'p1',
        plan_id: 'plan',
        team_id: 'team',
        position_id: null,
        intervals: [
          { plan_time_id: 'new-1', starts_at: '2027-01-01T19:00:00Z', ends_at: '2027-01-01T21:00:00Z' },
        ],
      },
    ]);
  });
});
