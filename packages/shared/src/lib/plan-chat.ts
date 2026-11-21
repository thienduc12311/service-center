/** The parts of an assignment that decide plan chat participation. */
export interface PlanChatAssignment {
  user_id: string | null;
  visibility: string;
  status: string;
}

/**
 * Whether the caller may open a plan's chat: plan leaders (edit the plan or
 * schedule its service type), or people with a released, not-declined request
 * on it. Same rule as the database's participant check; the server still
 * decides (404 otherwise), this only hides an entry point that would dead-end.
 */
export const canOpenPlanChat = (
  isPlanLeader: boolean,
  assignments: readonly PlanChatAssignment[],
  profileId: string | null | undefined,
): boolean =>
  isPlanLeader
  || (profileId != null
    && assignments.some((assignment) =>
      assignment.user_id === profileId && assignment.visibility === 'released' && assignment.status !== 'declined'));
