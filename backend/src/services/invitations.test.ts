import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key-that-is-long-enough';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-that-is-long-enough';
  process.env.APP_URL = 'http://localhost:5173';
});

import { generateInviteToken, hashInviteToken, inviteAcceptUrl } from './invitations.js';

describe('generateInviteToken', () => {
  it('produces a token whose hash matches hashInviteToken', () => {
    const { token, tokenHash } = generateInviteToken();
    expect(hashInviteToken(token)).toBe(tokenHash);
  });

  it('never generates the same token twice', () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a.token).not.toBe(b.token);
  });

  it('expires seven days out', () => {
    const before = Date.now();
    const { expiresAt } = generateInviteToken();
    const days = (expiresAt.getTime() - before) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);
  });
});

describe('inviteAcceptUrl', () => {
  it('embeds the token as a query param on the accept-invite route', () => {
    expect(inviteAcceptUrl('abc123')).toBe('http://localhost:5173/accept-invite?token=abc123');
  });
});
