import { describe, expect, it } from 'vitest';
import { ApiError } from '@service-center/shared';
import {
  buildResponseRequest,
  describeResponseFailure,
  draftFor,
  isWithdrawal,
  reasonTooLong,
  responseDraftsReducer,
  type ResponseDrafts,
} from './assignment-response-drafts';

const run = (...actions: Parameters<typeof responseDraftsReducer>[1][]): ResponseDrafts =>
  actions.reduce(responseDraftsReducer, {});

describe('responseDraftsReducer', () => {
  it('keeps the reason and exact request after a failure so a retry resends the same scope', () => {
    const request = buildResponseRequest('confirmed', 'declined', 'Travelling');
    const drafts = run(
      { type: 'open', assignmentId: 'a1', mode: 'withdrawing' },
      { type: 'reason', assignmentId: 'a1', reason: 'Travelling' },
      { type: 'submit', assignmentId: 'a1', request },
      { type: 'failed', assignmentId: 'a1', error: { kind: 'network', message: 'offline' } },
    );

    expect(draftFor(drafts, 'a1')).toEqual({
      mode: 'withdrawing',
      reason: 'Travelling',
      request,
      pending: false,
      error: { kind: 'network', message: 'offline' },
    });
  });

  it('tracks each assignment on its own', () => {
    const drafts = run(
      { type: 'submit', assignmentId: 'a1', request: buildResponseRequest('unconfirmed', 'confirmed', '') },
      { type: 'submit', assignmentId: 'a2', request: buildResponseRequest('unconfirmed', 'confirmed', '') },
      { type: 'succeeded', assignmentId: 'a1' },
      { type: 'failed', assignmentId: 'a2', error: { kind: 'network', message: 'offline' } },
    );
    expect(draftFor(drafts, 'a1').error).toBeNull();
    expect(draftFor(drafts, 'a1').pending).toBe(false);
    expect(draftFor(drafts, 'a2').error?.kind).toBe('network');
  });

  it('ignores a duplicate submit and edits while a request is in flight', () => {
    const first = buildResponseRequest('unconfirmed', 'declined', 'Sick');
    const drafts = run(
      { type: 'reason', assignmentId: 'a1', reason: 'Sick' },
      { type: 'submit', assignmentId: 'a1', request: first },
      { type: 'submit', assignmentId: 'a1', request: buildResponseRequest('unconfirmed', 'confirmed', '') },
      { type: 'reason', assignmentId: 'a1', reason: 'changed' },
      { type: 'cancel', assignmentId: 'a1' },
    );
    expect(draftFor(drafts, 'a1')).toMatchObject({ pending: true, reason: 'Sick', request: first });
  });

  it('clears everything for a new account or organization', () => {
    const drafts = run(
      { type: 'reason', assignmentId: 'a1', reason: 'private' },
      { type: 'reset' },
    );
    expect(drafts).toEqual({});
  });
});

describe('buildResponseRequest', () => {
  it('always sends the status the person saw', () => {
    expect(buildResponseRequest('unconfirmed', 'confirmed', 'ignored')).toEqual({
      status: 'confirmed',
      expected_status: 'unconfirmed',
    });
  });

  it('sends a trimmed reason only with a decline', () => {
    expect(buildResponseRequest('confirmed', 'declined', '  Away  ')).toEqual({
      status: 'declined',
      expected_status: 'confirmed',
      reason: 'Away',
    });
    expect(buildResponseRequest('unconfirmed', 'declined', '   ')).toEqual({
      status: 'declined',
      expected_status: 'unconfirmed',
    });
  });
});

describe('response rules', () => {
  it('flags declining a confirmation as a withdrawal', () => {
    expect(isWithdrawal('confirmed', 'declined')).toBe(true);
    expect(isWithdrawal('unconfirmed', 'declined')).toBe(false);
  });

  it('checks the reason length before sending', () => {
    expect(reasonTooLong('x'.repeat(500))).toBe(false);
    expect(reasonTooLong('x'.repeat(501))).toBe(true);
  });

  it('distinguishes stale, forbidden and network failures', () => {
    expect(describeResponseFailure(new ApiError(409, 'changed', 'assignment_response_stale')).kind).toBe('stale');
    expect(describeResponseFailure(new ApiError(409, 'Ask a scheduler', 'assignment_response_forbidden'))).toEqual({
      kind: 'forbidden',
      message: 'Ask a scheduler',
    });
    expect(describeResponseFailure(new TypeError('Network request failed')).kind).toBe('network');
  });
});
