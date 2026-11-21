import type {
  AssignmentDetail,
  PlanDetail,
  TeamPositionRow,
  TeamWithPositions,
} from '@service-center/shared';

/** The panels of the plan workspace. */
export type PlanTab = 'order' | 'teams' | 'rehearse' | 'files' | 'stage' | 'attendance' | 'share';

export const PLAN_TABS: readonly PlanTab[] = ['order', 'teams', 'rehearse', 'files', 'stage', 'attendance', 'share'];

/** One position on one team, as the plan's Teams tab shows it. */
export interface PlanTeamPositionView {
  position: TeamPositionRow;
  /** How many people this plan asks for; 0 means nobody has asked yet. */
  needed: number;
  scheduled: AssignmentDetail[];
  /** F02: a position added for this plan only, not part of the team's usual list. */
  planOnly: boolean;
}

export interface PlanTeamView {
  team: TeamWithPositions;
  positions: PlanTeamPositionView[];
  /** Scheduled on the team but not on a named position. */
  unpositioned: AssignmentDetail[];
  confirmed: number;
  declined: number;
  /** Released and awaiting a reply. */
  pending: number;
  /** Prepared privately; only this team's schedulers see these. */
  prepared: AssignmentDetail[];
}

export interface BuildPlanTeamsInput {
  plan: PlanDetail;
  teams: readonly TeamWithPositions[];
  /** False narrows the list to teams that belong to, or already work on, this plan. */
  includeEveryTeam: boolean;
}

/**
 * Joins the plan's assignments and staffing needs onto the organization's
 * teams. A team is relevant to a plan when it belongs to the plan's service
 * type, or when somebody is already scheduled on it — "show all teams" widens
 * that to every team in the organization.
 */
export const buildPlanTeams = ({
  plan,
  teams,
  includeEveryTeam,
}: BuildPlanTeamsInput): PlanTeamView[] => {
  const neededByPosition = new Map(
    plan.position_needs.map((need) => [need.position_id, need.needed]),
  );
  const assignmentsByTeam = new Map<string, AssignmentDetail[]>();
  for (const assignment of plan.assignments) {
    assignmentsByTeam.set(assignment.team_id, [
      ...(assignmentsByTeam.get(assignment.team_id) ?? []),
      assignment,
    ]);
  }

  const planPositionsByTeam = new Map<string, TeamPositionRow[]>();
  for (const position of plan.plan_positions ?? []) {
    planPositionsByTeam.set(position.team_id, [...(planPositionsByTeam.get(position.team_id) ?? []), position]);
  }

  return teams
    .filter((team) => {
      if (includeEveryTeam) return true;
      if (assignmentsByTeam.has(team.id)) return true;
      if (planPositionsByTeam.has(team.id)) return true;
      if (team.positions.some((position) => neededByPosition.has(position.id))) return true;
      return Boolean(plan.service_type_id) && team.service_type_id === plan.service_type_id;
    })
    .map((team) => {
      const scheduled = assignmentsByTeam.get(team.id) ?? [];
      return {
        team,
        positions: [
          ...team.positions.map((position) => ({ position, planOnly: false })),
          ...(planPositionsByTeam.get(team.id) ?? []).map((position) => ({ position, planOnly: true })),
        ].map(({ position, planOnly }) => ({
          position,
          planOnly,
          needed: neededByPosition.get(position.id) ?? 0,
          scheduled: scheduled.filter((assignment) => assignment.position_id === position.id),
        })),
        unpositioned: scheduled.filter((assignment) => assignment.position_id === null),
        confirmed: scheduled.filter((assignment) => assignment.status === 'confirmed').length,
        declined: scheduled.filter((assignment) => assignment.status === 'declined').length,
        pending: scheduled.filter(
          (assignment) => assignment.status === 'unconfirmed' && assignment.visibility === 'released',
        ).length,
        prepared: scheduled.filter((assignment) => assignment.visibility === 'prepared'),
      };
    });
};

/** Requests that still hold a place: everything except a decline. */
const holdsPlace = (assignment: AssignmentDetail): boolean => assignment.status !== 'declined';

/** Awaiting an answer: released and not yet confirmed or declined. */
const isAwaitingReply = (assignment: AssignmentDetail): boolean =>
  assignment.status === 'unconfirmed' && assignment.visibility === 'released';

/** Places a position still needs filled: asked for, minus everyone not declined. */
export const openPlaces = (position: PlanTeamPositionView): number =>
  Math.max(0, position.needed - position.scheduled.filter(holdsPlace).length);

/**
 * A gap is something a scheduler still has to act on: an unfilled place, a
 * decline, or a request nobody has answered yet.
 */
export const positionHasGap = (position: PlanTeamPositionView): boolean =>
  openPlaces(position) > 0 ||
  position.scheduled.some((assignment) => assignment.status === 'declined' || isAwaitingReply(assignment));

/** Requests on the team with no position that need attention (declined or unanswered). */
export const unpositionedGaps = (team: PlanTeamView): AssignmentDetail[] =>
  team.unpositioned.filter((assignment) => assignment.status === 'declined' || isAwaitingReply(assignment));

/** The one-line staffing summary of a team on a plan ("3/5 confirmed · 2 open"). */
export interface PlanTeamSummary {
  confirmed: number;
  /** Places on the team: each position's need or its headcount, whichever is larger. */
  places: number;
  /** Unfilled places across the team's positions. */
  open: number;
  /** Positions (plus unpositioned requests) with a gap. */
  gaps: number;
}

export const summarizePlanTeam = (team: PlanTeamView): PlanTeamSummary => ({
  confirmed: team.confirmed,
  places:
    team.positions.reduce((sum, position) => sum + Math.max(position.needed, position.scheduled.filter(holdsPlace).length), 0) +
    team.unpositioned.filter(holdsPlace).length,
  open: team.positions.reduce((sum, position) => sum + openPlaces(position), 0),
  gaps: team.positions.filter(positionHasGap).length + unpositionedGaps(team).length,
});
