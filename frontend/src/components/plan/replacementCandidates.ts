import type { AssignmentDetail, ReplacementRequestDetail, RosterPerson, TeamWithPositions } from '@service-center/shared';
import type { SearchComboboxOption } from '../SearchCombobox';
import type { PickerChoices } from './leaderChoices';

/** Translated text the builder needs, so it stays free of i18n. */
export interface ReplacementCandidateLabels {
  unnamed: string;
  /** Badge for someone already serving on this plan. */
  onThisPlan: string;
}

export interface ReplacementCandidatesInput {
  request: Pick<ReplacementRequestDetail, 'team_id' | 'position_id'>;
  roster: readonly RosterPerson[];
  teams: readonly TeamWithPositions[];
  /** This plan's assignments, to mark people already serving. */
  assignments: readonly AssignmentDetail[];
  labels: ReplacementCandidateLabels;
}

/**
 * Who can be offered a replacement: the whole active roster, with members of
 * the request's team suggested first — those who hold its position ahead of
 * the rest of the team.
 */
export const replacementCandidates = ({ request, roster, teams, assignments, labels }: ReplacementCandidatesInput): PickerChoices => {
  const serving = new Set(assignments.filter((item) => item.status !== 'declined').map((item) => item.person_id));
  const options: SearchComboboxOption[] = roster
    .filter((person): person is RosterPerson & { person_id: string } => Boolean(person.person_id) && !person.archived)
    .map((person) => ({
      id: person.person_id,
      label: person.full_name ?? labels.unnamed,
      detail: person.email,
      avatar: { name: person.full_name, url: person.avatar_url },
      badge: serving.has(person.person_id) ? labels.onThisPlan : null,
    }));
  const byId = new Map(options.map((option) => [option.id, option]));

  const team = teams.find((candidate) => candidate.id === request.team_id);
  if (!team) return { options, suggested: [] };
  const positionName = new Map(team.positions.map((position) => [position.id, position.name]));
  const inPosition = (positionId: string | null) => positionId === request.position_id;
  const members = [...team.members].sort((a, b) => Number(inPosition(b.position_id)) - Number(inPosition(a.position_id)));

  const roles = new Map<string, string[]>();
  for (const member of members) {
    const list = roles.get(member.person_id) ?? [];
    const role = member.position_id ? positionName.get(member.position_id) : undefined;
    if (role && !list.includes(role)) list.push(role);
    roles.set(member.person_id, list);
  }

  const suggested = [...roles.keys()].flatMap((personId): SearchComboboxOption[] => {
    const known = byId.get(personId);
    // Only people the roster offers can be chosen (archived people are left out).
    if (!known) return [];
    return [{ ...known, detail: (roles.get(personId) ?? []).join(', ') || team.name, keywords: [known.detail] }];
  });
  return { options, suggested };
};
