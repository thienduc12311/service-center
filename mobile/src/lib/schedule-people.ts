import type {
  AssignmentAttendanceMode,
  AssignmentDetail,
  AssignmentVisibility,
  AttendanceConflict,
  CreateAssignmentsInput,
  ListPeoplePageRequest,
  RosterPerson,
  TeamPositionRow,
  TeamWithPositions,
} from '@service-center/shared';
import type { SearchableOption } from './option-groups';

/*
 * MOB-008 Pass B: the website's SchedulePeopleModal rules
 * (frontend/src/components/plan/SchedulePeopleModal.tsx, attendance.tsx),
 * kept as pure functions so native and web pick and commit the same way.
 */

/** The attendance scope a scheduler is choosing. */
export interface TimeScope {
  mode: AssignmentAttendanceMode;
  timeIds: string[];
}

export const ALL_TIMES: TimeScope = { mode: 'all', timeIds: [] };

export const isScopeComplete = (scope: TimeScope): boolean => scope.mode === 'all' || scope.timeIds.length > 0;

export const toggleScopeTime = (scope: TimeScope, timeId: string): TimeScope => ({
  mode: 'selected',
  timeIds: scope.timeIds.includes(timeId)
    ? scope.timeIds.filter((id) => id !== timeId)
    : [...scope.timeIds, timeId],
});

/** Who the people list shows: the chosen team's members, or the whole roster. */
export type PeopleScope = 'team' | 'everyone';

/** Team members once a team is chosen (the likely answers); everyone before that. */
export const defaultPeopleScope = (teamId: string): PeopleScope => (teamId ? 'team' : 'everyone');

/** People per server page in the schedule list. */
export const SCHEDULE_PEOPLE_PAGE_SIZE = 50;

export interface SchedulePeopleQueryInput {
  scope: PeopleScope;
  teamId: string;
  /** The settled (debounced) search text. */
  search: string;
  cursor?: string;
  limit?: number;
}

/** One `GET /people/page` request for the schedule list (archived people are never offered). */
export const schedulePeopleQuery = ({ scope, teamId, search, cursor, limit = SCHEDULE_PEOPLE_PAGE_SIZE }: SchedulePeopleQueryInput): ListPeoplePageRequest => {
  const q = search.trim();
  return {
    limit,
    ...(scope === 'team' && teamId ? { team_id: teamId } : {}),
    ...(q ? { q } : {}),
    ...(cursor ? { cursor } : {}),
  };
};

/** A row in the server-searched schedule list, with what to know before ticking it. */
export interface SchedulePersonRow {
  personId: string;
  name: string;
  avatarUrl: string | null;
  onTeam: boolean;
  /** Already asked (and not declined) somewhere on this plan. */
  onPlan: boolean;
  noLogin: boolean;
}

export interface SchedulePersonRowsInput {
  /** Every loaded page's people, in server order. */
  people: readonly RosterPerson[];
  team: Pick<TeamWithPositions, 'members'> | undefined;
  assignments: readonly Pick<AssignmentDetail, 'person_id' | 'status'>[];
  unnamed: string;
}

/**
 * Loaded pages as list rows: Persons only, never archived, each once (keyset
 * pages can overlap while the roster changes), marked on team / on this plan /
 * no login. Server order is kept: within a team it is already the team.
 */
export const schedulePersonRows = ({ people, team, assignments, unnamed }: SchedulePersonRowsInput): SchedulePersonRow[] => {
  const members = new Set(team?.members.map((member) => member.person_id) ?? []);
  const onPlan = new Set(assignments.filter((assignment) => assignment.status !== 'declined').map((assignment) => assignment.person_id));
  const seen = new Set<string>();
  const rows: SchedulePersonRow[] = [];
  for (const person of people) {
    if (!person.person_id || person.archived || seen.has(person.person_id)) continue;
    seen.add(person.person_id);
    rows.push({
      personId: person.person_id,
      name: person.full_name ?? person.email ?? unnamed,
      avatarUrl: person.avatar_url,
      onTeam: members.has(person.person_id),
      onPlan: onPlan.has(person.person_id),
      noLogin: !person.has_login,
    });
  }
  return rows;
};

