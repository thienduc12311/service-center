/**
 * Leader approval is the independent second control on signup claims,
 * replacement offers and approved swaps: the person who benefits never
 * approves their own request (W2-RESP-D2). The database refuses it
 * (`self_approval`); clients use this to hide the Approve control instead.
 */

/** A request and the People it benefits (claimant, candidate, swap participants). */
export interface ApprovalSubject {
  beneficiaryPersonIds: readonly (string | null | undefined)[];
}

/** Whether `actorPersonId` is one of the subject's beneficiaries. */
export const isOwnApproval = (subject: ApprovalSubject, actorPersonId: string | null | undefined): boolean =>
  Boolean(actorPersonId) && subject.beneficiaryPersonIds.some((personId) => personId === actorPersonId);

/** Approve may be offered: the caller can lead, and is not approving their own request. */
export const mayApproveAsLeader = (
  subject: ApprovalSubject,
  actorPersonId: string | null | undefined,
  mayLead: boolean,
): boolean => mayLead && !isOwnApproval(subject, actorPersonId);
