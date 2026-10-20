import { describe, expect, it } from 'vitest';
import type { AttendanceConflict, RosterPerson, TeamWithPositions } from '@service-center/shared';
import {
  ALL_TIMES,
  blockingConflicts,
  canCommitSchedule,
  createAssignmentsBody,
  isScopeComplete,
  scheduleCandidates,
  toggleScopeTime,
} from './schedule-people';

const person = (personId: string | null, name: string): RosterPerson =>
  ({ person_id: personId, full_name: name, email: `${name.toLowerCase()}@x.test`, has_login: true }) as RosterPerson;

const team = { id: 'band', members: [{ person_id: 'p2', user_id: null, position_id: null }] } as unknown as TeamWithPositions;

describe('scheduleCandidates (website parity)', () => {
  const people = [person('p1', 'Ann'), person('p2', 'Bo'), person(null, 'Nobody')];

  it('lists team members first and labels them; others stay unlabelled', () => {
    const list = scheduleCandidates(people, team, '');
    expect(list.map((c) => [c.personId, c.onTeam])).toEqual([['p2', true], ['p1', false]]);
  });

  it('skips roster entries with no Person and filters by name', () => {
    expect(scheduleCandidates(people, undefined, 'an').map((c) => c.personId)).toEqual(['p1']);
  });
});

describe('time scope', () => {
  it('requires at least one chosen time in selected mode', () => {
    expect(isScopeComplete(ALL_TIMES)).toBe(true);
    const one = toggleScopeTime({ mode: 'selected', timeIds: [] }, 't1');
    expect(one).toEqual({ mode: 'selected', timeIds: ['t1'] });
    expect(isScopeComplete(toggleScopeTime(one, 't1'))).toBe(false);
  });
});

describe('commit', () => {
  it('builds the same body as the website, reasons only where they apply', () => {
    const body = createAssignmentsBody({
      teamId: 'band',
      positionId: null,
      personIds: ['p1'],
      scope: { mode: 'selected', timeIds: ['t1'] },
      visibility: 'prepared',
      preferenceOverrideReason: '  ',
      conflictOverrideReason: 'covering',
      hasBlocking: false,
    });
    expect(body).toEqual({
      assignments: [{ person_id: 'p1', team_id: 'band', position_id: null, attendance_mode: 'selected', time_ids: ['t1'] }],
      notify: true,
      ignore_conflicts: false,
      visibility: 'prepared',
      preference_override_reason: null,
      conflict_override_reason: null,
    });
  });

  it('blocks a hard conflict without permission and a reason', () => {
    const conflicts = [{ severity: 'blocking' }, { severity: 'warning' }] as AttendanceConflict[];
    const base = { teamId: 'band', selectedCount: 1, scope: ALL_TIMES, blockingCount: blockingConflicts(conflicts).length };
    expect(canCommitSchedule({ ...base, mayOverride: false, conflictReason: 'x' })).toBe(false);
    expect(canCommitSchedule({ ...base, mayOverride: true, conflictReason: ' ' })).toBe(false);
    expect(canCommitSchedule({ ...base, mayOverride: true, conflictReason: 'covering' })).toBe(true);
    expect(canCommitSchedule({ ...base, blockingCount: 0, selectedCount: 0, mayOverride: false, conflictReason: '' })).toBe(false);
  });
});
