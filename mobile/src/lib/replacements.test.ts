import { describe, expect, it } from 'vitest';
import { ApiError, type AttendanceConflict, type ReplacementOfferRow, type ReplacementRequestDetail, type TeamWithPositions } from '@service-center/shared';
import {
  RequestAttempts,
  candidateConflictRequest,
  canAnswerOffer,
  canApproveOffer,
  canCancelRequest,
  canRejectOffer,
  canRequestReplacement,
  classifyReplacementError,
  failureNeedsRefetch,
  myOffer,
  offerActionBody,
  offerActionLanded,
  offerStage,
  replacementCandidates,
  replacementSection,
  requestBody,
  requestForAssignment,
  unavailableCandidates,
} from './replacements';

const SAM = '00000000-0000-4000-8000-0000000000a1';
const RILEY = '00000000-0000-4000-8000-0000000000a2';
const MORGAN = '00000000-0000-4000-8000-0000000000a3';
const TEAM = '00000000-0000-4000-8000-0000000000b1';
const POSITION = '00000000-0000-4000-8000-0000000000c1';
const OTHER_POSITION = '00000000-0000-4000-8000-0000000000c2';
const ASSIGNMENT = '00000000-0000-4000-8000-0000000000d1';

const offer = (over: Partial<ReplacementOfferRow> = {}): ReplacementOfferRow => ({
  id: 'offer-1',
  request_id: 'request-1',
  candidate_person_id: RILEY,
  status: 'pending',
  request_version: 1,
  idempotency_key: 'offer-key-1',
  consented_at: null,
  leader_approved_at: null,
  leader_approved_by: null,
  reservation_expires_at: null,
  assignment_id: null,
  version: 1,
  created_by: null,
  created_at: '2026-10-20T10:00:00.000Z',
  updated_at: '2026-10-20T10:00:00.000Z',
  ...over,
});

const request = (over: Partial<ReplacementRequestDetail> = {}): ReplacementRequestDetail => ({
  id: 'request-1',
  organization_id: 'org',
  original_assignment_id: ASSIGNMENT,
  requester_person_id: SAM,
  plan_id: 'plan',
  team_id: TEAM,
  position_id: POSITION,
  applicable_time_ids: [],
  status: 'open',
  expires_at: '2026-10-27T10:00:00.000Z',
  version: 1,
  idempotency_key: 'request-key-1',
  filled_assignment_id: null,
  created_by: null,
  created_at: '2026-10-20T10:00:00.000Z',
  updated_at: '2026-10-20T10:00:00.000Z',
  offers: [],
  ...over,
});

describe('offerStage', () => {
  it('tells consent-first and approval-first apart before finalization', () => {
    expect(offerStage(offer())).toBe('awaiting_both');
    expect(offerStage(offer({ leader_approved_at: '2026-10-20T11:00:00.000Z' }))).toBe('awaiting_candidate');
    expect(offerStage(offer({ status: 'accepted_awaiting_approval', consented_at: '2026-10-20T11:00:00.000Z' }))).toBe('awaiting_leader');
    expect(offerStage(offer({ status: 'finalized' }))).toBe('confirmed');
    expect(offerStage(offer({ status: 'superseded' }))).toBe('superseded');
  });
});

describe('who may act', () => {
  it('lets only the asked candidate answer a pending offer', () => {
    expect(canAnswerOffer(offer(), RILEY)).toBe(true);
    expect(canAnswerOffer(offer(), MORGAN)).toBe(false);
    expect(canAnswerOffer(offer({ status: 'accepted_awaiting_approval' }), RILEY)).toBe(false);
    expect(canAnswerOffer(null, RILEY)).toBe(false);
  });

  it('offers approval once, and nothing on an ended offer or closed request', () => {
    expect(canApproveOffer(offer(), request(), true)).toBe(true);
    expect(canApproveOffer(offer({ leader_approved_at: 'x' }), request(), true)).toBe(false);
    expect(canRejectOffer(offer({ leader_approved_at: 'x' }), request(), true)).toBe(true);
    expect(canApproveOffer(offer({ status: 'expired' }), request(), true)).toBe(false);
    expect(canRejectOffer(offer(), request({ status: 'filled' }), true)).toBe(false);
    expect(canApproveOffer(offer(), request(), false)).toBe(false);
  });

  it('lets the requester or a leader cancel only an open request', () => {
    expect(canCancelRequest(request(), SAM, false)).toBe(true);
    expect(canCancelRequest(request(), RILEY, false)).toBe(false);
    expect(canCancelRequest(request(), RILEY, true)).toBe(true);
    expect(canCancelRequest(request({ status: 'cancelled' }), SAM, false)).toBe(false);
  });
});

