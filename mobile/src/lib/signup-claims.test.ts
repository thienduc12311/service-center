import { describe, expect, it } from 'vitest';
import { ApiError, type OpportunityClaimDetail, type OpportunityClaimRow, type SignupOpportunity } from '@service-center/shared';
import {
  ClaimAttempts,
  canCancelClaim,
  canClaim,
  claimBody,
  claimEnded,
  classifyClaimError,
  failureNeedsRefetch,
  failureNeedsReview,
  openingStatus,
  pendingApprovals,
  reservationEndsAt,
} from './signup-claims';

const claim = (status: OpportunityClaimRow['status'], extra: Partial<OpportunityClaimRow> = {}): OpportunityClaimRow => ({
  id: 'claim-1',
  opportunity_id: 'op-1',
  person_id: 'p1',
  status,
  opportunity_version: 1,
  idempotency_key: 'key-00000001',
  reservation_expires_at: status === 'awaiting_approval' ? '2026-10-21T12:00:00.000Z' : null,
  assignment_id: status === 'confirmed' ? 'a1' : null,
  decided_by: null,
  decided_at: null,
  version: 1,
  created_at: '2026-10-20T12:00:00.000Z',
  updated_at: '2026-10-20T12:00:00.000Z',
  ...extra,
});

/** The JSON shape `list_signup_opportunities` returns to web and native alike. */
const opening = (extra: Partial<SignupOpportunity> = {}): SignupOpportunity => ({
  id: 'op-1',
  organization_id: 'org-1',
  plan_id: 'plan-1',
  team_id: 'band',
  position_id: 'keys',
  applicable_time_ids: [],
  capacity: 1,
  approval_policy: 'leader_approval',
  closes_at: '2026-10-25T12:00:00.000Z',
  reservation_minutes: 1_440,
  state: 'open',
  version: 3,
  created_by: null,
  created_at: '2026-10-19T12:00:00.000Z',
  updated_at: '2026-10-19T12:00:00.000Z',
  plan_title: 'Sunday',
  service_date: '2026-10-25',
  team_name: 'Band',
  position_name: 'Keys',
  remaining_capacity: 1,
  eligibility: 'eligible',
  times: [],
  my_claim: null,
  ...extra,
});

const owner = { userId: 'u1', organizationId: 'org-1' };

describe('openingStatus (website parity)', () => {
  it('shows the caller’s own claim before the opening’s eligibility', () => {
    // The last slot is the caller's own hold, so the server reports "full".
    expect(openingStatus(opening({ eligibility: 'full', my_claim: claim('awaiting_approval') })))
      .toEqual({ kind: 'claim', status: 'awaiting_approval' });
    expect(openingStatus(opening({ eligibility: 'closed' }))).toEqual({ kind: 'eligibility', eligibility: 'closed' });
  });

  it('offers a claim only when eligible with no claim yet', () => {
    expect(canClaim(opening())).toBe(true);
    for (const eligibility of ['full', 'closed', 'unavailable'] as const) {
      expect(canClaim(opening({ eligibility }))).toBe(false);
    }
    // One claim per Person per opening: an ended claim cannot be retried.
    expect(canClaim(opening({ my_claim: claim('cancelled') }))).toBe(false);
  });

  it('lets a held or confirmed place be cancelled; ended claims are final', () => {
    expect(canCancelClaim(claim('awaiting_approval'))).toBe(true);
    expect(canCancelClaim(claim('confirmed'))).toBe(true);
    for (const status of ['cancelled', 'rejected', 'expired', 'superseded'] as const) {
      expect(canCancelClaim(claim(status))).toBe(false);
      expect(claimEnded(claim(status))).toBe(true);
    }
    expect(canCancelClaim(null)).toBe(false);
    expect(claimEnded(null)).toBe(false);
  });
});

