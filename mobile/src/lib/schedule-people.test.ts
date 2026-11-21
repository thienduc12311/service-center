import { describe, expect, it } from 'vitest';
import type { AttendanceConflict, RosterPerson, TeamPositionRow, TeamWithPositions } from '@service-center/shared';
import {
  ALL_TIMES,
  blockingConflicts,
  canCommitSchedule,
  createAssignmentsBody,
  defaultPeopleScope,
  isScopeComplete,
  schedulePeopleQuery,
  schedulePersonRows,
  schedulePositionOptions,
  teamMemberCount,
  toggleScopeTime,
  toggleSelectedPerson,
} from './schedule-people';

const person = (personId: string | null, name: string, extra: Partial<RosterPerson> = {}): RosterPerson =>
  ({
    id: `m-${name}`,
    person_id: personId,
    full_name: name,
    email: `${name.toLowerCase()}@x.test`,
    has_login: true,
    archived: false,
    avatar_url: null,
    ...extra,
  }) as RosterPerson;

const member = (personId: string, positionId: string | null = null): TeamWithPositions['members'][number] =>
  ({ person_id: personId, user_id: null, position_id: positionId, membership_id: `tm-${personId}`, profile: null });

const team = { id: 'band', members: [member('p2'), member('p2', 'keys'), member('p3')] };

describe('people scope and query', () => {
  it('defaults to team members once a team is chosen', () => {
    expect(defaultPeopleScope('')).toBe('everyone');
    expect(defaultPeopleScope('band')).toBe('team');
  });

  it('asks for the team only in team scope, and sends search and cursor when set', () => {
    expect(schedulePeopleQuery({ scope: 'team', teamId: 'band', search: '  ' })).toEqual({ limit: 50, team_id: 'band' });
    expect(schedulePeopleQuery({ scope: 'everyone', teamId: 'band', search: ' an ', cursor: 'c2' }))
      .toEqual({ limit: 50, q: 'an', cursor: 'c2' });
    // Team scope with no team chosen yet falls back to everyone.
    expect(schedulePeopleQuery({ scope: 'team', teamId: '', search: '' })).toEqual({ limit: 50 });
  });

  it('counts a member holding two positions once', () => {
    expect(teamMemberCount(team)).toBe(2);
    expect(teamMemberCount(undefined)).toBe(0);
  });
});

describe('schedulePersonRows', () => {
  it('keeps Persons once across pages, never archived, with on team / on plan / no login marks', () => {
    const rows = schedulePersonRows({
      people: [
        person('p1', 'Ann', { has_login: false }),
        person('p2', 'Bo'),
        person(null, 'Invite only'),
        person('p4', 'Gone', { archived: true }),
        person('p2', 'Bo'),
        person('p3', 'Cy'),
      ],
      team,
      assignments: [
        { person_id: 'p2', status: 'confirmed' },
        { person_id: 'p3', status: 'declined' },
      ],
      unnamed: 'Unnamed',
    });
    expect(rows.map((row) => [row.personId, row.onTeam, row.onPlan, row.noLogin])).toEqual([
      ['p1', false, false, true],
      ['p2', true, true, false],
      ['p3', true, false, false],
    ]);
  });
});

describe('selection persists across searches', () => {
  it('toggles people by id and keeps their names for the chips', () => {
    const ann = { personId: 'p1', name: 'Ann' };
    const bo = { personId: 'p2', name: 'Bo' };
    let selected = toggleSelectedPerson([], ann);
    selected = toggleSelectedPerson(selected, bo);
    // A new search lists other people; the selection does not depend on it.
    expect(selected).toEqual([ann, bo]);
    expect(toggleSelectedPerson(selected, { personId: 'p1', name: 'Ann (renamed)' })).toEqual([bo]);
  });
});

describe('schedulePositionOptions', () => {
  const position = (id: string, teamId: string, name: string, planId: string | null = null): TeamPositionRow =>
    ({ id, team_id: teamId, name, plan_id: planId, sort_order: 0, created_by: null, created_at: '', updated_at: '' });

  it('lists the team positions, then this plan\'s positions for the team in their own group', () => {
    const options = schedulePositionOptions(
      { id: 'band', positions: [position('keys', 'band', 'Keys'), position('old', 'band', 'Extra', 'plan-x')] },
      [position('trumpet', 'band', 'Guest trumpet', 'plan-1'), position('cam', 'av', 'Camera', 'plan-1')],
      { planPosition: (name) => `${name} (this plan)`, planOnlyGroup: 'This plan only' },
    );
    expect(options.map((option) => [option.value, option.label, option.groupKey ?? null])).toEqual([
      ['keys', 'Keys', null],
      ['trumpet', 'Guest trumpet (this plan)', 'plan'],
    ]);
    expect(schedulePositionOptions(undefined, [], { planPosition: (name) => name, planOnlyGroup: '' })).toEqual([]);
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
