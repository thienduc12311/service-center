import {
  ApiError,
  actOnReplacementOfferSchema,
  createReplacementRequestSchema,
  type ActOnReplacementOfferInput,
  type AttendanceConflict,
  type CheckAssignmentConflictsRequest,
  type ConflictKind,
  type CreateReplacementRequestInput,
  type ReplacementOfferRow,
  type ReplacementOfferStatus,
  type ReplacementRequestDetail,
  type ReplacementRequestStatus,
  type ServiceCenterAccentName,
  type TeamWithPositions,
} from '@service-center/shared';

/**
 * MOB-010 Pass B: pure rules for the native replacement screens. The wire
 * shapes and the state machine are F07's (`ReplacementRequestDetail`,
 * `ReplacementOfferRow`); this module only derives who may do what, what each
 * person is told, and keeps one request key per declined assignment so a retry
 * never opens a second request.
 */

export type OfferAction = ActOnReplacementOfferInput['action'];

/** Offers that still hold, or may still take, the place. */
const LIVE_OFFER: readonly ReplacementOfferStatus[] = ['pending', 'accepted_awaiting_approval'];

export const offerIsLive = (offer: Pick<ReplacementOfferRow, 'status'>): boolean => LIVE_OFFER.includes(offer.status);

/**
 * Where one offer stands, in plain terms. Consent and leader approval may come
 * in either order (F07); both are needed before it is confirmed.
 */
export type OfferStage =
  | 'awaiting_both'
  | 'awaiting_candidate'
  | 'awaiting_leader'
  | 'confirmed'
  | Exclude<ReplacementOfferStatus, 'pending' | 'accepted_awaiting_approval' | 'finalized'>;

export const offerStage = (offer: Pick<ReplacementOfferRow, 'status' | 'leader_approved_at'>): OfferStage => {
  if (offer.status === 'pending') return offer.leader_approved_at ? 'awaiting_candidate' : 'awaiting_both';
  if (offer.status === 'accepted_awaiting_approval') return 'awaiting_leader';
  if (offer.status === 'finalized') return 'confirmed';
  return offer.status;
};

export const offerStageAccent = (stage: OfferStage): ServiceCenterAccentName => {
  if (stage === 'confirmed') return 'green';
  if (stage === 'awaiting_both' || stage === 'awaiting_candidate' || stage === 'awaiting_leader') return 'yellow';
  if (stage === 'rejected' || stage === 'declined') return 'red';
  return 'neutral';
};

export const requestAccent = (status: ReplacementRequestStatus): ServiceCenterAccentName => {
  if (status === 'filled') return 'green';
  if (status === 'open') return 'blue';
  return 'neutral';
};

/** The caller's own offer on this request, if they were asked. */
export const myOffer = (
  request: Pick<ReplacementRequestDetail, 'offers'>,
  personId: string | null,
): ReplacementOfferRow | null =>
  personId ? request.offers.find((offer) => offer.candidate_person_id === personId) ?? null : null;

/** Only the asked candidate answers, and only while the offer is pending. */
export const canAnswerOffer = (offer: ReplacementOfferRow | null, personId: string | null): offer is ReplacementOfferRow =>
  Boolean(offer && personId && offer.candidate_person_id === personId && offer.status === 'pending');

/** A leader may approve until both sides are in; approving twice is not offered. */
export const canApproveOffer = (offer: ReplacementOfferRow, request: Pick<ReplacementRequestDetail, 'status'>, mayLead: boolean): boolean =>
  mayLead && request.status === 'open' && offerIsLive(offer) && !offer.leader_approved_at;

export const canRejectOffer = (offer: ReplacementOfferRow, request: Pick<ReplacementRequestDetail, 'status'>, mayLead: boolean): boolean =>
  mayLead && request.status === 'open' && offerIsLive(offer);

/** The requester or a scheduler of the team may cancel an open request. */
export const canCancelRequest = (
  request: Pick<ReplacementRequestDetail, 'status' | 'requester_person_id'>,
  personId: string | null,
  mayLead: boolean,
): boolean => request.status === 'open' && (mayLead || (personId !== null && request.requester_person_id === personId));