describe('ClaimAttempts', () => {
  let counter = 0;
  const attempts = () => new ClaimAttempts(() => `generated-key-${++counter}`);

  it('reuses the same key for a retry so a lost response cannot claim twice', () => {
    const store = attempts();
    const first = store.review(owner, opening());
    expect(claimBody(first)).toEqual({ expected_version: 3, idempotency_key: first.idempotencyKey });
    expect(store.get(owner, 'op-1')).toEqual(first);
    expect(store.review(owner, opening()).idempotencyKey).toBe(first.idempotencyKey);
  });

  it('a fresh review after a stale version keeps the key and sends the new version', () => {
    const store = attempts();
    const first = store.review(owner, opening());
    const again = store.review(owner, opening({ version: 4 }));
    expect(again.idempotencyKey).toBe(first.idempotencyKey);
    expect(claimBody(again).expected_version).toBe(4);
  });

  it('never shares a key across accounts, organizations or openings, and settles once claimed', () => {
    const store = attempts();
    const mine = store.review(owner, opening());
    expect(store.review({ ...owner, userId: 'u2' }, opening()).idempotencyKey).not.toBe(mine.idempotencyKey);
    expect(store.review({ ...owner, organizationId: 'org-2' }, opening()).idempotencyKey).not.toBe(mine.idempotencyKey);
    expect(store.review(owner, opening({ id: 'op-2' })).idempotencyKey).not.toBe(mine.idempotencyKey);
    store.settle(owner, 'op-1');
    expect(store.get(owner, 'op-1')).toBeNull();
  });

  it('rejects a body the server would refuse', () => {
    expect(() => claimBody({ opportunityId: 'op-1', idempotencyKey: 'short', reviewedVersion: 3 })).toThrow();
  });
});

describe('classifyClaimError', () => {
  const conflict = (code: string) => new ApiError(409, 'x', code);

  it('maps the F07 PT409 hints to what happened', () => {
    expect(classifyClaimError(conflict('capacity_full'))).toBe('full');
    expect(classifyClaimError(conflict('opportunity_closed'))).toBe('closed');
    expect(classifyClaimError(conflict('opportunity_changed'))).toBe('stale');
    expect(classifyClaimError(conflict('scheduling_conflict'))).toBe('conflict');
    expect(classifyClaimError(conflict('conflict'))).toBe('already_claimed');
  });

  it('treats membership/eligibility loss and hidden openings as final', () => {
    expect(classifyClaimError(new ApiError(403, 'x', 'forbidden'))).toBe('not_eligible');
    expect(classifyClaimError(new ApiError(404, 'x', 'not_found'))).toBe('not_found');
    expect(classifyClaimError(new ApiError(400, 'x', 'bad_request'))).toBe('failed');
  });

  it('treats a lost response or server failure as unknown: re-read before retrying', () => {
    expect(classifyClaimError(new TypeError('Network request failed'))).toBe('uncertain');
    expect(classifyClaimError(new ApiError(502, 'x'))).toBe('uncertain');
    expect(failureNeedsRefetch('uncertain')).toBe(true);
    expect(failureNeedsRefetch('failed')).toBe(false);
    expect(failureNeedsReview('stale')).toBe(true);
    expect(failureNeedsReview('full')).toBe(false);
  });
});

describe('pendingApprovals (leader)', () => {
  const now = new Date('2026-10-20T12:00:00.000Z');
  const detail = (id: string, status: OpportunityClaimRow['status'], expires: string | null, opportunityId = 'op-1'): OpportunityClaimDetail => ({
    ...claim(status, { id, reservation_expires_at: expires }),
    person_name: id,
    opportunity: { id: opportunityId, plan_id: 'plan-1', team_id: 'band', position_id: 'keys', approval_policy: 'leader_approval' },
  });

  it('lists live holds on this opening only, soonest to lapse first', () => {
    const list = pendingApprovals([
      detail('later', 'awaiting_approval', '2026-10-21T12:00:00.000Z'),
      detail('sooner', 'awaiting_approval', '2026-10-20T13:00:00.000Z'),
      detail('lapsed', 'awaiting_approval', '2026-10-20T11:59:00.000Z'),
      detail('done', 'confirmed', null),
      detail('elsewhere', 'awaiting_approval', '2026-10-21T12:00:00.000Z', 'op-2'),
    ], 'op-1', now);
    expect(list.map((item) => item.id)).toEqual(['sooner', 'later']);
  });

  it('shows when a hold made now would end', () => {
    expect(reservationEndsAt({ reservation_minutes: 90 }, now).toISOString()).toBe('2026-10-20T13:30:00.000Z');
  });
});
