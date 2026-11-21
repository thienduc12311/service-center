import {
  ApiError,
  keyedPlanItemRequest,
  type AssignmentDetail,
  type CreatePlanItemRequest,
  type ItemLeader,
  type LabeledKey,
  type TeamPositionRow,
  type RosterPerson,
  type TeamWithPositions,
} from '@service-center/shared';
import { matchesSearch } from './list-search';
import type { SearchableOption } from './option-groups';

/**
 * MOB-014: native order editing on the F11 contracts (`addPlanItem`,
 * `updatePlanItem`, `reorderPlanItems`, `deletePlanItem`). The draft/request
 * rules live in `@service-center/shared` (`plan-item-draft`) so the website
 * and the app send the same thing; these helpers only shape native choices
 * and read the server's answers.
 */

/** How a refused or failed order write should be presented. */
export type OrderWriteOutcome =
  /** Someone else changed the plan first: nothing was saved; show the latest. */
  | 'stale'
  /** The item (or plan) is gone or no longer readable. */
  | 'gone'
  /** No answer from the server: the write may or may not have happened. */
  | 'uncertain'
  /** Refused for another reason (validation, permission); shown as is. */
  | 'refused';

export const orderWriteOutcome = (error: unknown): OrderWriteOutcome => {
  if (error instanceof ApiError) {
    if (error.code === 'plan_revision_stale') return 'stale';
    if (error.status === 404) return 'gone';
    return 'refused';
  }
  return 'uncertain';
};

/** A choice in a list of positions or people. */
export interface PickerChoice {
  id: string;
  label: string;
}

/** Labels the position list is worded with, in the displayed language. */
export interface PositionChoiceWords {
  teamPosition: (team: string, position: string) => string;
  planPosition: (team: string, position: string) => string;
  unknownTeam: string;
}

/**
 * Positions that may lead an item, as the website lists them: every team's
 * shared positions, then this plan's own positions marked "(this plan)".
 */
export const leaderPositionChoices = (
  teams: readonly TeamWithPositions[],
  planPositions: readonly Pick<TeamPositionRow, 'id' | 'team_id' | 'name'>[],
  words: PositionChoiceWords,
): PickerChoice[] => {
  const choices = teams.flatMap((team) =>
    team.positions
      .filter((position) => !position.plan_id)
      .map((position) => ({ id: position.id, label: words.teamPosition(team.name, position.name) })),
  );
  for (const position of planPositions) {
    const team = teams.find((candidate) => candidate.id === position.team_id);
    choices.push({ id: position.id, label: words.planPosition(team?.name ?? words.unknownTeam, position.name) });
  }
  return choices;
};

/** Position names by id, for naming an unfilled leader position. */
export const positionNamesFor = (
  teams: readonly TeamWithPositions[],
  planPositions: readonly Pick<TeamPositionRow, 'id' | 'name'>[],
): Map<string, string> => {
  const names = new Map<string, string>();
  for (const team of teams) for (const position of team.positions) names.set(position.id, position.name);
  for (const position of planPositions) names.set(position.id, position.name);
  return names;
};

/** Upper bound on people listed at once; search narrows the rest. */
export const PERSON_CHOICE_LIMIT = 30;

/** A person who may lead an item, and whether they serve on this plan. */
export interface LeaderPersonChoice extends PickerChoice {
  onPlan: boolean;
}

/** The people on this plan (any answer but declined), once each, in plan order. */
export const planPeopleChoices = (
  assignments: readonly Pick<AssignmentDetail, 'person_id' | 'status' | 'person'>[],
  unnamed: string,
): PickerChoice[] => {
  const seen = new Set<string>();
  const choices: PickerChoice[] = [];
  for (const assignment of assignments) {
    if (assignment.status === 'declined' || seen.has(assignment.person_id)) continue;
    seen.add(assignment.person_id);
    choices.push({ id: assignment.person_id, label: assignment.person?.full_name ?? unnamed });
  }
  return choices;
};

export interface LeaderPersonInput {
  /** People on this plan (`planPeopleChoices`). */
  planPeople: readonly PickerChoice[];
  /** One server page of People for the current search (or the first page when blank). */
  results: readonly RosterPerson[];
  query: string;
  selectedPersonId: string;
  /** The server has more People for this search than the page holds. */
  hasMore: boolean;
  unnamed: string;
  limit?: number;
}

export interface LeaderPersonSuggestions {
  choices: LeaderPersonChoice[];
  /** Some matches are not listed: say so and ask for a narrower search. */
  truncated: boolean;
}

/**
 * People who may lead an item: those on this plan first (filtered by the
 * search on the device), then the server's matches — active roster Persons
 * only (F02: archived people are offered in no picker) — the chosen one at
 * the top, at most `limit`, and honest about what was left out.
 */
