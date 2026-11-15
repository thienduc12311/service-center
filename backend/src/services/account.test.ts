import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../lib/supabase.js';
import type { AccountDeletionPlanRow } from '../model/account.model.js';

/**
 * Account deletion orchestration (App Store Review Guideline 5.1.1(v)). The
 * database is a fake; the real refusal and organization cleanup live in
 * `prepare_account_deletion` (migration 20261115000000).
 */

interface StorageObject {
  name: string;
}

const fixture = vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key-that-is-long-enough';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-that-is-long-enough';
  return {
    calls: [] as string[],
    prepared: ['solo-org'] as string[],
    avatars: [] as StorageObject[],
    removed: [] as string[][],
    deleteUserError: null as { status?: number; message: string } | null,
  };
});

vi.mock('../lib/supabase.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/supabase.js')>();
  return {
    ...actual,
    adminDb: {
      rpc: async (fn: string, args: { p_user: string }) => {
        fixture.calls.push(`rpc:${fn}:${args.p_user}`);
        return { data: fixture.prepared, error: null };
      },
      storage: {
        from: (bucket: string) => ({
          list: async (folder: string) => {
            fixture.calls.push(`list:${bucket}/${folder}`);
            return { data: fixture.avatars, error: null };
          },
          remove: async (paths: string[]) => {
            fixture.removed.push(paths);
            return { data: [], error: null };
          },
        }),
      },
      auth: {
        admin: {
          deleteUser: async (id: string) => {
            fixture.calls.push(`deleteUser:${id}`);
            return { data: null, error: fixture.deleteUserError };
          },
        },
      },
    },
  };
});

import { deleteAccount, getAccountDeletionPlan } from './account.js';

const callerDb = (rows: AccountDeletionPlanRow[]): Db =>
  ({ rpc: async () => ({ data: rows, error: null }) }) as unknown as Db;

beforeEach(() => {
  fixture.calls = [];
  fixture.prepared = ['solo-org'];
  fixture.avatars = [];
  fixture.removed = [];
  fixture.deleteUserError = null;
});

describe('getAccountDeletionPlan', () => {
  it('can delete when no organization is blocked', async () => {
    const plan = await getAccountDeletionPlan({
      db: callerDb([{ organization_id: 'solo-org', organization_name: 'Solo', outcome: 'deleted' }]),
      userId: 'user-1',
    });
    expect(plan).toEqual({
      can_delete: true,
      organizations: [{ organization_id: 'solo-org', organization_name: 'Solo', outcome: 'deleted' }],
    });
  });

  it('treats an unknown outcome as blocking', async () => {
    const plan = await getAccountDeletionPlan({
      db: callerDb([{ organization_id: 'o', organization_name: 'O', outcome: 'surprise' }]),
      userId: 'user-1',
    });
    expect(plan.can_delete).toBe(false);
    expect(plan.organizations[0]?.outcome).toBe('blocked');
  });
});

describe('deleteAccount', () => {
  it('refuses with account_deletion_blocked and touches nothing', async () => {
    await expect(
      deleteAccount({
        db: callerDb([
          { organization_id: 'church', organization_name: 'Church', outcome: 'blocked' },
          { organization_id: 'solo-org', organization_name: 'Solo', outcome: 'deleted' },
        ]),
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'account_deletion_blocked',
      details: [{ organization_id: 'church', organization_name: 'Church', outcome: 'blocked' }],
    });
    expect(fixture.calls).toEqual([]);
  });

  it('prepares, removes own pictures, then deletes the login', async () => {
    fixture.avatars = [{ name: 'a.jpg' }, { name: 'b.png' }];
    const result = await deleteAccount({ db: callerDb([]), userId: 'user-1' });
    expect(result).toEqual({ deleted_organization_ids: ['solo-org'] });
    expect(fixture.calls).toEqual([
      'rpc:prepare_account_deletion:user-1',
      'list:avatars/users/user-1',
      'deleteUser:user-1',
    ]);
    expect(fixture.removed).toEqual([['users/user-1/a.jpg', 'users/user-1/b.png']]);
  });

  it('reports a failed login deletion so the client can retry', async () => {
    fixture.deleteUserError = { status: 500, message: 'boom' };
    await expect(deleteAccount({ db: callerDb([]), userId: 'user-1' })).rejects.toMatchObject({ status: 502 });
  });
});
