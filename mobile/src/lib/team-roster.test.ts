import { describe, expect, it } from 'vitest';
import type { RosterPerson, TeamPositionRow } from '@service-center/shared';
import { pruneQueue, teamAddCandidates, teamMemberSections, toggleQueued, type TeamMember } from './team-roster';

const position = (id: string, name: string): TeamPositionRow => ({
  id,
  team_id: 'band',
  name,
  sort_order: 0,
  plan_id: null,
  created_by: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

const member = (person_id: string, position_id: string | null, membership_id = `${person_id}-${position_id ?? 'none'}`): TeamMember => ({
  person_id,
  user_id: null,
  position_id,
  membership_id,
  profile: null,
});

const names: Record<string, string> = { ana: 'Ân Đặng', ben: 'Ben Ross', cam: 'Cam Lee', dee: 'Dee Old' };
const words = { noPosition: 'No position', memberName: (m: TeamMember) => names[m.person_id] ?? '?' };

const person = (person_id: string | null, overrides: Partial<RosterPerson> = {}): RosterPerson => ({
  id: person_id ?? 'login',
  person_id,
  profile_id: null,
  has_login: false,
  full_name: person_id ? (names[person_id] ?? person_id) : 'Login only',
  email: null,
  phone: null,
  avatar_url: null,
  role: null,
  status: 'no_account',
  campus: null,
  invite_pending: false,
  archived: false,
  ...overrides,
});

describe('team member sections', () => {
  const positions = [position('keys', 'Keys'), position('drums', 'Drums')];
  const members = [member('ana', 'drums'), member('ben', null), member('cam', 'keys'), member('dee', 'gone')];

  it('groups by the team’s position order, unplaced last, empty groups dropped', () => {
    expect(teamMemberSections(members, positions, '', words).map((s) => [s.key, s.title, s.data.map((m) => m.person_id)])).toEqual([
      ['keys', 'Keys', ['cam']],
      ['drums', 'Drums', ['ana']],
      ['none', 'No position', ['ben', 'dee']],
    ]);
  });

  it('filters by name or position, ignoring accents', () => {
    expect(teamMemberSections(members, positions, 'an dang', words).map((s) => s.key)).toEqual(['drums']);
    expect(teamMemberSections(members, positions, 'keys', words).flatMap((s) => s.data.map((m) => m.person_id))).toEqual(['cam']);
  });
});

describe('team add candidates', () => {
  const members = [member('ana', 'keys'), member('ben', null)];
  const rows = [person('ana'), person('ben'), person('cam'), person('dee', { archived: true }), person(null, { has_login: true })];

  it('leaves out who already holds the chosen position, archived people and logins without a roster Person', () => {
    expect(teamAddCandidates(rows, members, 'keys').map((c) => [c.person.person_id, c.onTeam])).toEqual([
      ['ben', true],
      ['cam', false],
    ]);
    expect(teamAddCandidates(rows, members, null).map((c) => c.person.person_id)).toEqual(['ana', 'cam']);
  });

  it('queues and unqueues, and prunes people who now hold the position', () => {
    const queue = toggleQueued(toggleQueued([], { person_id: 'cam', name: 'Cam' }), { person_id: 'ana', name: 'Ân' });
    expect(queue.map((q) => q.person_id)).toEqual(['cam', 'ana']);
    expect(toggleQueued(queue, { person_id: 'cam', name: 'Cam' }).map((q) => q.person_id)).toEqual(['ana']);
    expect(pruneQueue(queue, members, 'keys').map((q) => q.person_id)).toEqual(['cam']);
  });
});