describe('requesting', () => {
  it('describes a declined assignment by its open or filled request first', () => {
    const cancelled = request({ id: 'old', status: 'cancelled', created_at: '2026-10-21T00:00:00.000Z' });
    const open = request({ id: 'open', created_at: '2026-10-20T00:00:00.000Z' });
    expect(requestForAssignment([cancelled, open], ASSIGNMENT)?.id).toBe('open');
    expect(requestForAssignment([cancelled], ASSIGNMENT)?.id).toBe('old');
    expect(requestForAssignment([cancelled], 'other')).toBeNull();
  });

  it('offers a new request only for a declined position with nothing open or filled', () => {
    expect(canRequestReplacement({ status: 'declined', positionId: POSITION }, null)).toBe(true);
    expect(canRequestReplacement({ status: 'declined', positionId: POSITION }, request({ status: 'cancelled' }))).toBe(true);
    expect(canRequestReplacement({ status: 'declined', positionId: POSITION }, request())).toBe(false);
    expect(canRequestReplacement({ status: 'declined', positionId: POSITION }, request({ status: 'filled' }))).toBe(false);
    expect(canRequestReplacement({ status: 'declined', positionId: null }, null)).toBe(false);
    expect(canRequestReplacement({ status: 'confirmed', positionId: POSITION }, null)).toBe(false);
  });

  it('reuses one key and body for retries, isolated per account and organization', () => {
    let next = 0;
    const attempts = new RequestAttempts(() => `request-key-${++next}`);
    const owner = { userId: 'u1', organizationId: 'o1' };
    const first = attempts.review(owner, { id: ASSIGNMENT, requestRevision: 2 }, '2026-10-27T10:00:00.000Z');
    const retry = attempts.review(owner, { id: ASSIGNMENT, requestRevision: 2 }, '2026-10-27T10:05:00.000Z');
    expect(retry).toEqual(first);
    expect(requestBody(retry)).toEqual({
      assignment_id: ASSIGNMENT, expected_revision: 2, idempotency_key: 'request-key-1', expires_at: '2026-10-27T10:00:00.000Z',
    });
    // A changed assignment is a fresh review: same key, new revision and expiry.
    const fresh = attempts.review(owner, { id: ASSIGNMENT, requestRevision: 3 }, '2026-10-28T00:00:00.000Z');
    expect(fresh).toMatchObject({ idempotencyKey: 'request-key-1', reviewedRevision: 3, expiresAt: '2026-10-28T00:00:00.000Z' });
    expect(attempts.review({ userId: 'u2', organizationId: 'o1' }, { id: ASSIGNMENT, requestRevision: 3 }, 'x').idempotencyKey).toBe('request-key-2');
    expect(attempts.review({ userId: 'u1', organizationId: 'o2' }, { id: ASSIGNMENT, requestRevision: 3 }, 'x').idempotencyKey).toBe('request-key-3');
    attempts.settle(owner, ASSIGNMENT);
    expect(attempts.get(owner, ASSIGNMENT)).toBeNull();
  });
});

describe('candidates', () => {
  const team: TeamWithPositions = {
    id: TEAM,
    members: [
      { person_id: SAM, user_id: 'p-sam', position_id: POSITION, profile: null },
      { person_id: RILEY, user_id: 'p-riley', position_id: POSITION, profile: { full_name: 'Riley' } },
      { person_id: MORGAN, user_id: 'p-morgan', position_id: null, profile: { full_name: 'Morgan' } },
      { person_id: 'no-login', user_id: null, position_id: null, profile: null },
      { person_id: 'drummer', user_id: 'p-drum', position_id: OTHER_POSITION, profile: { full_name: 'Drew' } },
    ],
  } as unknown as TeamWithPositions;

  it('lists logged-in team members who can serve the position, except the requester and anyone asked', () => {
    expect(replacementCandidates(request(), [team]).map((item) => item.personId)).toEqual([MORGAN, RILEY]);
    expect(replacementCandidates(request({ offers: [offer()] }), [team]).map((item) => item.personId)).toEqual([MORGAN]);
    expect(replacementCandidates(request({ team_id: 'other' }), [team])).toEqual([]);
  });
});

