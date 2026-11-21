import { describe, expect, it } from 'vitest';
import type { AssignmentDetail, AssignmentStatus, AssignmentVisibility, TeamPositionRow, TeamWithPositions } from '@service-center/shared';
import { openPlaces, positionHasGap, summarizePlanTeam, type PlanTeamPositionView, type PlanTeamView } from './types';

const assignment = (id: string, status: AssignmentStatus, visibility: AssignmentVisibility = 'released'): AssignmentDetail => ({
  id,
  plan_id: 'plan-1',
  person_id: `person-${id}`,
  user_id: null,
  team_id: 'team-1',
  position_id: 'pos-1',
  status,
  notes: null,
  notified_at: null,
  responded_at: null,
  created_by: null,
  visibility,
  released_at: null,
  released_by: null,
  response_owner_id: null,
  attendance_mode: 'all',
  request_revision: 1,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  person: null,
  response_owner: null,
  team: null,
  position: null,
  attendance_times: [],
  time_responses: [],
  attendance: [],
});

const positionRow = (id: string): TeamPositionRow => ({
  id,
  team_id: 'team-1',
  name: id,
  sort_order: 0,
  plan_id: null,
  created_by: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
});

const position = (id: string, needed: number, scheduled: AssignmentDetail[]): PlanTeamPositionView => ({
  position: positionRow(id),
  needed,
  scheduled,
  planOnly: false,
});

const teamView = (positions: PlanTeamPositionView[], unpositioned: AssignmentDetail[] = []): PlanTeamView => {
  const everyone = [...positions.flatMap((entry) => entry.scheduled), ...unpositioned];
  return {
    team: { id: 'team-1', name: 'Band' } as TeamWithPositions,
    positions,
    unpositioned,
    confirmed: everyone.filter((entry) => entry.status === 'confirmed').length,
    declined: everyone.filter((entry) => entry.status === 'declined').length,
    pending: everyone.filter((entry) => entry.status === 'unconfirmed' && entry.visibility === 'released').length,
    prepared: everyone.filter((entry) => entry.visibility === 'prepared'),
  };
};

describe('plan team gaps', () => {
  it('counts a decline as an open place and a prepared request as holding one', () => {
    const vocals = position('vocals', 3, [assignment('a', 'confirmed'), assignment('b', 'declined'), assignment('c', 'unconfirmed', 'prepared')]);
    expect(openPlaces(vocals)).toBe(1);
    expect(positionHasGap(vocals)).toBe(true);
  });

  it('treats an unanswered released request as a gap even when the position is full', () => {
    expect(positionHasGap(position('bass', 1, [assignment('a', 'unconfirmed')]))).toBe(true);
    expect(positionHasGap(position('bass', 1, [assignment('a', 'confirmed')]))).toBe(false);
    // Nothing asked for and nobody on it: not a gap.
    expect(positionHasGap(position('keys', 0, []))).toBe(false);
  });

  it('summarizes confirmed of places, open places and gaps', () => {
    const team = teamView(
      [
        position('vocals', 3, [assignment('a', 'confirmed'), assignment('b', 'declined')]),
        position('bass', 1, [assignment('c', 'confirmed')]),
        // More people than asked for: places follow the headcount.
        position('drums', 1, [assignment('d', 'confirmed'), assignment('e', 'confirmed')]),
      ],
      [assignment('f', 'unconfirmed')],
    );
    expect(summarizePlanTeam(team)).toEqual({ confirmed: 4, places: 3 + 1 + 2 + 1, open: 2, gaps: 2 });
  });
});
