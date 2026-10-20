import {
  ApiError,
  type DelegatedRespondInput,
  type DelegatedScheduleEntry,
  type DelegationSummary,
  type GrantDelegationRequest,
  type RosterPerson,
} from '@service-center/shared';

/**
 * MOB-011: native help with another person's schedule on the F03 delegation
 * contract. Pure rules shared by the household picker, the grant form and the
 * delegated person screen; every action is re-checked by the server against
 * the live grant, so these only decide what to offer.
 */

/** One right as the website words it (`settings:help.rights.*`). */
export type DelegationRight = 'respond' | 'view' | 'availability';

/** Rights a grant carries, in the website's order. Answering implies seeing the requests. */
export const delegationRights = (delegation: DelegationSummary): DelegationRight[] => {
  const rights: DelegationRight[] = [];
  if (delegation.can_respond) rights.push('respond');
  if (delegation.can_view_schedule || delegation.can_respond) rights.push('view');
  if (delegation.can_manage_availability) rights.push('availability');
  return rights;
};

/** Whether the grant may read the released requests (`delegation_for(..., 'view_schedule')`). */
export const canSeeRequests = (delegation: DelegationSummary): boolean =>
  delegation.can_view_schedule || delegation.can_respond;

/** One person the signed-in account may act for, from an explicit active grant. */
export interface HouseholdPerson {
  delegationId: string;
  personId: string;
  name: string;
  rights: DelegationRight[];
}

/**
 * The household picker: only people who granted the signed-in account help
 * and whose grant is active right now. Being related or holding a role adds
 * nobody.
 */
export const householdPeople = (delegations: readonly DelegationSummary[]): HouseholdPerson[] =>
  delegations
    .filter((delegation) => delegation.direction === 'received' && delegation.active)
    .map((delegation) => ({
      delegationId: delegation.id,
      personId: delegation.target_person_id,
      name: delegation.target_name,
      rights: delegationRights(delegation),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

/** The active grant behind a delegated screen, or null when it was stopped, expired or never ours. */
export const activeReceivedGrant = (
  delegations: readonly DelegationSummary[] | undefined,
  delegationId: string | null | undefined,
): DelegationSummary | null =>
  delegations?.find((delegation) =>
    delegation.id === delegationId && delegation.direction === 'received' && delegation.active) ?? null;

/** Grants the signed-in account gave, active first, so the ones still in force are reviewed first. */
export const givenGrants = (delegations: readonly DelegationSummary[]): DelegationSummary[] =>
  delegations
    .filter((delegation) => delegation.direction === 'given')
    .sort((a, b) => Number(b.active) - Number(a.active) || a.delegate_name.localeCompare(b.delegate_name));

/** Who may be asked to help: active, not archived members with a login, other than yourself. */
export const helperCandidates = (people: readonly RosterPerson[], myPersonId: string | null): RosterPerson[] =>
  people.filter((person) =>
    person.person_id !== null
    && person.has_login
    && person.status === 'active'
    && !person.archived
    && person.person_id !== myPersonId);

/** Answers a delegate may give to one request under a respond grant (the website's buttons). */
export type DelegatedAction = 'accept' | 'decline' | 'withdraw';

export const delegatedActions = (delegation: DelegationSummary, entry: DelegatedScheduleEntry): DelegatedAction[] => {
  if (!delegation.can_respond) return [];
  if (entry.status === 'unconfirmed') return ['accept', 'decline'];
  if (entry.status === 'confirmed') return ['withdraw'];
  return [];
};

/** The respond body: the shown status is the expected one, so a changed request is refused (409), not overwritten. */
export const delegatedRespondBody = (
  entry: DelegatedScheduleEntry,
  action: DelegatedAction,
  reason: string,
): DelegatedRespondInput => {
  const status = action === 'accept' ? 'confirmed' : 'declined';
  return {
    status,
    expected_status: entry.status,
    reason: status === 'declined' ? reason.trim() || null : null,
  };
};

/** The form's choices before they become a grant request. */
export interface GrantDraft {
  delegatePersonId: string;
  canRespond: boolean;
  canView: boolean;
  canAvailability: boolean;
  /** Civil `YYYY-MM-DD` last day of help, or null for no end. */
  until: string | null;
}

export const emptyGrantDraft = (): GrantDraft => ({
  delegatePersonId: '',
  canRespond: true,
  canView: false,
  canAvailability: true,
  until: null,
});

/** At least one right and a helper, as the shared schema requires. */
export const grantDraftReady = (draft: GrantDraft): boolean =>
  draft.delegatePersonId !== '' && (draft.canRespond || draft.canView || draft.canAvailability);

/**
 * Same request the website sends: the expiry is the end of the chosen day on
 * this device. Delegated signup is not offered — F07 does not consume it yet.
 */
export const grantRequest = (draft: GrantDraft): GrantDelegationRequest => ({
  delegate_person_id: draft.delegatePersonId,
  can_respond: draft.canRespond,
  can_view_schedule: draft.canView || draft.canRespond,
  can_manage_availability: draft.canAvailability,
  expires_at: draft.until ? new Date(`${draft.until}T23:59:59`).toISOString() : null,
});

/** A new grant to someone who already helps replaces the old one (the server revokes and audits it). */
export const replacesActiveGrant = (delegations: readonly DelegationSummary[], delegatePersonId: string): boolean =>
  delegations.some((delegation) =>
    delegation.direction === 'given' && delegation.active && delegation.delegate_person_id === delegatePersonId);

/** How a delegated action failed, for the message and whether to reload. */
export type DelegatedFailure = 'stale' | 'grantEnded' | 'other';

export const classifyDelegatedError = (error: unknown): DelegatedFailure => {
  if (!(error instanceof ApiError)) return 'other';
  if (error.status === 409) return 'stale';
  // A stopped or expired grant (or a request no longer theirs) reads as not found / not allowed.
  if (error.status === 404 || error.status === 403) return 'grantEnded';
  return 'other';
};
