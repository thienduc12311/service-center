import { describe, expect, it } from 'vitest';
import {
  computePlanSchedule,
  describeItemLeader,
  resolveItemLeader,
  selectServiceTime,
  type LeaderAssignment,
  type ScheduleItem,
  type ScheduleTime,
} from './plan-order.js';

const item = (id: string, length: number, extra: Partial<ScheduleItem> = {}): ScheduleItem => ({
  id,
  item_type: 'item',
  length_seconds: length,
  service_segment: 'service',
  ...extra,
});

const nine: ScheduleTime = {
  id: 't9',
  kind: 'service',
  name: '9am',
  starts_at: '2026-11-01T14:00:00.000Z',
  ends_at: '2026-11-01T15:00:00.000Z',
};
const eleven: ScheduleTime = { ...nine, id: 't11', name: '11am', starts_at: '2026-11-01T16:00:00.000Z', ends_at: '2026-11-01T17:00:00.000Z' };
const rehearsal: ScheduleTime = { ...nine, id: 'r', kind: 'rehearsal', starts_at: '2026-10-31T23:00:00.000Z', ends_at: '2026-11-01T00:30:00.000Z' };

describe('computePlanSchedule', () => {
  it('runs service items back to back; headers take no time; totals reconcile exactly', () => {
    const items = [
      item('h', 999, { item_type: 'header' }),
      item('a', 300),
      item('b', 245),
      item('h2', 60, { item_type: 'header' }),
      item('c', 0),
      item('d', 1),
    ];
    const schedule = computePlanSchedule({ items, time: nine });
    expect(schedule.items.map((row) => [row.item_id, row.offset_seconds, row.duration_seconds])).toEqual([
      ['h', 0, 0],
      ['a', 0, 300],
      ['b', 300, 245],
      ['h2', 545, 0],
      ['c', 545, 0],
      ['d', 545, 1],
    ]);
    expect(schedule.service_seconds).toBe(546);
    expect(Date.parse(schedule.planned_finish_at!) - Date.parse(schedule.service_starts_at!)).toBe(546_000);
    expect(schedule.items.at(-1)!.ends_at).toBe(schedule.planned_finish_at);
    expect(schedule.warnings).toEqual([]);
  });

  it('places before items ending at the start and after items from the finish, outside the service length', () => {
    const items = [item('pre1', 600, { service_segment: 'pre' }), item('pre2', 300, { service_segment: 'pre' }), item('a', 1200), item('post', 900, { service_segment: 'post' })];
    const schedule = computePlanSchedule({ items, time: nine });
    const at = Object.fromEntries(schedule.items.map((row) => [row.item_id, row]));
    expect(at.pre1!.starts_at).toBe('2026-11-01T13:45:00.000Z');
    expect(at.pre2!.ends_at).toBe(nine.starts_at);
    expect(at.post!.starts_at).toBe(schedule.planned_finish_at);
    expect([schedule.pre_seconds, schedule.service_seconds, schedule.post_seconds]).toEqual([900, 1200, 900]);
    expect(schedule.planned_finish_at).toBe('2026-11-01T14:20:00.000Z');
  });

  it('times each service instance separately and warns when running over, never shortening', () => {
    const items = [item('a', 3000), item('b', 900)];
    const first = computePlanSchedule({ items, time: nine });
    const second = computePlanSchedule({ items, time: eleven });
    expect(first.items[1]!.starts_at).toBe('2026-11-01T14:50:00.000Z');
    expect(second.items[1]!.starts_at).toBe('2026-11-01T16:50:00.000Z');
    expect(first.items.map((row) => row.duration_seconds)).toEqual([3000, 900]);
    expect(first.warnings).toEqual([{ code: 'runs_over', seconds: 300 }]);
  });

  it('flags a before item listed among service items but still times it by its segment', () => {
    const items = [item('a', 60), item('late-pre', 120, { service_segment: 'pre' }), item('b', 60)];
    const schedule = computePlanSchedule({ items, time: nine });
    expect(schedule.warnings).toContainEqual({ code: 'segment_out_of_order', item_id: 'late-pre' });
    expect(schedule.items.find((row) => row.item_id === 'late-pre')!.ends_at).toBe(nine.starts_at);
    expect(schedule.items.map((row) => row.item_id)).toEqual(['a', 'late-pre', 'b']);
  });

  it('returns totals without clock times when there is no service time', () => {
    const schedule = computePlanSchedule({ items: [item('a', 60)], time: null });
    expect(schedule.items).toEqual([]);
    expect(schedule.service_seconds).toBe(60);
    expect(schedule.warnings).toEqual([{ code: 'no_service_time' }]);
  });

  it('treats rows without a segment (older responses) as service items', () => {
    const schedule = computePlanSchedule({ items: [{ id: 'x', item_type: 'song', length_seconds: 30 }], time: nine });
    expect(schedule.items[0]!.segment).toBe('service');
  });
});

