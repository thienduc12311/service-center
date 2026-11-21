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
