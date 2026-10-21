import { describe, expect, it } from 'vitest';
import {
  ApiError,
  resolveItemLeader,
  type PlanItemRow,
  type RosterPerson,
  type TeamPositionRow,
  type TeamWithPositions,
} from '@service-center/shared';
import {
  labeledKeyText,
  leaderLine,
  leaderPersonChoices,
  leaderPositionChoices,
  orderWriteOutcome,
  positionNamesFor,
  type LeaderWords,
} from './plan-order-edit';

const position = (id: string, teamId: string, name: string, planId: string | null = null): TeamPositionRow => ({
  id,
  team_id: teamId,
  name,
  sort_order: 0,
  plan_id: planId,
  created_by: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

const team = (id: string, name: string, positions: TeamPositionRow[]): TeamWithPositions =>
  ({ id, name, positions, members: [] }) as unknown as TeamWithPositions;

const person = (overrides: Partial<RosterPerson>): RosterPerson => ({
  id: 'm',
  person_id: 'p',
  profile_id: null,
  has_login: false,
  full_name: 'Sam Rivera',
  email: null,
  phone: null,
  avatar_url: null,
  role: null,
  status: 'active',
  campus: null,
  invite_pending: false,
  archived: false,
  ...overrides,
});

const words: LeaderWords = {
  someoneOnRoster: 'Someone on the roster',
  position: 'Position',
  someone: 'Someone',
  unfilled: (name) => `${name}: unfilled`,
  holders: (name, names) => `${name}: ${names}`,
  notYetAsked: (name) => `${name} (not yet asked)`,
  list: (items) => items.join(', '),
};

describe('orderWriteOutcome', () => {
  it('separates stale, gone, refused and unanswered writes', () => {
    expect(orderWriteOutcome(new ApiError(409, 'changed', 'plan_revision_stale'))).toBe('stale');
    expect(orderWriteOutcome(new ApiError(404, 'Item not found'))).toBe('gone');
    expect(orderWriteOutcome(new ApiError(400, 'Arrangement does not belong to the song'))).toBe('refused');
    expect(orderWriteOutcome(new ApiError(403, 'Forbidden'))).toBe('refused');
    expect(orderWriteOutcome(new TypeError('Network request failed'))).toBe('uncertain');
  });
});

describe('leader choices', () => {
  const band = team('band', 'Band', [position('keys', 'band', 'Keys'), position('extra', 'band', 'Extra keys', 'plan-1')]);
  const planOnly = position('extra', 'band', 'Extra keys', 'plan-1');

  it('lists shared positions, then this plan\'s own once', () => {
    const choices = leaderPositionChoices([band], [planOnly], {
      teamPosition: (t, p) => `${t} · ${p}`,
      planPosition: (t, p) => `${t} · ${p} (this plan)`,
      unknownTeam: 'Team',
    });
    expect(choices).toEqual([
      { id: 'keys', label: 'Band · Keys' },
      { id: 'extra', label: 'Band · Extra keys (this plan)' },
    ]);
    expect(positionNamesFor([band], [planOnly]).get('extra')).toBe('Extra keys');
  });

  it('offers active Persons only, filtered by name, keeping the chosen one', () => {
    const people = [
      person({ id: '1', person_id: 'sam', full_name: 'Sam Rivera' }),
      person({ id: '2', person_id: 'riley', full_name: 'Riley Chen' }),
      person({ id: '3', person_id: 'old', full_name: 'Sam Old', archived: true }),
      person({ id: '4', person_id: null, full_name: 'Invite only' }),
    ];
    expect(leaderPersonChoices(people, '', '', 'Unnamed').map((c) => c.id)).toEqual(['sam', 'riley']);
    expect(leaderPersonChoices(people, 'sam', '', 'Unnamed').map((c) => c.id)).toEqual(['sam']);
    expect(leaderPersonChoices(people, 'sam', 'riley', 'Unnamed').map((c) => c.id)).toEqual(['riley', 'sam']);
  });
});

describe('leaderLine', () => {
  const item = (overrides: Partial<PlanItemRow>) =>
    ({ leader_person_id: null, leader_position_id: null, leader_person: null, ...overrides }) as Parameters<typeof resolveItemLeader>[0]['item'];

  it('words the shared resolver\'s result as the website does', () => {
    const names = new Map([['keys', 'Keys']]);
    expect(leaderLine(resolveItemLeader({ item: item({}), assignments: [], positionNames: names }), words)).toBeNull();
    expect(leaderLine(resolveItemLeader({ item: item({ leader_position_id: 'keys' }), assignments: [], positionNames: names }), words))
      .toEqual({ text: 'Keys: unfilled', unfilled: true });
    expect(leaderLine({ kind: 'person', person_id: 'p', name: null }, words)).toEqual({ text: 'Someone on the roster', unfilled: false });
    expect(leaderLine({
      kind: 'position',
      position_id: 'keys',
      position_name: 'Keys',
      holders: [
        { person_id: 'a', name: 'Ana', status: 'confirmed', prepared: false },
        { person_id: 'b', name: 'Ben', status: 'unconfirmed', prepared: true },
      ],
    }, words)).toEqual({ text: 'Keys: Ana, Ben (not yet asked)', unfilled: false });
  });
});

it('words a labeled key like the website dropdown', () => {
  expect(labeledKeyText({ label: 'Low', song_key: 'Bb', capo: 3, vocal_label: 'Alto' }, (fret) => `capo ${fret}`)).toBe('Low · Bb · capo 3 · Alto');
  expect(labeledKeyText({ label: 'Original', song_key: 'C', capo: null, vocal_label: null }, (fret) => `capo ${fret}`)).toBe('Original · C');
});
