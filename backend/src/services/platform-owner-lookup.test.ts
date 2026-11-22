import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A super admin creating a church names its owner by email. An existing
 * account is reused only when that is its confirmed login email
 * (`confirmed_user_id_by_email`); `profiles.email` is never consulted.
 */

interface Fixture {
  confirmedUserId: string | null;
  lookups: string[];
  invites: string[];
  profileReads: number;
}

const fixture = vi.hoisted((): Fixture => {
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key-that-is-long-enough';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-that-is-long-enough';
  return { confirmedUserId: null, lookups: [], invites: [], profileReads: 0 };
});

vi.mock('../lib/supabase.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/supabase.js')>();
  const rpc = (fn: string, args: { p_email: string }) => {
    if (fn !== 'confirmed_user_id_by_email') throw new Error(`unexpected rpc ${fn}`);
    fixture.lookups.push(args.p_email);
    return Promise.resolve({ data: fixture.confirmedUserId, error: null });
  };
  const from = (table: string) => {
    fixture.profileReads += 1;
    throw new Error(`unexpected table ${table}`);
  };
  const inviteUserByEmail = (email: string) => {
    fixture.invites.push(email);
    return Promise.resolve({ data: { user: { id: 'invited-user' } }, error: null });
  };
  return { ...actual, adminDb: { rpc, from, auth: { admin: { inviteUserByEmail } } } };
});

describe('findOrInviteOwner', () => {
  beforeEach(() => {
    fixture.confirmedUserId = null;
    fixture.lookups = [];
    fixture.invites = [];
    fixture.profileReads = 0;
  });

  it('reuses the login whose confirmed email matches', async () => {
    fixture.confirmedUserId = 'existing-owner';
    const { findOrInviteOwner } = await import('./platform-admin.js');
    await expect(findOrInviteOwner('Pastor@Example.test')).resolves.toBe('existing-owner');
    expect(fixture.lookups).toEqual(['Pastor@Example.test']);
    expect(fixture.invites).toEqual([]);
    expect(fixture.profileReads).toBe(0);
  });

  it('invites the address when no confirmed login has it', async () => {
    const { findOrInviteOwner } = await import('./platform-admin.js');
    await expect(findOrInviteOwner('pastor@example.test')).resolves.toBe('invited-user');
    expect(fixture.invites).toEqual(['pastor@example.test']);
    expect(fixture.profileReads).toBe(0);
  });
});
