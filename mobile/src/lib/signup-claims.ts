import {
  ApiError,
  claimSignupOpportunitySchema,
  type ClaimSignupOpportunityInput,
  type OpportunityClaimDetail,
  type OpportunityClaimRow,
  type OpportunityClaimStatus,
  type ServiceCenterAccentName,
  type SignupOpportunity,
} from '@service-center/shared';

/**
 * MOB-009 Pass B: pure rules for the native Open positions screens. The wire
 * shapes are F07's (`SignupOpportunity`, `OpportunityClaimRow`); this module
 * only derives what the volunteer sees and keeps one claim key per opening so
 * a retry can never sign someone up twice.
 */

/** Claim states that still hold (or have) a place. */
const LIVE_CLAIM: readonly OpportunityClaimStatus[] = ['awaiting_approval', 'confirmed'];

/**
 * What the opening card says, in the website's order: the caller's own claim
 * wins over the opening's eligibility (`OpportunityPanel`).
 */
export type OpeningStatus =
  | { kind: 'claim'; status: OpportunityClaimStatus }
  | { kind: 'eligibility'; eligibility: SignupOpportunity['eligibility'] };

export const openingStatus = (opening: SignupOpportunity): OpeningStatus =>
  opening.my_claim
    ? { kind: 'claim', status: opening.my_claim.status }
    : { kind: 'eligibility', eligibility: opening.eligibility };

/** No claim yet and the server says this Person can take it now. */
export const canClaim = (opening: SignupOpportunity): boolean =>
  !opening.my_claim && opening.eligibility === 'eligible';

/** The server lets the claimant cancel a held or confirmed place. */
export const canCancelClaim = (claim: OpportunityClaimRow | null): claim is OpportunityClaimRow =>
  Boolean(claim && LIVE_CLAIM.includes(claim.status));

/**
 * A claim that ended (cancelled, rejected, expired, superseded). F07 allows one
 * claim per Person per opening, so it cannot be claimed again.
 */
export const claimEnded = (claim: OpportunityClaimRow | null): boolean =>
  Boolean(claim && !LIVE_CLAIM.includes(claim.status));

/** One reviewed signup: the opening version the person saw and a stable key. */
export interface ClaimAttempt {
  opportunityId: string;
  idempotencyKey: string;
  reviewedVersion: number;
}

/** Who the attempt belongs to; keys are never shared across accounts or organizations. */
export interface ClaimAttemptOwner {
  userId: string;
  organizationId: string;
}

/**
 * Keeps one idempotency key per (account, organization, opening) until a claim
 * is observed. A retry after a lost response reuses the key, so the server
 * returns the claim it already made. A fresh review after a stale version
 * keeps the key and only updates the reviewed version.
 */
export class ClaimAttempts {
  private readonly attempts = new Map<string, ClaimAttempt>();

  constructor(private readonly makeKey: () => string) {}

  private id(owner: ClaimAttemptOwner, opportunityId: string): string {
    return `${owner.userId}:${owner.organizationId}:${opportunityId}`;
  }

  /** Start (or refresh) the review of this exact opening version. */
  review(owner: ClaimAttemptOwner, opening: Pick<SignupOpportunity, 'id' | 'version'>): ClaimAttempt {
    const id = this.id(owner, opening.id);
    const existing = this.attempts.get(id);
    const attempt: ClaimAttempt = {
      opportunityId: opening.id,
      idempotencyKey: existing?.idempotencyKey ?? this.makeKey(),
      reviewedVersion: opening.version,
    };
    this.attempts.set(id, attempt);
    return attempt;
  }

  get(owner: ClaimAttemptOwner, opportunityId: string): ClaimAttempt | null {
    return this.attempts.get(this.id(owner, opportunityId)) ?? null;
  }

  /** The server has a claim for this opening; the key is no longer needed. */
  settle(owner: ClaimAttemptOwner, opportunityId: string): void {
    this.attempts.delete(this.id(owner, opportunityId));
  }
}

/** The exact claim body, validated with the shared schema. */
export const claimBody = (attempt: ClaimAttempt): ClaimSignupOpportunityInput =>
  claimSignupOpportunitySchema.parse({
    expected_version: attempt.reviewedVersion,
    idempotency_key: attempt.idempotencyKey,
  });

/** Why a claim did not go through, as the volunteer needs to hear it. */
export type ClaimFailure =
  | 'full'
  | 'closed'
  | 'stale'
  | 'conflict'
  | 'not_eligible'
  | 'not_found'
  | 'already_claimed'
  | 'uncertain'
  | 'failed';

/** Maps the F07 API errors (see `fromPostgrestError`) to a claim outcome. */
export const classifyClaimError = (error: unknown): ClaimFailure => {
  if (!(error instanceof ApiError)) return 'uncertain';
  if (error.status === 409) {
    switch (error.code) {
      case 'capacity_full': return 'full';
      case 'opportunity_closed': return 'closed';
      case 'opportunity_changed': return 'stale';
      case 'scheduling_conflict': return 'conflict';
      // A second key for the same opening hits the one-claim-per-Person rule.
      default: return 'already_claimed';
    }
  }
  if (error.status === 403) return 'not_eligible';
  if (error.status === 404) return 'not_found';
  if (error.status === 0 || error.status >= 500) return 'uncertain';
  return 'failed';
};

/** The opening must be read again before anything else is shown or sent. */
export const failureNeedsRefetch = (failure: ClaimFailure): boolean => failure !== 'failed';

/** A new review is required (the version the person saw is no longer current). */
export const failureNeedsReview = (failure: ClaimFailure): boolean => failure === 'stale';

/** Leader view: claims on this opening still waiting for a decision, oldest hold first. */
export const pendingApprovals = (
  claims: readonly OpportunityClaimDetail[],
  opportunityId: string,
  now: Date,
): OpportunityClaimDetail[] =>
  claims
    .filter((claim) =>
      claim.opportunity.id === opportunityId
      && claim.status === 'awaiting_approval'
      // Lapsed holds are expired by the server on the next read; never offer them.
      && claim.reservation_expires_at !== null
      && new Date(claim.reservation_expires_at).getTime() > now.getTime())
    .sort((a, b) => (a.reservation_expires_at ?? '').localeCompare(b.reservation_expires_at ?? ''));

/** When an approval hold would end if the claim were made now. */
export const reservationEndsAt = (opening: Pick<SignupOpportunity, 'reservation_minutes'>, now: Date): Date =>
  new Date(now.getTime() + opening.reservation_minutes * 60_000);

/** Tag color for an opening's status, from the shared palette. */
export const openingAccent = (status: OpeningStatus): ServiceCenterAccentName => {
  if (status.kind === 'claim') {
    if (status.status === 'confirmed') return 'green';
    if (status.status === 'awaiting_approval') return 'yellow';
    return status.status === 'rejected' ? 'red' : 'neutral';
  }
  return status.eligibility === 'eligible' ? 'blue' : 'neutral';
};

/** Translation key (staffing namespace) for the status word, matching the website. */
export type OpeningStatusKey =
  | `opportunities.claimStatus.${OpportunityClaimStatus}`
  | `opportunities.eligibility.${SignupOpportunity['eligibility']}`;

export const openingStatusKey = (status: OpeningStatus): OpeningStatusKey =>
  status.kind === 'claim'
    ? `opportunities.claimStatus.${status.status}`
    : `opportunities.eligibility.${status.eligibility}`;
