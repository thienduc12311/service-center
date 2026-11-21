import type { RosterPerson, TeamWithPositions } from '@service-center/shared';
import { addableTeamPeople } from './directory';
import { matchesSearch } from './list-search';

/**
 * MOB-031 at scale: a team's roster grouped by position with a search once it
 * is long, and an add flow on the server-searched People pages that queues
 * several people for one Add.
 */

export type TeamMember = TeamWithPositions['members'][number];

/** One position's members (or the members with no position), ready for a `SectionList`. */
export interface TeamMemberSection {
  /** The position id, or `none`. */
  key: string;
  title: string;
  data: TeamMember[];
}

export const NO_POSITION_KEY = 'none';

export interface TeamMemberWords {
  noPosition: string;
  memberName: (member: TeamMember) => string;
}

/**
 * Members by position, in the team's position order, then those with no
 * position (or a position the team no longer lists). Filtered by name or
 * position, accent-insensitive; empty groups are left out.
 */
export const teamMemberSections = (
  members: readonly TeamMember[],
  positions: TeamWithPositions['positions'],
  query: string,
  words: TeamMemberWords,
): TeamMemberSection[] => {
  const known = new Map(positions.map((position) => [position.id, position.name]));
  const sections = new Map<string, TeamMemberSection>(
    positions.map((position) => [position.id, { key: position.id, title: position.name, data: [] }]),
  );
  const unplaced: TeamMemberSection = { key: NO_POSITION_KEY, title: words.noPosition, data: [] };
  for (const member of members) {
    const positionName = member.position_id ? (known.get(member.position_id) ?? null) : null;
    if (!matchesSearch(query, [words.memberName(member), positionName])) continue;
    const section = member.position_id ? sections.get(member.position_id) : undefined;
    (section ?? unplaced).data.push(member);
  }
  return [...sections.values(), unplaced].filter((section) => section.data.length > 0);
};

/** A person offered in the add list. */
export interface TeamAddCandidate {
  person: RosterPerson & { person_id: string };
  /** Already on the team in another position (may be added again in this one). */
  onTeam: boolean;
}

/**
 * Search results that can be added in the chosen position: active roster
 * People, without those who already hold it (`positionId` null = no position).
 */
export const teamAddCandidates = (
  rows: readonly RosterPerson[],
  members: readonly TeamMember[],
  positionId: string | null,
): TeamAddCandidate[] => {
  const onTeam = new Set(members.map((member) => member.person_id));
  const holding = new Set(members.filter((member) => member.position_id === positionId).map((member) => member.person_id));
  return addableTeamPeople(rows)
    .filter((person) => !holding.has(person.person_id))
    .map((person) => ({ person, onTeam: onTeam.has(person.person_id) }));
};

/** Someone waiting in the add queue. */
export interface QueuedPerson {
  person_id: string;
  name: string;
}

/** The queue with `person` added, or removed when already queued. */
export const toggleQueued = (queue: readonly QueuedPerson[], person: QueuedPerson): QueuedPerson[] =>
  queue.some((entry) => entry.person_id === person.person_id)
    ? queue.filter((entry) => entry.person_id !== person.person_id)
    : [...queue, person];

/** The queue without people who now hold the chosen position (e.g. after the position changed). */
export const pruneQueue = (queue: readonly QueuedPerson[], members: readonly TeamMember[], positionId: string | null): QueuedPerson[] => {
  const holding = new Set(members.filter((member) => member.position_id === positionId).map((member) => member.person_id));
  return queue.filter((entry) => !holding.has(entry.person_id));
};