/** The request that describes this declined assignment now: the open or filled one, else the latest. */
export const requestForAssignment = (
  requests: readonly ReplacementRequestDetail[],
  assignmentId: string,
): ReplacementRequestDetail | null => {
  const mine = requests.filter((request) => request.original_assignment_id === assignmentId);
  return mine.find((request) => request.status === 'open')
    ?? mine.find((request) => request.status === 'filled')
    ?? [...mine].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
    ?? null;
};

/** A declined position may ask for help unless a request is already open or the place was filled. */
export const canRequestReplacement = (
  assignment: { status: string; positionId: string | null },
  current: Pick<ReplacementRequestDetail, 'status'> | null,
): boolean =>
  assignment.status === 'declined'
  && assignment.positionId !== null
  && current?.status !== 'open'
  && current?.status !== 'filled';

/** Where a request appears on the Replacements list for this person. */
export type ReplacementSection = 'forYou' | 'toReview' | 'yours' | 'past';

export const replacementSection = (
  request: ReplacementRequestDetail,
  personId: string | null,
  mayLead: boolean,
): ReplacementSection => {
  const offer = myOffer(request, personId);
  if (offer && canAnswerOffer(offer, personId) && request.status === 'open') return 'forYou';
  if (request.status === 'open' && mayLead) return 'toReview';
  if (request.status === 'open' && personId && request.requester_person_id === personId) return 'yours';
  if (offer && offer.status === 'accepted_awaiting_approval' && request.status === 'open') return 'forYou';
  return 'past';
};

/**
 * People a leader may offer this place to: members of the request's team who
 * can serve the position (any position, or this one), have a login, and are
 * not the requester or already asked. The server rechecks eligibility records,
 * conflicts and capacity when the offer is sent and when it is accepted.
 */
export interface ReplacementCandidate {
  personId: string;
  name: string | null;
}

export const replacementCandidates = (
  request: Pick<ReplacementRequestDetail, 'team_id' | 'position_id' | 'requester_person_id' | 'offers'>,
  teams: readonly TeamWithPositions[],
): ReplacementCandidate[] => {
  const team = teams.find((item) => item.id === request.team_id);
  if (!team) return [];
  const asked = new Set(request.offers.map((offer) => offer.candidate_person_id));
  const seen = new Set<string>();
  const candidates: ReplacementCandidate[] = [];
  for (const member of team.members) {
    if (!member.user_id || seen.has(member.person_id)) continue;
    if (member.person_id === request.requester_person_id || asked.has(member.person_id)) continue;
    if (member.position_id !== null && member.position_id !== request.position_id) continue;
    seen.add(member.person_id);
    candidates.push({ personId: member.person_id, name: member.profile?.full_name ?? null });
  }
  return candidates.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
};

/** One reviewed request: the assignment revision the person saw and a stable key. */
export interface RequestAttempt {
  assignmentId: string;
  idempotencyKey: string;
  reviewedRevision: number;
  expiresAt: string;
}

/** Who the attempt belongs to; keys are never shared across accounts or organizations. */
export interface RequestAttemptOwner {
  userId: string;
  organizationId: string;
}

/**
 * Keeps one idempotency key per (account, organization, declined assignment)
 * until the server shows a request. A retry after a lost response reuses the
 * key (and its expiry), so the server returns the request it already opened.
 */
export class RequestAttempts {
  private readonly attempts = new Map<string, RequestAttempt>();

  constructor(private readonly makeKey: () => string) {}

  private id(owner: RequestAttemptOwner, assignmentId: string): string {
    return `${owner.userId}:${owner.organizationId}:${assignmentId}`;
  }

  review(owner: RequestAttemptOwner, assignment: { id: string; requestRevision: number }, expiresAt: string): RequestAttempt {
    const id = this.id(owner, assignment.id);
    const existing = this.attempts.get(id);
    const attempt: RequestAttempt = {
      assignmentId: assignment.id,
      idempotencyKey: existing?.idempotencyKey ?? this.makeKey(),
      reviewedRevision: assignment.requestRevision,
      // A retry must send the same body; a fresh review may move the expiry.
      expiresAt: existing && existing.reviewedRevision === assignment.requestRevision ? existing.expiresAt : expiresAt,
    };
    this.attempts.set(id, attempt);
    return attempt;
  }

