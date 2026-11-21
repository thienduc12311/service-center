import type { PlanDetail, RosterPerson, TeamWithPositions } from '@service-center/shared';
import type { SearchComboboxOption } from '../SearchCombobox';

/** What a leader picker offers: everything, plus the likely answers listed first. */
export interface PickerChoices {
  options: SearchComboboxOption[];
  suggested: SearchComboboxOption[];
}

/** Translated text the builders need, so they stay free of i18n. */
export interface LeaderChoiceLabels {
  unnamed: string;
  /** Fallback team name for a position whose team isn't visible. */
  team: string;
  /** Detail for a position that exists on this plan only. */
  planOnly: string;
  /** "Team · Position" for a person's role on this plan. */
  teamPosition: (team: string, position: string) => string;
}

export interface LeaderPersonChoicesInput {
  plan: Pick<PlanDetail, 'assignments'>;
  roster: readonly RosterPerson[];
  labels: LeaderChoiceLabels;
}

export interface LeaderPositionChoicesInput {
  plan: Pick<PlanDetail, 'assignments' | 'plan_positions' | 'position_needs'>;
  teams: readonly TeamWithPositions[];
  labels: LeaderChoiceLabels;
}

/**
 * People who can lead an item: the active roster, with the people serving on
 * this plan (anyone not declined) suggested first, each with their roles.
 */
export const leaderPersonChoices = ({ plan, roster, labels }: LeaderPersonChoicesInput): PickerChoices => {
  const options: SearchComboboxOption[] = roster
    .filter((person): person is RosterPerson & { person_id: string } => Boolean(person.person_id) && !person.archived)
    .map((person) => ({
      id: person.person_id,
      label: person.full_name ?? labels.unnamed,
      detail: person.email,
      avatar: { name: person.full_name, url: person.avatar_url },
    }));
  const byId = new Map(options.map((option) => [option.id, option]));

  const roles = new Map<string, string[]>();
  const order: string[] = [];
  for (const assignment of plan.assignments) {
    if (assignment.status === 'declined') continue;
    if (!roles.has(assignment.person_id)) {
      roles.set(assignment.person_id, []);
      order.push(assignment.person_id);
    }
    const team = assignment.team?.name ?? labels.team;
    const role = assignment.position ? labels.teamPosition(team, assignment.position.name) : team;
    const list = roles.get(assignment.person_id)!;
    if (!list.includes(role)) list.push(role);
  }

  const suggested = order.flatMap((personId): SearchComboboxOption[] => {
    const known = byId.get(personId);
    const assignment = plan.assignments.find((candidate) => candidate.person_id === personId);
    const name = known?.label ?? assignment?.person?.full_name ?? null;
    if (!known && !name) return [];
    return [
      {
        id: personId,
        label: name ?? labels.unnamed,
        detail: (roles.get(personId) ?? []).join(', '),
        keywords: [known?.detail],
        avatar: known?.avatar ?? { name, url: assignment?.person?.avatar_url ?? null },
      },
    ];
  });
  return { options, suggested };
};

/**
 * Positions that can lead an item, grouped by team. Positions this plan
 * staffs (someone scheduled, a need set, or a plan-only position) come first.
 */
export const leaderPositionChoices = ({ plan, teams, labels }: LeaderPositionChoicesInput): PickerChoices => {
  const options: SearchComboboxOption[] = [];
  for (const team of teams) {
    for (const position of team.positions) {
      if (position.plan_id) continue;
      options.push({ id: position.id, label: position.name, group: team.name });
    }
    for (const position of plan.plan_positions) {
      if (position.team_id !== team.id) continue;
      options.push({ id: position.id, label: position.name, detail: labels.planOnly, group: team.name });
    }
  }
  // Plan-only positions of a team the viewer can't see still belong in the list.
  for (const position of plan.plan_positions) {
    if (teams.some((team) => team.id === position.team_id)) continue;
    options.push({ id: position.id, label: position.name, detail: labels.planOnly, group: labels.team });
  }

  const staffed = new Set<string>(plan.plan_positions.map((position) => position.id));
  for (const assignment of plan.assignments) {
    if (assignment.position_id && assignment.status !== 'declined') staffed.add(assignment.position_id);
  }
  for (const need of plan.position_needs) if (need.needed > 0) staffed.add(need.position_id);

  const suggested = options
    .filter((option) => staffed.has(option.id))
    .map((option) => ({
      ...option,
      detail: option.detail ? `${option.group ?? labels.team} · ${option.detail}` : option.group,
      group: undefined,
      keywords: [option.group],
    }));
  return { options, suggested };
};