describe('sections', () => {
  it('puts an offer awaiting the person first, then leader work, then their own requests', () => {
    expect(replacementSection(request({ offers: [offer()] }), RILEY, false)).toBe('forYou');
    expect(replacementSection(request({ offers: [offer({ status: 'accepted_awaiting_approval' })] }), RILEY, false)).toBe('forYou');
    expect(replacementSection(request(), SAM, true)).toBe('toReview');
    expect(replacementSection(request(), SAM, false)).toBe('yours');
    expect(replacementSection(request({ status: 'filled' }), SAM, false)).toBe('past');
    expect(replacementSection(request({ offers: [offer({ status: 'declined' })] }), RILEY, false)).toBe('past');
    expect(myOffer(request({ offers: [offer()] }), MORGAN)).toBeNull();
  });
});

describe('errors and replays', () => {
  it('classifies the F07 API errors', () => {
    expect(classifyReplacementError(new ApiError(409, 'full', 'capacity_full'))).toBe('full');
    expect(classifyReplacementError(new ApiError(409, 'That change is no longer allowed', 'conflict'))).toBe('changed');
    expect(classifyReplacementError(new ApiError(403, 'no', 'forbidden'))).toBe('not_allowed');
    expect(classifyReplacementError(new ApiError(404, 'gone', 'not_found'))).toBe('not_found');
    expect(classifyReplacementError(new ApiError(0, 'offline'))).toBe('uncertain');
    expect(classifyReplacementError(new TypeError('Network request failed'))).toBe('uncertain');
    expect(classifyReplacementError(new ApiError(422, 'bad', 'validation'))).toBe('failed');
    expect(failureNeedsRefetch('failed')).toBe(false);
    expect(failureNeedsRefetch('uncertain')).toBe(true);
  });

  it('treats a refused replay as landed once the server shows its effect', () => {
    expect(offerActionLanded('accept', offer({ status: 'accepted_awaiting_approval', consented_at: 'x' }))).toBe(true);
    expect(offerActionLanded('accept', offer({ status: 'finalized', consented_at: 'x' }))).toBe(true);
    expect(offerActionLanded('accept', offer({ status: 'superseded' }))).toBe(false);
    expect(offerActionLanded('approve', offer({ leader_approved_at: 'x' }))).toBe(true);
    expect(offerActionLanded('decline', offer({ status: 'declined' }))).toBe(true);
    expect(offerActionLanded('reject', offer({ status: 'expired' }))).toBe(false);
  });

  it('sends the version the person saw', () => {
    expect(offerActionBody(offer({ version: 3 }), 'accept')).toEqual({ expected_version: 3, action: 'accept' });
  });
});

describe('candidate availability', () => {
  it('checks each candidate for exactly the request\'s times, excluding the original decline', () => {
    const body = candidateConflictRequest(request({ applicable_time_ids: ['t1'] }), [{ personId: RILEY, name: 'Riley' }]);
    expect(body).toEqual({
      candidates: [{ key: RILEY, person_id: RILEY, plan_id: 'plan', team_id: TEAM, position_id: POSITION, attendance_mode: 'selected', time_ids: ['t1'] }],
      exclude_assignment_ids: [ASSIGNMENT],
    });
    expect(candidateConflictRequest(request(), [{ personId: RILEY, name: null }]).candidates[0]!.attendance_mode).toBe('all');
  });

  it('marks blocking conflicts only, preferring blockout as the reason', () => {
    const conflict = (person_id: string, kind: AttendanceConflict['kind'], severity: AttendanceConflict['severity']) =>
      ({ person_id, kind, severity }) as AttendanceConflict;
    const reasons = unavailableCandidates([
      conflict(RILEY, 'overlapping_commitment', 'blocking'),
      conflict(RILEY, 'blockout', 'blocking'),
      conflict(MORGAN, 'overlapping_commitment', 'warning'),
    ]);
    expect(reasons.get(RILEY)).toBe('blockout');
    expect(reasons.has(MORGAN)).toBe(false);
  });
});
