import { describe, expect, it } from 'vitest';
import type { AssignmentDetail, AssignmentStatus, MyScheduleEntry, PlanTimeRow } from '@service-center/shared';
import {
  filterScheduleGroups,
  groupSchedule,
  planResponsibilities,
  scheduleWindowQuery,
} from './schedule-groups';

const time = (id: string, kind: PlanTimeRow['kind'], startsAt: string): PlanTimeRow => ({
  id,
  plan_id: 'plan',
  kind,
  name: null,
  starts_at: startsAt,
  ends_at: new Date(new Date(startsAt).getTime() + 60 * 60 * 1000).toISOString(),
  revision: 1,
  sort_order: 0,
  ics_sequence: 0,
  created_at: '2026-10-01T00:00:00.000Z',
});

interface EntryFixture {
  id: string;
  planId: string;
  status: AssignmentStatus;
  team: string;
  position: string | null;
  serviceDate?: string;
  times?: PlanTimeRow[];
  timeResponses?: MyScheduleEntry['time_responses'];
}

const entry = (fixture: EntryFixture): MyScheduleEntry => ({
  assignment: {
    id: fixture.id,
    plan_id: fixture.planId,
    person_id: 'me',
    user_id: 'me',
    team_id: `team-${fixture.team}`,
    position_id: fixture.position ? `position-${fixture.position}` : null,
    status: fixture.status,
    attendance_mode: 'all',
    request_revision: 1,
    notes: null,
    notified_at: null,
    responded_at: null,
    created_by: 'scheduler',
    visibility: 'released',
    released_at: '2026-10-01T00:00:00.000Z',
    released_by: 'scheduler',
    response_owner_id: 'scheduler',
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
  },
  response_note: fixture.status === 'declined' ? 'Away' : null,
  plan: {
    id: fixture.planId,
    title: `Plan ${fixture.planId}`,
    service_date: fixture.serviceDate ?? '2026-10-25T14:00:00.000Z',
    location: null,
    status: 'published',
  },
  team: { id: `team-${fixture.team}`, name: fixture.team, color: '#000000' },
  position: fixture.position ? { id: `position-${fixture.position}`, name: fixture.position } : null,
  times: fixture.times ?? [],
  time_responses: fixture.timeResponses ?? [],
});

const sunday = [
  time('rehearsal', 'rehearsal', '2026-10-25T12:30:00.000Z'),
  time('service', 'service', '2026-10-25T14:00:00.000Z'),
];

describe('groupSchedule', () => {
  it('puts two positions on one plan into a single card without losing either', () => {
    const groups = groupSchedule(
      [
        entry({ id: 'a1', planId: 'p1', status: 'confirmed', team: 'Band', position: 'Bass', times: sunday }),
        entry({ id: 'a2', planId: 'p1', status: 'unconfirmed', team: 'Production', position: 'Sound', times: sunday }),
      ],
      'org',
    );

    expect(groups).toHaveLength(1);
    const [group] = groups;
    expect(group!.key).toBe('org:me:p1');
    expect(group!.responsibilities.map((item) => [item.assignmentId, item.status])).toEqual([
      ['a1', 'confirmed'],
      ['a2', 'unconfirmed'],
    ]);
    expect(group!.status).toBe('mixed');
    expect(group!.pendingCount).toBe(1);
  });

  it('lists each attendance time once while remembering every position that needs it', () => {
    const [group] = groupSchedule(
      [
        entry({ id: 'a1', planId: 'p1', status: 'confirmed', team: 'Band', position: 'Bass', times: sunday }),
        entry({ id: 'a2', planId: 'p1', status: 'confirmed', team: 'Band', position: 'Vocals', times: [sunday[1]!] }),
      ],
      'org',
    );

    expect(group!.times.map((item) => [item.id, item.requiredBy])).toEqual([
      ['rehearsal', ['a1']],
      ['service', ['a1', 'a2']],
    ]);
    expect(group!.status).toBe('confirmed');
  });

  it('summarizes split per-time answers as mixed instead of pending', () => {
    const [group] = groupSchedule([
      entry({
        id: 'split',
        planId: 'p1',
        status: 'unconfirmed',
        team: 'Band',
        position: 'Bass',
        times: sunday,
        timeResponses: [
          { assignment_id: 'split', plan_time_id: 'rehearsal', status: 'confirmed', response_note: null, actor_id: 'me', responded_at: '2026-10-01T00:00:00.000Z' },
          { assignment_id: 'split', plan_time_id: 'service', status: 'declined', response_note: 'Unavailable', actor_id: 'me', responded_at: '2026-10-01T00:00:00.000Z' },
        ],
      }),
    ], 'org');

    expect(group!.responsibilities[0]!.scopeStatus).toBe('mixed');
    expect(group!.status).toBe('mixed');
  });

  it('ignores a duplicated assignment row', () => {
    const row = entry({ id: 'a1', planId: 'p1', status: 'confirmed', team: 'Band', position: 'Bass' });
    const [group] = groupSchedule([row, row], 'org');
    expect(group!.responsibilities).toHaveLength(1);
  });

  it('orders plans by when the service actually starts', () => {
    const groups = groupSchedule(
      [
        entry({
          id: 'late',
          planId: 'evening',
          status: 'confirmed',
          team: 'Band',
          position: null,
          serviceDate: '2026-10-25T00:00:00.000Z',
          times: [time('t2', 'service', '2026-10-25T23:00:00.000Z')],
        }),
        entry({
          id: 'early',
          planId: 'morning',
          status: 'confirmed',
          team: 'Band',
          position: null,
          serviceDate: '2026-10-25T00:00:00.000Z',
          times: [time('t1', 'service', '2026-10-25T14:00:00.000Z')],
        }),
      ],
      'org',
    );
    expect(groups.map((group) => group.plan.id)).toEqual(['morning', 'evening']);
  });

  it('returns no cards for an empty schedule', () => {
    expect(groupSchedule([], 'org')).toEqual([]);
  });

  it('shows history most recent first', () => {
    const groups = groupSchedule(
      [
        entry({ id: 'old', planId: 'old', status: 'confirmed', team: 'Band', position: null, serviceDate: '2026-01-04T14:00:00.000Z' }),
        entry({ id: 'new', planId: 'new', status: 'confirmed', team: 'Band', position: null, serviceDate: '2026-09-06T14:00:00.000Z' }),
      ],
      'org',
      'history',
    );
    expect(groups.map((group) => group.plan.id)).toEqual(['new', 'old']);
  });
});

