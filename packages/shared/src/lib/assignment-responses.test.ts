import { describe, expect, it } from 'vitest';
import { allowedSelfResponses, selfResponseTransition } from './assignment-responses.js';
import { respondToAssignmentSchema } from '../schemas/assignment.js';

describe('selfResponseTransition', () => {
  it('lets an unconfirmed request be accepted or declined', () => {
    expect(selfResponseTransition('unconfirmed', 'confirmed')).toBe('answer');
    expect(selfResponseTransition('unconfirmed', 'declined')).toBe('answer');
  });

  it('treats declining a confirmation as a withdrawal', () => {
    expect(selfResponseTransition('confirmed', 'declined')).toBe('withdrawal');
  });

  it('never re-accepts a declined assignment', () => {
    expect(selfResponseTransition('declined', 'confirmed')).toBe('forbidden');
    expect(allowedSelfResponses('declined')).toEqual([]);
  });

  it('treats a repeated answer as unchanged so retries are safe', () => {
    expect(selfResponseTransition('confirmed', 'confirmed')).toBe('unchanged');
    expect(selfResponseTransition('declined', 'declined')).toBe('unchanged');
  });

  it('offers only withdrawal from a confirmation', () => {
    expect(allowedSelfResponses('confirmed')).toEqual(['declined']);
    expect(allowedSelfResponses('unconfirmed')).toEqual(['confirmed', 'declined']);
  });
});

describe('respondToAssignmentSchema', () => {
  it('stores a blank reason as none', () => {
    expect(respondToAssignmentSchema.parse({ status: 'declined', reason: '   ' }).reason).toBeNull();
  });

  it('rejects a reason on an acceptance', () => {
    expect(respondToAssignmentSchema.safeParse({ status: 'confirmed', reason: 'Happy to' }).success).toBe(false);
  });

  it('bounds the reason length', () => {
    expect(respondToAssignmentSchema.safeParse({ status: 'declined', reason: 'x'.repeat(501) }).success).toBe(false);
    expect(respondToAssignmentSchema.safeParse({ status: 'declined', reason: 'x'.repeat(500) }).success).toBe(true);
  });
});
