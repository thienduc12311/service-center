import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { updatePersonSchema, type PersonDetail, type RosterPerson, type TeamWithPositions } from '@service-center/shared';
import { queryKeys } from './query-keys';
import {
  addableTeamPeople,
  canOpenPeopleDetails,
  canOpenPerson,
  directoryBadges,
  directoryName,
  filterDirectory,
  hasPersonChanges,
  ownPersonId,
  parseTagText,
  personEditBody,
  personEditDraft,
  teamManageTarget,
  teamsForPerson,
} from './directory';

const mobileRoot = join(__dirname, '..', '..');
const source = (path: string): string => readFileSync(join(mobileRoot, path), 'utf8');

const row = (overrides: Partial<RosterPerson> = {}): RosterPerson => ({
  id: 'p1',
  person_id: 'p1',
  profile_id: null,
  has_login: false,
  full_name: 'Riley Member',
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

const person = (overrides: Partial<PersonDetail> = {}): PersonDetail =>
  ({
    id: 'p1',
    organization_id: 'o1',
    profile_id: null,
    first_name: 'Riley',
    last_name: 'Member',
    email: 'riley@example.com',
    phone: null,
    campus: 'North',
    archived_at: null,
    profile: null,
    membership: null,
    pending_invitation: null,
    ...overrides,
  }) as PersonDetail;

const team = (members: TeamWithPositions['members']): TeamWithPositions =>
  ({
    id: 'band',
    name: 'Band',
    color: '#f00',
    service_type_id: 'st1',
    positions: [{ id: 'keys', name: 'Keys' }],
    members,
  }) as unknown as TeamWithPositions;

describe('owner-only personal details', () => {
  it('lets only the owner open records or manage people (admin and people.manage grants included)', () => {
    expect(canOpenPeopleDetails('owner')).toBe(true);
    for (const role of ['admin', 'scheduler', 'member', null] as const) expect(canOpenPeopleDetails(role)).toBe(false);
  });
});

describe('directory rows', () => {
  it('opens only rows with a roster Person, like the website', () => {
    expect(canOpenPerson(row())).toBe(true);
    expect(canOpenPerson(row({ person_id: null, profile_id: 'u1', has_login: true }))).toBe(false);
  });

  it('labels a row by name, then a returned email, never inventing one', () => {
    expect(directoryName(row())).toBe('Riley Member');
    expect(directoryName(row({ full_name: null, email: 'r@example.com' }))).toBe('r@example.com');
    expect(directoryName(row({ full_name: ' ', email: null }))).toBeNull();
  });

  it('searches only the fields the server returned (hidden contacts are null and never match)', () => {
    const rows = [row(), row({ id: 'p2', person_id: 'p2', full_name: 'Jordan', email: null, campus: 'South' })];
    expect(filterDirectory(rows, 'south').map((r) => r.id)).toEqual(['p2']);
    expect(filterDirectory(rows, 'example.com')).toEqual([]);
    expect(filterDirectory(rows, '  ')).toHaveLength(2);
  });

  it('finds my own Person only through the explicit profile link, never by email', () => {
    const rows = [row({ email: 'me@example.com' }), row({ id: 'u9', person_id: 'p9', profile_id: 'u9', has_login: true })];
    expect(ownPersonId(rows, 'u9')).toBe('p9');
    expect(ownPersonId(rows, 'me@example.com')).toBeNull();
    expect(ownPersonId(rows, null)).toBeNull();
  });

  it('shows archived and no-login states with the website terms', () => {
    expect(directoryBadges(row())).toEqual(['noLogin']);
    expect(directoryBadges(row({ invite_pending: true }))).toEqual(['inviteSent']);
    expect(directoryBadges(row({ archived: true, has_login: true }))).toEqual(['archived']);
  });
});

describe('roster record edits', () => {
  it('sends only changed fields, validated by the shared schema', () => {
    const original = person();
    const body = personEditBody(original, { ...personEditDraft(original), campus: ' South ', last_name: '' });
    expect(body).toEqual({ campus: 'South', last_name: null });
    expect(updatePersonSchema.safeParse(body).success).toBe(true);
    expect(hasPersonChanges(personEditBody(original, personEditDraft(original)))).toBe(false);
  });

  it('never sends contact fields for a Person with a login (their own profile owns them)', () => {
    const linked = person({ profile_id: 'u1' });
    const body = personEditBody(linked, { ...personEditDraft(linked), email: 'other@example.com', phone: '555' });
    expect(body).toEqual({});
  });

  it('edits contact fields of a no-login Person and refuses a malformed email', () => {
    const original = person();
    expect(personEditBody(original, { ...personEditDraft(original), phone: '555 0100' })).toEqual({ phone: '555 0100' });
    expect(() => personEditBody(original, { ...personEditDraft(original), email: 'not-an-email' })).toThrow();
  });

  it('parses the website tag box into unique lowercase tags and refuses oversize tags', () => {
    expect(parseTagText('Camera, sound ,camera,,')).toEqual(['camera', 'sound']);
    expect(() => parseTagText('x'.repeat(61))).toThrow();
  });
});

describe('teams', () => {
  const band = team([
    { person_id: 'p1', user_id: null, position_id: 'keys', membership_id: 'm1', profile: null },
    { person_id: 'p1', user_id: null, position_id: null, membership_id: 'm2', profile: null },
    { person_id: 'p2', user_id: 'u2', position_id: null, membership_id: 'm3', profile: null },
  ]);

  it('lists every membership of one Person with the row id removal needs', () => {
    expect(teamsForPerson([band], 'p1')).toEqual([
      { teamId: 'band', teamName: 'Band', teamColor: '#f00', membershipId: 'm1', positionName: 'Keys' },
      { teamId: 'band', teamName: 'Band', teamColor: '#f00', membershipId: 'm2', positionName: null },
    ]);
  });

  it('checks teams.manage at the team and its service type', () => {
    expect(teamManageTarget(band)).toEqual({ serviceTypeId: 'st1', teamId: 'band' });
  });

  it('offers only active roster People (with or without a login) to add', () => {
    const people = [row(), row({ id: 'a', person_id: 'a', archived: true }), row({ id: 'u', person_id: null, has_login: true })];
    expect(addableTeamPeople(people).map((p) => p.id)).toEqual(['p1']);
  });
});

describe('source contract', () => {
  it('keeps directory caches under the account/organization/generation root', () => {
    const scope = { userId: 'u1', organizationId: 'o1', generation: 3 };
    expect(queryKeys.person(scope, 'p1').slice(0, 4)).toEqual(['private', 'u1', 'o1', 3]);
    expect(queryKeys.directory(scope, true).slice(0, 5)).toEqual(queryKeys.people(scope));
    expect(queryKeys.personTags(scope, 'p1').slice(0, 5)).toEqual(queryKeys.people(scope));
  });

  it('gates every write on a capability and uses only the existing API methods', () => {
    const personScreen = source('app/people/[id].tsx');
    expect(personScreen).toContain('canOpenPeopleDetails(');
    expect(personScreen).toContain('<Redirect href="/people" />');
    expect(personScreen).not.toContain("canAnywhere('people.manage')");
    // Non-owners never send personal-detail reads.
    expect(personScreen.match(/enabled: Boolean\(queryScope && id && owner\)/g)).toHaveLength(2);
    expect(source('app/people/index.tsx')).toContain('owner && canOpenPerson(item)');
    expect(source('app/teams/[id].tsx')).toContain('onPress={owner ?');
    expect(personScreen).toContain("can('teams.manage'");
    for (const method of ['getPerson', 'updatePerson', 'personTags', 'replacePersonTags', 'archivePerson', 'restorePerson', 'removeTeamMember']) {
      expect(personScreen).toContain(`api.${method}(`);
    }
    // A record that has gone (404) falls back to its directory row; nothing is fetched another way.
    expect(personScreen).toContain('status === 404');
    expect(personScreen).not.toMatch(/adminDb|supabase\.from/);
    const teamScreen = source('app/teams/[id].tsx');
    expect(teamScreen).toContain('person_id: person.person_id');
    expect(teamScreen).not.toMatch(/email:/);
  });

  it('drops late results after an identity change', () => {
    for (const path of ['app/people/[id].tsx', 'app/teams/[id].tsx']) {
      expect(source(path)).toContain('isCurrentGeneration(generation)');
    }
  });
});
