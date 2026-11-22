import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * W10-MAIL-D5: a worker run without INTEGRATION_SECRET_KEY must not claim
 * webhook deliveries (claiming then failing them as `secret_unavailable`
 * disabled their endpoints). It skips the step and says why.
 */

const fixture = vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
  process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';
  return { rpcCalls: [] as string[], keyAvailable: false };
});

vi.mock('../lib/supabase.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/supabase.js')>()),
  adminDb: {
    rpc: async (fn: string) => {
      fixture.rpcCalls.push(fn);
      return { data: fn === 'prune_webhook_history' ? 0 : [], error: null };
    },
  },
}));
vi.mock('../lib/secret-box.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/secret-box.js')>()),
  secretBoxAvailable: () => fixture.keyAvailable,
}));

const { runWebhookDeliveriesSafely } = await import('./webhook-dispatch.js');

describe('runWebhookDeliveriesSafely', () => {
  beforeEach(() => {
    fixture.rpcCalls = [];
  });

  it('skips without the signing key: nothing is claimed, the reason is logged', async () => {
    fixture.keyAvailable = false;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await runWebhookDeliveriesSafely()).toBeNull();
    expect(fixture.rpcCalls).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('INTEGRATION_SECRET_KEY is not configured'));
    warn.mockRestore();
  });

  it('claims due deliveries when the key is configured', async () => {
    fixture.keyAvailable = true;
    const result = await runWebhookDeliveriesSafely();
    expect(result).toMatchObject({ claimed: 0, failed: 0 });
    expect(fixture.rpcCalls).toEqual(['claim_webhook_deliveries', 'prune_webhook_history']);
  });
});
