import { beforeEach, describe, expect, it, vi } from 'vitest';

/** W8-RT-D2: leaving a church you never entered (or already left) is a 404, not a silent success. */

const fixture = vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key-that-is-long-enough';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-that-is-long-enough';
  return { removed: true };
});

vi.mock('../lib/supabase.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/supabase.js')>();
  return { ...actual, adminDb: { rpc: async () => ({ data: fixture.removed, error: null }) } };
});

describe('revokePlatformAccess', () => {
  beforeEach(() => {
    fixture.removed = true;
  });

  it('succeeds when an access window was removed', async () => {
    const { revokePlatformAccess } = await import('./platform-admin.js');
    await expect(revokePlatformAccess({ userId: 'admin-1' }, 'org-1')).resolves.toBeUndefined();
  });

  it('answers 404 when there was no access window', async () => {
    fixture.removed = false;
    const { revokePlatformAccess } = await import('./platform-admin.js');
    await expect(revokePlatformAccess({ userId: 'admin-1' }, 'org-1')).rejects.toMatchObject({ status: 404 });
  });
});
