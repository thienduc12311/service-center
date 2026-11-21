/** The parts of an assignment that decide plan chat participation. */
export interface PlanChatAssignment {
  user_id: string | null;
  visibility: string;
  status: string;
}

/**
 * Whether the caller may open a plan's chat: plan leaders (edit the plan or
 * schedule its service type), or people with a released, not-declined request
 * on it, and in every case a roster person who is not a child
 * (`private.can_access_conversation` requires `is_adult_person`, so a child
 * leader is denied too). `isAdultPerson` is the plan payload's
 * `viewer_is_adult_person`; undefined (not reported) is treated as allowed.
 * The server still decides (404 otherwise), this only hides an entry point
 * that would dead-end.
 */
export const canOpenPlanChat = (
  isPlanLeader: boolean,
  assignments: readonly PlanChatAssignment[],
  profileId: string | null | undefined,
  isAdultPerson?: boolean,
): boolean =>
  isAdultPerson !== false
  && (isPlanLeader
    || (profileId != null
      && assignments.some((assignment) =>
        assignment.user_id === profileId && assignment.visibility === 'released' && assignment.status !== 'declined')));

/** The parts of a loaded plan that decide whether its chat is offered. */
export interface PlanChatPlan {
  assignments: readonly PlanChatAssignment[];
  viewer_is_adult_person?: boolean;
}

/**
 * `canOpenPlanChat` for a screen that may still be loading its plan. Before the plan arrives
 * `viewer_is_adult_person` is unknown, so an org-wide leader would otherwise be offered a chat
 * a child leader cannot open: show nothing until the plan is here.
 */
export const canOfferPlanChat = (
  plan: PlanChatPlan | undefined,
  isPlanLeader: boolean,
  profileId: string | null | undefined,
): boolean =>
  plan !== undefined && canOpenPlanChat(isPlanLeader, plan.assignments, profileId, plan.viewer_is_adult_person);
