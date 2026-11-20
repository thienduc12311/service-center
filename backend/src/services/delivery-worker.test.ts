import { afterEach, expect, it, vi } from 'vitest';

interface ClaimCall {
  release: () => void;
}

const fixture = vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key-that-is-long-enough';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-that-is-long-enough';
  return { claims: [] as ClaimCall[], waitUntil: vi.fn<(promise: Promise<unknown>) => void>() };
});

vi.mock('@vercel/functions', () => ({ waitUntil: fixture.waitUntil }));
vi.mock('../lib/supabase.js', () => ({
  adminDb: {
    // A slow claim stands in for slow provider work: it settles only when the test says so.
    rpc: () => new Promise<{ data: unknown[]; error: null }>((resolve) => {
      fixture.claims.push({ release: () => resolve({ data: [], error: null }) });
    }),
  },
  unwrap: async (response: Promise<{ data: unknown }>) => (await response).data,
}));
vi.mock('./platform-admin.js', () => ({ purgeExpiredPlatformAccess: async () => undefined }));

import { deliverEffectInBackground } from './delivery-worker.js';

afterEach(() => {
  fixture.claims.length = 0;
  fixture.waitUntil.mockReset();
});

it('starts delivery and hands it to waitUntil without waiting for it', async () => {
  deliverEffectInBackground('effect-1');

  expect(fixture.waitUntil).toHaveBeenCalledTimes(1);
  const pending = fixture.waitUntil.mock.calls[0]?.[0];
  let settled = false;
  void pending?.then(() => { settled = true; });
  await vi.waitFor(() => expect(fixture.claims).toHaveLength(1));
  expect(settled).toBe(false);

  fixture.claims[0]?.release();
  await expect(pending).resolves.toBeUndefined();
});

it('does nothing when the action produced no deliveries', () => {
  deliverEffectInBackground(null);
  expect(fixture.waitUntil).not.toHaveBeenCalled();
  expect(fixture.claims).toHaveLength(0);
});