describe('selectServiceTime', () => {
  it('picks the requested service time or the earliest; never a rehearsal; unknown id is undefined', () => {
    expect(selectServiceTime([eleven, rehearsal, nine])?.id).toBe('t9');
    expect(selectServiceTime([eleven, rehearsal, nine], 't11')?.id).toBe('t11');
    expect(selectServiceTime([eleven, rehearsal, nine], 'r')).toBeUndefined();
    expect(selectServiceTime([rehearsal])).toBeNull();
  });
});

describe('resolveItemLeader', () => {
  const assignment = (person: string, status: LeaderAssignment['status'], extra: Partial<LeaderAssignment> = {}): LeaderAssignment => ({
    person_id: person,
    position_id: 'wl',
    status,
    visibility: 'released',
    person: { full_name: person.toUpperCase() },
    position: { id: 'wl', name: 'Worship Leader' },
    ...extra,
  });
  const byPosition = { leader_person_id: null, leader_position_id: 'wl' };

  it('follows the plan staffing for a position leader, excluding declined', () => {
    const leader = resolveItemLeader({ item: byPosition, assignments: [assignment('sam', 'confirmed'), assignment('riley', 'declined')] });
    expect(leader).toMatchObject({ kind: 'position', position_name: 'Worship Leader', holders: [{ person_id: 'sam', status: 'confirmed' }] });
    expect(describeItemLeader(leader)).toBe('Worship Leader: SAM');

    const changed = resolveItemLeader({ item: byPosition, assignments: [assignment('morgan', 'unconfirmed')] });
    expect(describeItemLeader(changed)).toBe('Worship Leader: MORGAN');
  });

  it('shows an unfilled position and lists several holders explicitly', () => {
    const unfilled = resolveItemLeader({ item: byPosition, assignments: [], positionNames: new Map([['wl', 'Worship Leader']]) });
    expect(describeItemLeader(unfilled)).toBe('Worship Leader: unfilled');
    const several = resolveItemLeader({
      item: byPosition,
      assignments: [assignment('sam', 'confirmed'), assignment('alex', 'unconfirmed', { visibility: 'prepared' }), assignment('sam', 'confirmed')],
    });
    expect(describeItemLeader(several)).toBe('Worship Leader: SAM, ALEX (not yet asked)');
  });

  it('keeps a direct Person leader whatever the staffing says', () => {
    const leader = resolveItemLeader({
      item: { leader_person_id: 'p1', leader_position_id: null, leader_person: { id: 'p1', full_name: 'Jordan Blake' } },
      assignments: [assignment('sam', 'confirmed')],
    });
    expect(leader).toEqual({ kind: 'person', person_id: 'p1', name: 'Jordan Blake' });
    expect(describeItemLeader(resolveItemLeader({ item: { leader_person_id: null, leader_position_id: null }, assignments: [] }))).toBeNull();
  });
});
