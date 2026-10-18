import { describe, expect, it } from 'vitest';
import { deliveryLinkToken, generateAssignmentToken } from './assignment-tokens.js';
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

describe('deliveryLinkToken', () => {
  const secret = 'f08-test-secret-0123456789abcdef0123456789';

  it('repeats the token for retries of the same delivery and plan', () => {
    const first = deliveryLinkToken('delivery-1', 'plan-a', '2026-09-06T14:00:00Z', secret);
    const retry = deliveryLinkToken('delivery-1', 'plan-a', '2026-09-06T14:00:00Z', secret);
    expect(first.deterministic).toBe(true);
    expect(retry.token).toBe(first.token);
    expect(hashInviteToken(first.token)).toBe(first.tokenHash);
  });

  it('differs per plan, per delivery and per secret', () => {
    const base = deliveryLinkToken('delivery-1', 'plan-a', '2026-09-06T14:00:00Z', secret).token;
    expect(deliveryLinkToken('delivery-1', 'plan-b', '2026-09-06T14:00:00Z', secret).token).not.toBe(base);
    expect(deliveryLinkToken('delivery-2', 'plan-a', '2026-09-06T14:00:00Z', secret).token).not.toBe(base);
    expect(deliveryLinkToken('delivery-1', 'plan-a', '2026-09-06T14:00:00Z', `${secret}x`).token).not.toBe(base);
  });

  it('falls back to a random token without a secret', () => {
    const a = deliveryLinkToken('delivery-1', 'plan-a', '2026-09-06T14:00:00Z', undefined);
    const b = deliveryLinkToken('delivery-1', 'plan-a', '2026-09-06T14:00:00Z', undefined);
    expect(a.deterministic).toBe(false);
    expect(a.token).not.toBe(b.token);
  });
});