/** Someone ticked: kept with their name so the chip survives a new search. */
export interface SelectedPerson {
  personId: string;
  name: string;
}

/** Ticks or unticks a person; the selection is independent of the list on screen. */
export const toggleSelectedPerson = (selected: readonly SelectedPerson[], person: SelectedPerson): SelectedPerson[] =>
  selected.some((entry) => entry.personId === person.personId)
    ? selected.filter((entry) => entry.personId !== person.personId)
    : [...selected, person];

/** Distinct members of a team (a person holding two positions counts once). */
export const teamMemberCount = (team: Pick<TeamWithPositions, 'members'> | undefined): number =>
  new Set(team?.members.map((member) => member.person_id) ?? []).size;

/** Labels the position list is worded with. */
export interface SchedulePositionWords {
  /** A plan-only position as a chip: "Guest trumpet (this plan)". */
  planPosition: (position: string) => string;
  /** The group plan-only positions are listed under. */
  planOnlyGroup: string;
}

/**
 * The team's own positions, then this plan's positions for the team in a
 * "This plan only" group (each id once).
 */
export const schedulePositionOptions = (
  team: Pick<TeamWithPositions, 'id' | 'positions'> | undefined,
  planPositions: readonly Pick<TeamPositionRow, 'id' | 'team_id' | 'name'>[],
  words: SchedulePositionWords,
): SearchableOption[] => {
  if (!team) return [];
  const seen = new Set<string>();
  const options: SearchableOption[] = [];
  for (const position of team.positions) {
    if (position.plan_id || seen.has(position.id)) continue;
    seen.add(position.id);
    options.push({ value: position.id, label: position.name });
  }
  for (const position of planPositions) {
    if (position.team_id !== team.id || seen.has(position.id)) continue;
    seen.add(position.id);
    options.push({
      value: position.id,
      label: words.planPosition(position.name),
      groupedLabel: position.name,
      groupKey: 'plan',
      groupLabel: words.planOnlyGroup,
    });
  }
  return options;
};

/** Position chips up to this many; more open a searchable list (review §3.3). */
export const POSITION_CHIP_LIMIT = 8;

export const blockingConflicts = (conflicts: readonly AttendanceConflict[]): AttendanceConflict[] =>
  conflicts.filter((conflict) => conflict.severity === 'blocking');

export interface ScheduleDraft {
  teamId: string;
  positionId: string | null;
  personIds: readonly string[];
  scope: TimeScope;
  visibility: AssignmentVisibility;
  preferenceOverrideReason: string;
  conflictOverrideReason: string;
  hasBlocking: boolean;
}

/** The exact body the website sends to createAssignments. */
export const createAssignmentsBody = (draft: ScheduleDraft): CreateAssignmentsInput => ({
  assignments: draft.personIds.map((personId) => ({
    person_id: personId,
    team_id: draft.teamId,
    position_id: draft.positionId,
    attendance_mode: draft.scope.mode,
    time_ids: draft.scope.mode === 'selected' ? draft.scope.timeIds : [],
  })),
  notify: true,
  // Schema default; overrides go through the reason below, as on the website.
  ignore_conflicts: false,
  visibility: draft.visibility,
  preference_override_reason: draft.preferenceOverrideReason.trim() || null,
  conflict_override_reason: draft.hasBlocking ? draft.conflictOverrideReason.trim() || null : null,
});

export interface CanCommitInput {
  teamId: string;
  selectedCount: number;
  scope: TimeScope;
  blockingCount: number;
  mayOverride: boolean;
  conflictReason: string;
}

/** Website rule for enabling the commit button. */
export const canCommitSchedule = (input: CanCommitInput): boolean =>
  Boolean(input.teamId)
  && input.selectedCount > 0
  && isScopeComplete(input.scope)
  && !(input.blockingCount > 0 && (!input.mayOverride || !input.conflictReason.trim()));