describe('filterScheduleGroups', () => {
  const groups = groupSchedule(
    [
      entry({ id: 'a1', planId: 'p1', status: 'confirmed', team: 'Band', position: 'Bass' }),
      entry({ id: 'a2', planId: 'p1', status: 'unconfirmed', team: 'Production', position: 'Sound' }),
      entry({ id: 'b1', planId: 'p2', status: 'declined', team: 'Band', position: 'Bass', serviceDate: '2026-11-01T14:00:00.000Z' }),
    ],
    'org',
  );

  it('matches a card when any position matches, and still shows every position', () => {
    const pending = filterScheduleGroups(groups, 'pending');
    expect(pending.map((group) => group.plan.id)).toEqual(['p1']);
    expect(pending[0]!.responsibilities.map((item) => item.assignmentId)).toEqual(['a1', 'a2']);

    expect(filterScheduleGroups(groups, 'confirmed').map((group) => group.plan.id)).toEqual(['p1']);
    const declined = filterScheduleGroups(groups, 'declined');
    expect(declined.map((group) => group.plan.id)).toEqual(['p2']);
    expect(declined[0]!.responsibilities[0]!.responseNote).toBe('Away');
  });

  it('returns nothing rather than a misleading card when no position matches', () => {
    const onlyConfirmed = groupSchedule(
      [entry({ id: 'a1', planId: 'p1', status: 'confirmed', team: 'Band', position: 'Bass' })],
      'org',
    );
    expect(filterScheduleGroups(onlyConfirmed, 'declined')).toEqual([]);
  });
});

describe('planResponsibilities', () => {
  const detail = (id: string, userId: string, team: string, status: AssignmentStatus): AssignmentDetail => ({
    ...entry({ id, planId: 'p1', status, team, position: null }).assignment,
    user_id: userId,
    person: null,
    response_owner: null,
    team: { id: `team-${team}`, name: team, color: '#000000' },
    position: null,
    attendance_times: [],
    time_responses: [],
  });

  it("returns every one of the person's positions on the plan, not just the first", () => {
    const mine = planResponsibilities(
      [
        detail('a1', 'me', 'Band', 'confirmed'),
        detail('x1', 'someone-else', 'Band', 'unconfirmed'),
        detail('a2', 'me', 'Production', 'unconfirmed'),
      ],
      'me',
    );
    expect(mine.map((item) => item.assignmentId)).toEqual(['a1', 'a2']);
  });

  it('returns nothing before the user is known', () => {
    expect(planResponsibilities([detail('a1', 'me', 'Band', 'confirmed')], null)).toEqual([]);
  });
});

describe('scheduleWindowQuery', () => {
  it('asks for a bounded past year for history', () => {
    const now = new Date('2026-10-16T12:00:00.000Z');
    expect(scheduleWindowQuery('upcoming', now)).toEqual({});
    expect(scheduleWindowQuery('history', now)).toEqual({
      include_past: 'true',
      from: '2025-10-16T12:00:00.000Z',
      to: '2026-10-16T12:00:00.000Z',
    });
  });
});
