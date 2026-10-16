import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { CurrentUser, OrganizationRow, ProfileRow } from '@service-center/shared';
import { queryKeys } from './query-keys';
import {
  NativeSessionLifecycle,
  type NativeSessionIdentity,
  type SessionLifecycleDependencies,
} from './session-lifecycle';
import type { NativeApiRequestContext } from './api';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

const organization = (id: string): OrganizationRow => ({
  id,
  name: id,
  slug: id,
  timezone: 'America/New_York',
  logo_url: null,
  address_line1: null,
  address_line2: null,
  city: null,
  state_province: null,
  postal_code: null,
  country: null,
  denomination: null,
  member_count: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

const currentUser = (userId: string, organizationIds: string[]): CurrentUser => {
  const profile: ProfileRow = {
    id: userId,
    email: `${userId}@example.test`,
    full_name: userId,
    phone: null,
    avatar_url: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
  return {
    profile,
    memberships: organizationIds.map((id) => ({ organization: organization(id), role: 'member' })),
  };
};

const session = (userId: string, accessToken = `token-${userId}`): NativeSessionIdentity => ({
  userId,
  accessToken,
});

interface Harness {
  lifecycle: NativeSessionLifecycle;
  contexts: NativeApiRequestContext[];
  clear: ReturnType<typeof vi.fn>;
}

const harness = (
  overrides: Partial<SessionLifecycleDependencies> = {},
): Harness => {
  const contexts: NativeApiRequestContext[] = [];
  const clear = vi.fn();
  const dependencies: SessionLifecycleDependencies = {
    cache: { cancel: async () => undefined, clear },
    loadCurrentUser: async () => currentUser('user-a', ['organization-a']),
    loadStoredOrganizationId: async () => null,
    storeOrganizationId: async () => undefined,
    setRequestContext: (context) => contexts.push(context),
    ...overrides,
  };
  return { lifecycle: new NativeSessionLifecycle(dependencies), contexts, clear };
};

describe('NativeSessionLifecycle', () => {
  it('ignores an older account load that finishes after the next account', async () => {
    const loads = new Map<string, Deferred<CurrentUser>>([
      ['user-a', deferred<CurrentUser>()],
      ['user-b', deferred<CurrentUser>()],
    ]);
    let latestContext: NativeApiRequestContext | null = null;
    const { lifecycle } = harness({
      setRequestContext: (context) => {
        latestContext = context;
      },
      loadCurrentUser: () => loads.get(latestContext?.metadata.userId ?? '')!.promise,
    });

    const loadingA = lifecycle.handleSession(session('user-a'));
    const loadingB = lifecycle.handleSession(session('user-b'));
    loads.get('user-b')!.resolve(currentUser('user-b', ['organization-b']));
    await loadingB;
    loads.get('user-a')!.resolve(currentUser('user-a', ['organization-a']));
    await loadingA;

    expect(lifecycle.getState()).toMatchObject({
      phase: 'ready',
      organizationId: 'organization-b',
      user: { profile: { id: 'user-b' } },
    });
  });

  it('keeps protected state hidden until storage and membership validation finish', async () => {
    const stored = deferred<string | null>();
    const user = deferred<CurrentUser>();
    const { lifecycle } = harness({
      loadStoredOrganizationId: () => stored.promise,
      loadCurrentUser: () => user.promise,
    });

    const loading = lifecycle.handleSession(session('user-a'));
    user.resolve(currentUser('user-a', ['organization-a']));
    await Promise.resolve();
    expect(lifecycle.getState().phase).toBe('loading');
    expect(lifecycle.queryScope()).toBeNull();

    stored.resolve('organization-from-another-account');
    await loading;
    expect(lifecycle.getState()).toMatchObject({
      phase: 'ready',
      organizationId: 'organization-a',
    });
  });

  it('advances generation and gates content while switching organizations', async () => {
    const secondLoad = deferred<CurrentUser>();
    let loadCount = 0;
    const { lifecycle, clear } = harness({
      loadCurrentUser: async () => {
        loadCount += 1;
        if (loadCount === 1) return currentUser('user-a', ['organization-a', 'organization-b']);
        return secondLoad.promise;
      },
    });
    await lifecycle.handleSession(session('user-a'));
    const firstScope = lifecycle.queryScope();

    const switching = lifecycle.switchOrganization('organization-b');
    expect(lifecycle.getState().phase).toBe('loading');
    expect(lifecycle.queryScope()).toBeNull();
    secondLoad.resolve(currentUser('user-a', ['organization-a', 'organization-b']));
    await switching;

    expect(lifecycle.queryScope()).toEqual({
      generation: (firstScope?.generation ?? 0) + 1,
      userId: 'user-a',
      organizationId: 'organization-b',
    });
    expect(clear).toHaveBeenCalledTimes(2);
  });

  it('keeps token refreshes in place and rejects stale unauthorized callbacks', async () => {
    const { lifecycle, contexts, clear } = harness();
    await lifecycle.handleSession(session('user-a', 'token-old'));
    const generation = lifecycle.getState().generation;
    const oldContext = contexts.at(-1)!;

    await lifecycle.handleSession(session('user-a', 'token-new'));
    const newContext = contexts.at(-1)!;

    expect(lifecycle.getState().generation).toBe(generation);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(lifecycle.isRequestCurrent(oldContext)).toBe(false);
    expect(lifecycle.isRequestCurrent(newContext)).toBe(true);
  });

  it('keeps a refreshed token that arrives during organization hydration', async () => {
    const stored = deferred<string | null>();
    const user = deferred<CurrentUser>();
    const { lifecycle, contexts } = harness({
      loadStoredOrganizationId: () => stored.promise,
      loadCurrentUser: () => user.promise,
    });

    const loading = lifecycle.handleSession(session('user-a', 'token-old'));
    await lifecycle.handleSession(session('user-a', 'token-new'));
    user.resolve(currentUser('user-a', ['organization-a']));
    stored.resolve('organization-a');
    await loading;

    expect(lifecycle.getState().session?.accessToken).toBe('token-new');
    expect(contexts.at(-1)?.accessToken).toBe('token-new');
    expect(lifecycle.getState().generation).toBe(1);
  });

  it('clears the signed-out generation before another account becomes ready', async () => {
    let user = currentUser('user-a', ['organization-a']);
    const { lifecycle, clear } = harness({ loadCurrentUser: async () => user });
    await lifecycle.handleSession(session('user-a'));
    const accountAContext = {
      accessToken: 'token-user-a',
      organizationId: 'organization-a',
      metadata: { generation: 1, userId: 'user-a' },
    };

    await lifecycle.handleSession(null);
    expect(lifecycle.getState()).toMatchObject({
      phase: 'signed-out',
      user: null,
      organizationId: null,
    });
    expect(lifecycle.queryScope()).toBeNull();

    user = currentUser('user-b', ['organization-b']);
    await lifecycle.handleSession(session('user-b'));
    expect(lifecycle.getState()).toMatchObject({
      phase: 'ready',
      user: { profile: { id: 'user-b' } },
      organizationId: 'organization-b',
    });
    expect(lifecycle.isRequestCurrent(accountAContext)).toBe(false);
    expect(clear).toHaveBeenCalledTimes(3);
  });

  it('scopes detail keys by account, organization and generation', () => {
    const a = { generation: 1, userId: 'user-a', organizationId: 'organization-a' };
    const b = { generation: 2, userId: 'user-a', organizationId: 'organization-b' };
    const nextAccount = { generation: 3, userId: 'user-b', organizationId: 'organization-b' };

    expect(queryKeys.songbook(a, 'book-1')).not.toEqual(queryKeys.songbook(b, 'book-1'));
    expect(queryKeys.songbook(b, 'book-1')).not.toEqual(
      queryKeys.songbook(nextAccount, 'book-1'),
    );
  });

  it('removes a delayed tenant query before the next tenant can render', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const oldResult = deferred<string>();
    const users = [
      currentUser('user-a', ['organization-a', 'organization-b']),
      currentUser('user-a', ['organization-a', 'organization-b']),
    ];
    const { lifecycle } = harness({
      cache: {
        cancel: () => queryClient.cancelQueries(),
        clear: () => queryClient.clear(),
      },
      loadCurrentUser: async () => users.shift()!,
    });
    await lifecycle.handleSession(session('user-a'));
    const oldKey = queryKeys.songbook(lifecycle.queryScope(), 'book-1');
    const pending = queryClient.fetchQuery({ queryKey: oldKey, queryFn: () => oldResult.promise });

    await lifecycle.switchOrganization('organization-b');
    const newKey = queryKeys.songbook(lifecycle.queryScope(), 'book-1');
    queryClient.setQueryData(newKey, 'organization-b-result');
    oldResult.resolve('organization-a-result');
    await pending.catch(() => undefined);

    expect(queryClient.getQueryData(oldKey)).toBeUndefined();
    expect(queryClient.getQueryData(newKey)).toBe('organization-b-result');
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);
  });
});
