import { describe, expect, it } from 'vitest';
import { generateAssignmentToken } from './assignment-tokens.js';
import { hashInviteToken } from './invitations.js';

describe('generateAssignmentToken', () => {
  it('hashes the raw token and expires the day after the service date', () => {
    const result = generateAssignmentToken('2026-09-06T14:00:00Z');
    expect(hashInviteToken(result.token)).toBe(result.tokenHash);
    expect(result.expiresAt.toISOString()).toBe('2026-09-07T14:00:00.000Z');
  });

  it('generates unique tokens', () => {
    expect(generateAssignmentToken('2026-09-06T14:00:00Z').token).not.toBe(generateAssignmentToken('2026-09-06T14:00:00Z').token);
  });
});
