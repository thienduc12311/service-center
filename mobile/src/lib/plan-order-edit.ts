import {
  ApiError,
  type ItemLeader,
  type LabeledKey,
  type TeamPositionRow,
  type RosterPerson,
  type TeamWithPositions,
} from '@service-center/shared';

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

/**
 * People who may lead an item: active roster Persons (F02 — archived people
 * are offered in no picker), filtered by name, the chosen one first.
 */
export const leaderPersonChoices = (
  people: readonly RosterPerson[],
  query: string,
  selectedPersonId: string,
  unnamed: string,
): PickerChoice[] => {
  const needle = query.trim().toLocaleLowerCase();
  const eligible = people.flatMap((person) =>
    person.person_id && !person.archived ? [{ id: person.person_id, label: person.full_name ?? unnamed }] : []);
  const matching = eligible.filter((choice) => choice.id === selectedPersonId || !needle || choice.label.toLocaleLowerCase().includes(needle));
  matching.sort((a, b) => Number(b.id === selectedPersonId) - Number(a.id === selectedPersonId));
  return matching.slice(0, PERSON_CHOICE_LIMIT);
};

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