  get(owner: RequestAttemptOwner, assignmentId: string): RequestAttempt | null {
    return this.attempts.get(this.id(owner, assignmentId)) ?? null;
  }

  settle(owner: RequestAttemptOwner, assignmentId: string): void {
    this.attempts.delete(this.id(owner, assignmentId));
  }
}

export const requestBody = (attempt: RequestAttempt): CreateReplacementRequestInput =>
  createReplacementRequestSchema.parse({
    assignment_id: attempt.assignmentId,
    expected_revision: attempt.reviewedRevision,
    idempotency_key: attempt.idempotencyKey,
    expires_at: attempt.expiresAt,
  });

export const offerActionBody = (offer: Pick<ReplacementOfferRow, 'version'>, action: OfferAction): ActOnReplacementOfferInput =>
  actOnReplacementOfferSchema.parse({ expected_version: offer.version, action });

/** Why a replacement action did not go through, as the person needs to hear it. */
export type ReplacementFailure = 'full' | 'changed' | 'not_allowed' | 'not_found' | 'uncertain' | 'failed';

/** Maps the F07 API errors (see `fromPostgrestError`) to an outcome. */
export const classifyReplacementError = (error: unknown): ReplacementFailure => {
  if (!(error instanceof ApiError)) return 'uncertain';
  if (error.status === 409) {
    if (error.code === 'capacity_full') return 'full';
    // Stale version, expired, superseded, no longer eligible, or (23505) a
    // request already open for this assignment: read it again and show that.
    return 'changed';
  }
  if (error.status === 403) return 'not_allowed';
  if (error.status === 404) return 'not_found';
  if (error.status === 0 || error.status >= 500) return 'uncertain';
  return 'failed';
};

/** Everything except a plain validation failure needs a fresh read before anything else is shown. */
export const failureNeedsRefetch = (failure: ReplacementFailure): boolean => failure !== 'failed';

/**
 * Offer actions carry no idempotency key: a replay after a lost response is
 * refused as stale (409). Once the server state shows the action took effect,
 * that refusal is not a failure.
 */
export const offerActionLanded = (action: OfferAction, offer: Pick<ReplacementOfferRow, 'status' | 'consented_at' | 'leader_approved_at'>): boolean => {
  switch (action) {
    case 'accept': return offer.consented_at !== null;
    case 'decline': return offer.status === 'declined';
    case 'approve': return offer.leader_approved_at !== null;
    case 'reject': return offer.status === 'rejected';
  }
};

/**
 * The conflict check (F04) for offering this request's exact scope to each
 * candidate. The original decline is excluded, as it is at consent time.
 */
export const candidateConflictRequest = (
  request: Pick<ReplacementRequestDetail, 'plan_id' | 'team_id' | 'position_id' | 'applicable_time_ids' | 'original_assignment_id'>,
  candidates: readonly ReplacementCandidate[],
): CheckAssignmentConflictsRequest => ({
  candidates: candidates.map((candidate) => ({
    key: candidate.personId,
    person_id: candidate.personId,
    plan_id: request.plan_id,
    team_id: request.team_id,
    position_id: request.position_id,
    attendance_mode: request.applicable_time_ids.length === 0 ? 'all' : 'selected',
    time_ids: request.applicable_time_ids,
  })),
  exclude_assignment_ids: [request.original_assignment_id],
});

/**
 * Why a candidate could not agree right now (they would be refused at consent):
 * a blockout wins over another commitment. Warnings are not reasons.
 */
export const unavailableCandidates = (conflicts: readonly AttendanceConflict[]): Map<string, ConflictKind> => {
  const reasons = new Map<string, ConflictKind>();
  for (const conflict of conflicts) {
    if (conflict.severity !== 'blocking') continue;
    if (reasons.get(conflict.person_id) !== 'blockout') reasons.set(conflict.person_id, conflict.kind);
  }
  return reasons;
};
