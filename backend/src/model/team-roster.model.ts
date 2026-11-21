import type { OrgRole, TeamRosterPerson, TeamRosterPersonRow } from '@service-center/shared';

/** Roster rows keyed by `teamId:personId`. */
export type RosterPeople = Map<string, TeamRosterPersonRow>;

/** Org roles of members, keyed by user id. */
export type RoleByUser = Map<string, OrgRole>;

export const rosterKey = (teamId: string, personId: string): string => `${teamId}:${personId}`;

export const toRosterPeople = (rows: readonly TeamRosterPersonRow[]): RosterPeople =>
  new Map(rows.map((row) => [rosterKey(row.team_id, row.person_id), row]));

/** A `team_roster_people` row as the basic info any member may see (W8-NAT-D1). */
export const mapRosterPerson = (row: TeamRosterPersonRow, role: OrgRole): TeamRosterPerson => ({
  id: row.person_id,
  full_name: [row.first_name, row.last_name].filter(Boolean).join(' '),
  avatar_url: row.avatar_url,
  email: row.email,
  phone: row.phone,
  date_of_birth: row.birthdate,
  role,
});
