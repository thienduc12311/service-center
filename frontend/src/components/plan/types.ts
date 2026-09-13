import type {
  AssignmentDetail,
  PlanDetail,
  TeamPositionRow,
  TeamWithPositions,
} from '@service-center/shared';

/** The three panels of the plan workspace. */
export type PlanTab = 'order' | 'teams' | 'rehearse';

export const PLAN_TABS: readonly PlanTab[] = ['order', 'teams', 'rehearse'];

export const PLAN_TAB_LABELS: Record<PlanTab, string> = {
  order: 'Order',
  teams: 'Teams',
  rehearse: 'Rehearse',
};

/** One position on one team, as the plan's Teams tab shows it. */
export interface PlanTeamPositionView {
  position: TeamPositionRow;
  /** How many people this plan asks for; 0 means nobody has asked yet. */
  needed: number;
  scheduled: AssignmentDetail[];
}

export interface PlanTeamView {
  team: TeamWithPositions;
  positions: PlanTeamPositionView[];
  /** Scheduled on the team but not on a named position. */
  unpositioned: AssignmentDetail[];
  confirmed: number;
  declined: number;
  pending: number;
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

  return teams
    .filter((team) => {
      if (includeEveryTeam) return true;
      if (assignmentsByTeam.has(team.id)) return true;
      if (team.positions.some((position) => neededByPosition.has(position.id))) return true;
      return Boolean(plan.service_type_id) && team.service_type_id === plan.service_type_id;
    })
    .map((team) => {
      const scheduled = assignmentsByTeam.get(team.id) ?? [];
      return {
        team,
        positions: team.positions.map((position) => ({
          position,
          needed: neededByPosition.get(position.id) ?? 0,
          scheduled: scheduled.filter((assignment) => assignment.position_id === position.id),
        })),
        unpositioned: scheduled.filter((assignment) => assignment.position_id === null),
        confirmed: scheduled.filter((assignment) => assignment.status === 'confirmed').length,
        declined: scheduled.filter((assignment) => assignment.status === 'declined').length,
        pending: scheduled.filter((assignment) => assignment.status === 'unconfirmed').length,
      };
    });
};
