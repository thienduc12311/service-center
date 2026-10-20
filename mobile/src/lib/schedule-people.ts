import type {
  AssignmentAttendanceMode,
  AssignmentVisibility,
  AttendanceConflict,
  CreateAssignmentsInput,
  RosterPerson,
  TeamWithPositions,
} from '@service-center/shared';

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

/** A roster entry that can be scheduled, with whether it belongs to the chosen team. */
export interface ScheduleCandidate {
  person: RosterPerson;
  personId: string;
  onTeam: boolean;
}

/**
 * Website order: members of the chosen team first; only roster entries with a
 * Person; filtered by name or email. Archived people aren't returned by the API.
 */
export const scheduleCandidates = (
  people: readonly RosterPerson[],
  team: TeamWithPositions | undefined,
  filter: string,
): ScheduleCandidate[] => {
  const needle = filter.trim().toLowerCase();
  const onTeam = new Set(team?.members.map((member) => member.person_id) ?? []);
  const all = people
    .filter((person): person is RosterPerson & { person_id: string } => Boolean(person.person_id))
    .filter((person) => !needle || (person.full_name ?? person.email ?? '').toLowerCase().includes(needle))
    .map((person) => ({ person, personId: person.person_id, onTeam: onTeam.has(person.person_id) }));
  return team ? [...all].sort((a, b) => Number(b.onTeam) - Number(a.onTeam)) : all;
};

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
