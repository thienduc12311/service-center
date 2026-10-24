import {
  personTagsSchema,
  type OrgRole,
  updatePersonSchema,
  type PersonDetail,
  type RosterPerson,
  type TeamWithPositions,
  type UpdatePersonInput,
} from '@service-center/shared';

/**
 * MOB-031: the website's directory (`PeoplePage`/`PersonPage`), team roster
 * (`TeamsPage`) and tags (`PersonPolicyPanel`) on their existing contracts:
 * `listPeople`, `getPerson`, `updatePerson`, `personTags`,
 * `replacePersonTags`, `archivePerson`/`restorePerson`, `listTeams`,
 * `addTeamMember`/`removeTeamMember`, and `updateMe` for one's own login
 * profile. The server decides which fields come back (contacts only for the
 * Person themself or `people.view_private`); nothing here fills a hidden
 * field in, and a Person is never matched to a login by email.
 *
 * Personal details are owner-only (migration `owner_people_permissions`):
 * only the organization owner may open a Person's record, read or change
 * tags, edit, archive or restore. Everyone else sees directory rows and
 * edits their own login profile (`updateMe`) in Settings. Team rosters stay
 * under `teams.manage`.
 */

/** Whether this caller may open Person records and manage people (the website's `role === 'owner'`; the server re-checks). */
export const canOpenPeopleDetails = (role: OrgRole | null): boolean => role === 'owner';

/** A directory row can open a record only when it has a roster Person (web: rows without one are not links). */
export const canOpenPerson = (row: Pick<RosterPerson, 'person_id'>): row is RosterPerson & { person_id: string } =>
  Boolean(row.person_id);

/** Name, then email (when the server returned one), then nothing: the caller picks a fallback label. */
export const directoryName = (row: Pick<RosterPerson, 'full_name' | 'email'>): string | null =>
  row.full_name?.trim() || row.email?.trim() || null;

/** Case-insensitive search over the fields the server actually returned for each row. */
export const filterDirectory = (rows: readonly RosterPerson[], query: string): RosterPerson[] => {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter((row) =>
    [row.full_name, row.email, row.phone, row.campus].some((value) => value?.toLowerCase().includes(needle)),
  );
};

/** The signed-in login's own Person in this organization, through the explicit `profile_id` link only. */
export const ownPersonId = (rows: readonly RosterPerson[], profileId: string | null | undefined): string | null =>
  (profileId ? rows.find((row) => row.profile_id === profileId)?.person_id : null) ?? null;

/** Website badge for a row: archived first, then no-login state (`list.archived` / `list.inviteSent` / `list.noLogin`). */
export type DirectoryBadge = 'archived' | 'inviteSent' | 'noLogin';

export const directoryBadges = (row: Pick<RosterPerson, 'archived' | 'has_login' | 'invite_pending'>): DirectoryBadge[] => [
  ...(row.archived ? (['archived'] as const) : []),
  ...(!row.has_login ? [row.invite_pending ? ('inviteSent' as const) : ('noLogin' as const)] : []),
];

/** The record fields this screen edits; the full form (address, dates, medical note) stays on the website. */
export interface PersonEditDraft {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  campus: string;
}

export const personEditDraft = (person: PersonDetail): PersonEditDraft => ({
  first_name: person.first_name,
  last_name: person.last_name ?? '',
  email: person.email ?? '',
  phone: person.phone ?? '',
  campus: person.campus ?? '',
});

/** With a login, name/email/phone belong to that person's own profile (website `loginManagedHint`). */
export const contactIsLoginManaged = (person: Pick<PersonDetail, 'profile_id'>): boolean => Boolean(person.profile_id);

const blankToNull = (value: string): string | null => value.trim() || null;

/**
 * Only the fields that changed, so a partial update never resets anything the
 * phone does not show (web sends the whole form). Contact fields of a Person
 * with a login are never sent. Validated with the shared update schema.
 */
export const personEditBody = (person: PersonDetail, draft: PersonEditDraft): UpdatePersonInput => {
  const body: UpdatePersonInput = {};
  if (draft.first_name.trim() !== person.first_name) body.first_name = draft.first_name.trim();
  if (blankToNull(draft.last_name) !== (person.last_name ?? null)) body.last_name = blankToNull(draft.last_name);
  if (blankToNull(draft.campus) !== (person.campus ?? null)) body.campus = blankToNull(draft.campus);
  if (!contactIsLoginManaged(person)) {
    if (blankToNull(draft.email)?.toLowerCase() !== (person.email ?? null)?.toLowerCase()) body.email = blankToNull(draft.email);
    if (blankToNull(draft.phone) !== (person.phone ?? null)) body.phone = blankToNull(draft.phone);
  }
  return updatePersonSchema.parse(body);
};

export const hasPersonChanges = (body: UpdatePersonInput): boolean => Object.keys(body).length > 0;

/** The website's comma-separated tag box: trimmed, lowercased, unique (the server lowercases too). */
export const parseTagText = (text: string): string[] => {
  const tags = [...new Set(text.split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
  return personTagsSchema.parse({ tags }).tags;
};

export const tagText = (tags: readonly string[]): string => tags.join(', ');

/** One team this Person is on, as read from `listTeams` (a Person may hold several positions). */
export interface PersonTeamMembership {
  teamId: string;
  teamName: string;
  teamColor: string;
  membershipId: string;
  positionName: string | null;
}

export const teamsForPerson = (teams: readonly TeamWithPositions[], personId: string): PersonTeamMembership[] =>
  teams.flatMap((team) =>
    team.members
      .filter((member) => member.person_id === personId)
      .map((member) => ({
        teamId: team.id,
        teamName: team.name,
        teamColor: team.color,
        membershipId: member.membership_id,
        positionName: team.positions.find((position) => position.id === member.position_id)?.name ?? null,
      })),
  );

/** `teams.manage` at the team (organization, its service type, or as its leader) — a UI hint; the server re-checks. */
export const teamManageTarget = (team: Pick<TeamWithPositions, 'id' | 'service_type_id'>) => ({
  serviceTypeId: team.service_type_id,
  teamId: team.id,
});

/**
 * People who can be added to a team (website add-member list): a roster
 * Person, not archived (the server refuses archived with 409), with or without
 * a login. Someone already on the team may be added again in another position.
 */
export const addableTeamPeople = (people: readonly RosterPerson[]): Array<RosterPerson & { person_id: string }> =>
  people.filter(canOpenPerson).filter((row) => !row.archived);
