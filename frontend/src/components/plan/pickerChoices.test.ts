import { describe, expect, it } from 'vitest';
import type { AssignmentDetail, AssignmentStatus, RosterPerson, TeamPositionRow, TeamWithPositions } from '@service-center/shared';
import { leaderPersonChoices, leaderPositionChoices, type LeaderChoiceLabels } from './leaderChoices';
import { replacementCandidates } from './replacementCandidates';

const NOW = '2026-11-21T00:00:00Z';

const labels: LeaderChoiceLabels = {
  unnamed: 'Unnamed',
  team: 'Team',
  planOnly: 'Only on this plan',
  teamPosition: (team, position) => `${team} · ${position}`,
};

const person = (id: string, fullName: string, overrides: Partial<RosterPerson> = {}): RosterPerson => ({
  id,
  person_id: id,
  profile_id: null,
  has_login: false,
  full_name: fullName,
  email: `${id}@example.org`,
  phone: null,
  avatar_url: null,
  role: null,
  status: 'no_account',
  campus: null,
  invite_pending: false,
  archived: false,
  ...overrides,
});

const position = (id: string, teamId: string, name: string, planId: string | null = null): TeamPositionRow => ({
  id,
  team_id: teamId,
  name,
  sort_order: 0,
  plan_id: planId,
  created_by: null,
  created_at: NOW,
  updated_at: NOW,
});

const team = (id: string, name: string, positions: TeamPositionRow[], members: TeamWithPositions['members'] = []): TeamWithPositions => ({
  id,
  organization_id: 'org-1',
  service_type_id: null,
  name,
  description: null,
  color: '#6366f1',
  sort_order: 0,
  default_visibility: 'released',
  default_response_owner_id: null,
  requires_eligibility: false,
  eligibility_kind: null,
  created_at: NOW,
  updated_at: NOW,
  positions,
  members,
});

const member = (personId: string, positionId: string | null): TeamWithPositions['members'][number] => ({
  person_id: personId,
  user_id: null,
  position_id: positionId,
  membership_id: `m-${personId}-${positionId ?? 'none'}`,
  profile: null,
});

const assignment = (
  personId: string,
  teamRef: { id: string; name: string },
  positionRef: { id: string; name: string } | null,
  status: AssignmentStatus = 'confirmed',
): AssignmentDetail => ({
  id: `a-${personId}-${positionRef?.id ?? teamRef.id}`,
  plan_id: 'plan-1',
  person_id: personId,
  user_id: null,
  team_id: teamRef.id,
  position_id: positionRef?.id ?? null,
  status,
  notes: null,
  notified_at: null,
  responded_at: null,
  created_by: null,
  visibility: 'released',
  released_at: null,
  released_by: null,
  response_owner_id: null,
  attendance_mode: 'all',
  request_revision: 1,
  created_at: NOW,
  updated_at: NOW,
  person: null,
  response_owner: null,
  team: { ...teamRef, color: '#6366f1' },
  position: positionRef,
  attendance_times: [],
  time_responses: [],
  attendance: [],
});

const band = { id: 'band', name: 'Band' };
const tech = { id: 'tech', name: 'Tech' };
const keys = position('keys', 'band', 'Keys');
const drums = position('drums', 'band', 'Drums');
const sound = position('sound', 'tech', 'Sound');
const extraVocals = position('extra-vocals', 'band', 'Extra vocals', 'plan-1');
const teams = [team('band', 'Band', [keys, drums]), team('tech', 'Tech', [sound])];

describe('leaderPersonChoices', () => {
  it('suggests the people serving on the plan, with their roles, and offers the rest of the roster', () => {
    const roster = [person('an', 'Nguyễn An'), person('binh', 'Đặng Bình'), person('old', 'Old Member', { archived: true })];
    const { options, suggested } = leaderPersonChoices({
      plan: {
        assignments: [
          assignment('binh', band, { id: 'keys', name: 'Keys' }),
          assignment('binh', tech, { id: 'sound', name: 'Sound' }),
          assignment('an', band, { id: 'drums', name: 'Drums' }, 'declined'),
        ],
      },
      roster,
      labels,
    });
    expect(options.map((option) => option.id)).toEqual(['an', 'binh']);
    expect(suggested).toEqual([
      expect.objectContaining({ id: 'binh', label: 'Đặng Bình', detail: 'Band · Keys, Tech · Sound', keywords: ['binh@example.org'] }),
    ]);
  });
});

describe('leaderPositionChoices', () => {
  it('groups positions by team and suggests the ones this plan staffs', () => {
    const { options, suggested } = leaderPositionChoices({
      plan: {
        assignments: [assignment('an', band, { id: 'keys', name: 'Keys' })],
        plan_positions: [extraVocals],
        position_needs: [{ position_id: 'sound', team_id: 'tech', needed: 1 }, { position_id: 'drums', team_id: 'band', needed: 0 }],
      },
      teams,
      labels,
    });
    expect(options.map((option) => [option.label, option.group, option.detail ?? null])).toEqual([
      ['Keys', 'Band', null],
      ['Drums', 'Band', null],
      ['Extra vocals', 'Band', 'Only on this plan'],
      ['Sound', 'Tech', null],
    ]);
    expect(suggested.map((option) => [option.label, option.detail, option.group])).toEqual([
      ['Keys', 'Band', undefined],
      ['Extra vocals', 'Band · Only on this plan', undefined],
      ['Sound', 'Tech', undefined],
    ]);
  });
});

describe('replacementCandidates', () => {
  it('suggests the request’s team, position holders first, and marks people already serving', () => {
    const roster = [person('an', 'Nguyễn An'), person('binh', 'Đặng Bình'), person('chau', 'Trần Châu')];
    const bandWithMembers = team('band', 'Band', [keys, drums], [member('an', 'keys'), member('binh', 'drums')]);
    const { options, suggested } = replacementCandidates({
      request: { team_id: 'band', position_id: 'drums' },
      roster,
      teams: [bandWithMembers],
      assignments: [assignment('chau', tech, { id: 'sound', name: 'Sound' })],
      labels: { unnamed: 'Unnamed', onThisPlan: 'On this plan' },
    });
    expect(suggested.map((option) => [option.id, option.detail])).toEqual([
      ['binh', 'Drums'],
      ['an', 'Keys'],
    ]);
    expect(options.find((option) => option.id === 'chau')?.badge).toBe('On this plan');
    expect(options.find((option) => option.id === 'an')?.badge).toBeNull();
  });
});
