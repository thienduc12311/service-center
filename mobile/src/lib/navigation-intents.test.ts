import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  type CurrentUser,
  type NotificationFeedItem,
  type PrivateNavigationIntent,
} from '@service-center/shared';
import {
  PrivateIntentCoordinator,
  resolvePrivateNavigationIntent,
} from './navigation-intents';
import type { ProtectedQueryScope } from './session-lifecycle';

const organizationA = '11111111-1111-4111-8111-111111111111';
const organizationB = '22222222-2222-4222-8222-222222222222';
const planId = '33333333-3333-4333-8333-333333333333';
const userId = '44444444-4444-4444-8444-444444444444';

const intent: PrivateNavigationIntent = {
  kind: 'plan',
  intentId: 'push:one',
  organizationId: organizationB,
  planId,
  notificationId: '55555555-5555-4555-8555-555555555555',
  notificationType: 'plan_updated',
};

const notification = {
  id: intent.notificationId,
  organization_id: organizationB,
  type: 'plan_updated',
  plan_id: planId,
} as NotificationFeedItem;

const user = {
  profile: { id: userId },
  memberships: [
    { organization: { id: organizationA }, role: 'member' },
    { organization: { id: organizationB }, role: 'member' },
  ],
} as CurrentUser;

describe('PrivateIntentCoordinator', () => {
  it('retains one intent through login and consumes duplicate taps once', () => {
    const coordinator = new PrivateIntentCoordinator();
    expect(coordinator.offer(intent)).toBe(true);
    expect(coordinator.takeIfReady(false)).toBeNull();

    const resumed = coordinator.takeIfReady(true);
    expect(resumed).toEqual(intent);
    coordinator.complete(intent);

    expect(coordinator.takeIfReady(true)).toBeNull();
    expect(coordinator.offer(intent)).toBe(false);
  });

  it('allows a fresh tap after a transient network failure', () => {
    const coordinator = new PrivateIntentCoordinator();
    coordinator.offer(intent);
    expect(coordinator.takeIfReady(true)).toEqual(intent);
    coordinator.complete(intent, false);
    expect(coordinator.offer(intent)).toBe(true);
  });
});

describe('resolvePrivateNavigationIntent', () => {
  it('switches to an authorized organization before verifying the plan', async () => {
    let scope: ProtectedQueryScope | null = {
      generation: 1,
      userId,
      organizationId: organizationA,
    };
    const switchOrganization = vi.fn(async () => {
      scope = { generation: 2, userId, organizationId: organizationB };
    });
    const loadPlan = vi.fn(async () => ({ id: planId }));
    const loadNotification = vi.fn(async () => notification);

    await expect(
      resolvePrivateNavigationIntent(intent, user, organizationA, {
        switchOrganization,
        currentScope: () => scope,
        loadNotification,
        loadPlan,
      }),
    ).resolves.toEqual({ status: 'ready', destination: { kind: 'plan', planId } });
    expect(switchOrganization).toHaveBeenCalledWith(organizationB);
    expect(loadPlan).toHaveBeenCalledWith(planId);
  });

  it('rejects an organization the current account cannot access', async () => {
    const foreignIntent = { ...intent, organizationId: '66666666-6666-4666-8666-666666666666' };
    const switchOrganization = vi.fn();
    const loadPlan = vi.fn();
    const loadNotification = vi.fn();

    await expect(
      resolvePrivateNavigationIntent(foreignIntent, user, organizationA, {
        switchOrganization,
        currentScope: () => null,
        loadNotification,
        loadPlan,
      }),
    ).resolves.toEqual({ status: 'failed', reason: 'no-access' });
    expect(switchOrganization).not.toHaveBeenCalled();
    expect(loadNotification).not.toHaveBeenCalled();
    expect(loadPlan).not.toHaveBeenCalled();
  });

  it('falls back safely when the scoped plan no longer exists', async () => {
    await expect(
      resolvePrivateNavigationIntent(intent, user, organizationB, {
        switchOrganization: vi.fn(),
        currentScope: () => ({ generation: 2, userId, organizationId: organizationB }),
        loadNotification: async () => notification,
        loadPlan: async () => {
          throw new ApiError(404, 'missing');
        },
      }),
    ).resolves.toEqual({ status: 'failed', reason: 'unavailable' });
  });

  it('rejects a push whose notification row no longer matches its target', async () => {
    await expect(
      resolvePrivateNavigationIntent(intent, user, organizationB, {
        switchOrganization: vi.fn(),
        currentScope: () => ({ generation: 2, userId, organizationId: organizationB }),
        loadNotification: async () => ({ ...notification, plan_id: null }),
        loadPlan: vi.fn(),
      }),
    ).resolves.toEqual({ status: 'failed', reason: 'unavailable' });
  });
});