export const leaderPersonSuggestions = ({
  planPeople,
  results,
  query,
  selectedPersonId,
  hasMore,
  unnamed,
  limit = PERSON_CHOICE_LIMIT,
}: LeaderPersonInput): LeaderPersonSuggestions => {
  const onPlan = new Set(planPeople.map((choice) => choice.id));
  const fromPlan = planPeople
    .filter((choice) => matchesSearch(query, [choice.label]))
    .map((choice) => ({ ...choice, onPlan: true }));
  const fromServer = results.flatMap((person) =>
    person.person_id && !person.archived && !onPlan.has(person.person_id)
      ? [{ id: person.person_id, label: person.full_name ?? unnamed, onPlan: false }]
      : []);
  const all = [...fromPlan, ...fromServer];
  all.sort((a, b) => Number(b.id === selectedPersonId) - Number(a.id === selectedPersonId));
  return { choices: all.slice(0, limit), truncated: hasMore || all.length > limit };
};

/** Labels the grouped position list is worded with, in the displayed language. */
export interface PositionOptionWords extends PositionChoiceWords {
  /** A plan-only position inside its team's group: "Extra keys (this plan)". */
  planPositionShort: (position: string) => string;
}

/**
 * The same positions as `leaderPositionChoices`, grouped by team for a
 * searchable list; the caller lists teams serving on this plan first
 * (`leadingGroupKeys` from `staffedTeamIds`).
 */
export const leaderPositionOptions = (
  teams: readonly TeamWithPositions[],
  planPositions: readonly Pick<TeamPositionRow, 'id' | 'team_id' | 'name'>[],
  words: PositionOptionWords,
): SearchableOption[] => {
  const options: SearchableOption[] = teams.flatMap((team) =>
    team.positions
      .filter((position) => !position.plan_id)
      .map((position) => ({
        value: position.id,
        label: words.teamPosition(team.name, position.name),
        groupedLabel: position.name,
        groupKey: team.id,
        groupLabel: team.name,
      })));
  for (const position of planPositions) {
    const team = teams.find((candidate) => candidate.id === position.team_id);
    const teamName = team?.name ?? words.unknownTeam;
    options.push({
      value: position.id,
      label: words.planPosition(teamName, position.name),
      groupedLabel: words.planPositionShort(position.name),
      groupKey: position.team_id,
      groupLabel: teamName,
    });
  }
  return options;
};

/** Teams with someone (not declined) on this plan: their positions are the likely leaders. */
export const staffedTeamIds = (assignments: readonly Pick<AssignmentDetail, 'team_id' | 'status'>[]): string[] =>
  [...new Set(assignments.filter((assignment) => assignment.status !== 'declined').map((assignment) => assignment.team_id))];

/** Labels an item leader is described with, in the displayed language. */
export interface LeaderWords {
  someoneOnRoster: string;
  position: string;
  someone: string;
  unfilled: (position: string) => string;
  holders: (position: string, names: string) => string;
  notYetAsked: (name: string) => string;
  list: (items: readonly string[]) => string;
}

/** An item leader in words, and whether it still needs someone. */
export interface LeaderLine {
  text: string;
  unfilled: boolean;
}

/** The website Order tab's leader wording (F11 `resolveItemLeader` result). */
export const leaderLine = (leader: ItemLeader, words: LeaderWords): LeaderLine | null => {
  switch (leader.kind) {
    case 'none':
      return null;
    case 'person':
      return { text: leader.name ?? words.someoneOnRoster, unfilled: false };
    case 'position': {
      const position = leader.position_name ?? words.position;
      if (leader.holders.length === 0) return { text: words.unfilled(position), unfilled: true };
      const names = leader.holders.map((holder) => {
        const name = holder.name ?? words.someone;
        return holder.prepared ? words.notYetAsked(name) : name;
      });
      return { text: words.holders(position, words.list(names)), unfilled: false };
    }
  }
};

/** A labeled library key as the website's dropdown words it: "Low · Bb · capo 3 · Alto". */
export const labeledKeyText = (key: Pick<LabeledKey, 'label' | 'song_key' | 'capo' | 'vocal_label'>, capo: (fret: number) => string): string =>
  [key.label, key.song_key, ...(key.capo ? [capo(key.capo)] : []), ...(key.vocal_label ? [key.vocal_label] : [])].join(' · ');

/** Whose add an attempt belongs to; keys are never shared across accounts or organizations. */
export interface PlanItemAddOwner {
  userId: string;
  organizationId: string;
}

/**
 * F11: the last unanswered add per (account, organization, plan). Sending
 * the same draft again reuses its key, so Retry after no answer returns the
 * item the first attempt made; a changed draft gets a new key.
 */
export class PlanItemAddAttempts {
  private readonly attempts = new Map<string, CreatePlanItemRequest>();

  constructor(private readonly makeKey: () => string) {}

  private id(owner: PlanItemAddOwner, planId: string): string {
    return `${owner.userId}:${owner.organizationId}:${planId}`;
  }

  /** The body to send now, keyed; remembered until the server answers. */
  next(owner: PlanItemAddOwner, planId: string, body: CreatePlanItemRequest): CreatePlanItemRequest {
    const keyed = keyedPlanItemRequest(body, this.attempts.get(this.id(owner, planId)) ?? null, this.makeKey);
    this.attempts.set(this.id(owner, planId), keyed);
    return keyed;
  }

  /** The server answered (added, or refused): the next add is a new one. */
  settle(owner: PlanItemAddOwner, planId: string): void {
    this.attempts.delete(this.id(owner, planId));
  }
}
