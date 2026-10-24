import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  type CurrentUser,
  type NotificationFeedItem,
  type PrivateNavigationIntent,
} from '@service-center/shared';
import {
  LINK_REPEAT_AFTER_MS,
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

describe('repeated link taps (MOB-033 widgets)', () => {
  const link: PrivateNavigationIntent = { ...intent, intentId: `link:plan:${organizationB}:${planId}`, notificationId: null, notificationType: null };

  it('drops the duplicate delivery of one link but accepts the same link tapped again later', () => {
    let now = 1_000;
    const coordinator = new PrivateIntentCoordinator(() => now);
    expect(coordinator.offer(link)).toBe(true);
    coordinator.complete(coordinator.takeIfReady(true) ?? link);
    now += 100;
    expect(coordinator.offer(link)).toBe(false);
    now += LINK_REPEAT_AFTER_MS;
    expect(coordinator.offer(link)).toBe(true);
  });

  it('keeps a push response consumed for good', () => {
    let now = 1_000;
    const coordinator = new PrivateIntentCoordinator(() => now);
    coordinator.offer(intent);
    coordinator.complete(coordinator.takeIfReady(true) ?? intent);
    now += LINK_REPEAT_AFTER_MS * 10;
    expect(coordinator.offer(intent)).toBe(false);
  });
});

describe('resolvePrivateNavigationIntent', () => {
  it('lands a rehearse link on rehearsal only after the same plan checks', async () => {
    let scope: ProtectedQueryScope | null = { generation: 1, userId, organizationId: organizationA };
    const loadPlan = vi.fn(async () => ({ id: planId }));
    await expect(
      resolvePrivateNavigationIntent(
        { ...intent, intentId: 'link:rehearse', notificationId: null, notificationType: null, view: 'rehearse' },
        user,
        organizationA,
        {
          switchOrganization: vi.fn(async () => {
            scope = { generation: 2, userId, organizationId: organizationB };
          }),
          currentScope: () => scope,
          loadNotification: vi.fn(),
          loadPlan,
          loadConversation: vi.fn(),
        },
      ),
    ).resolves.toEqual({ status: 'ready', destination: { kind: 'plan', planId, view: 'rehearse' } });
    expect(loadPlan).toHaveBeenCalledWith(planId);
  });

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
        loadConversation: vi.fn(),
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
        loadConversation: vi.fn(),
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
        loadConversation: vi.fn(),
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
        loadConversation: vi.fn(),
      }),
    ).resolves.toEqual({ status: 'failed', reason: 'unavailable' });
  });

  describe('MOB-019 conversation notifications', () => {
    const conversationId = '77777777-7777-4777-8777-777777777777';
    const teamChatIntent: PrivateNavigationIntent = {
      kind: 'notifications',
      intentId: 'push:chat',
      organizationId: organizationB,
      notificationId: '88888888-8888-4888-8888-888888888888',
      notificationType: 'conversation_message',
    };
    const teamChatRow = {
      id: teamChatIntent.notificationId,
      organization_id: organizationB,
      type: 'conversation_message',
      plan_id: null,
      conversation_id: conversationId,
    } as NotificationFeedItem;

    it('opens the exact conversation from the authorized feed row after switching organization', async () => {
      let scope: ProtectedQueryScope | null = { generation: 1, userId, organizationId: organizationA };
      const switchOrganization = vi.fn(async () => {
        scope = { generation: 2, userId, organizationId: organizationB };
      });
      const loadConversation = vi.fn(async () => ({}));
      const loadPlan = vi.fn();
      await expect(
        resolvePrivateNavigationIntent(teamChatIntent, user, organizationA, {
          switchOrganization,
          currentScope: () => scope,
          loadNotification: async () => teamChatRow,
          loadPlan,
          loadConversation,
        }),
      ).resolves.toEqual({ status: 'ready', destination: { kind: 'conversation', conversationId } });
      expect(switchOrganization).toHaveBeenCalledWith(organizationB);
      expect(loadConversation).toHaveBeenCalledWith(conversationId);
      expect(loadPlan).not.toHaveBeenCalled();
    });

    it('opens a plan chat mention in its conversation, not the plan', async () => {
      const planChatIntent: PrivateNavigationIntent = { ...intent, notificationType: 'conversation_mention' };
      const loadPlan = vi.fn();
      await expect(
        resolvePrivateNavigationIntent(planChatIntent, user, organizationB, {
          switchOrganization: vi.fn(),
          currentScope: () => ({ generation: 2, userId, organizationId: organizationB }),
          loadNotification: async () => ({ ...notification, type: 'conversation_mention', conversation_id: conversationId }),
          loadPlan,
          loadConversation: vi.fn(async () => ({})),
        }),
      ).resolves.toEqual({ status: 'ready', destination: { kind: 'conversation', conversationId } });
      expect(loadPlan).not.toHaveBeenCalled();
    });

    it('fails safely when the person is no longer a participant', async () => {
      await expect(
        resolvePrivateNavigationIntent(teamChatIntent, user, organizationB, {
          switchOrganization: vi.fn(),
          currentScope: () => ({ generation: 2, userId, organizationId: organizationB }),
          loadNotification: async () => teamChatRow,
          loadPlan: vi.fn(),
          loadConversation: async () => {
            throw new ApiError(404, 'Conversation not found');
          },
        }),
      ).resolves.toEqual({ status: 'failed', reason: 'unavailable' });
    });

    it('does not navigate when the session changed while the conversation loaded', async () => {
      let scope: ProtectedQueryScope | null = { generation: 2, userId, organizationId: organizationB };
      await expect(
        resolvePrivateNavigationIntent(teamChatIntent, user, organizationB, {
          switchOrganization: vi.fn(),
          currentScope: () => scope,
          loadNotification: async () => teamChatRow,
          loadPlan: vi.fn(),
          loadConversation: async () => {
            scope = { generation: 3, userId, organizationId: organizationB };
            return {};
          },
        }),
      ).resolves.toEqual({ status: 'failed', reason: 'no-access' });
    });

    it('keeps a transient failure retryable', async () => {
      await expect(
        resolvePrivateNavigationIntent(teamChatIntent, user, organizationB, {
          switchOrganization: vi.fn(),
          currentScope: () => ({ generation: 2, userId, organizationId: organizationB }),
          loadNotification: async () => teamChatRow,
          loadPlan: vi.fn(),
          loadConversation: async () => {
            throw new TypeError('Network request failed');
          },
        }),
      ).resolves.toEqual({ status: 'failed', reason: 'network' });
    });

    it('ignores a conversation id on a notification that is not a chat notification', async () => {
      const loadConversation = vi.fn();
      await expect(
        resolvePrivateNavigationIntent(intent, user, organizationB, {
          switchOrganization: vi.fn(),
          currentScope: () => ({ generation: 2, userId, organizationId: organizationB }),
          loadNotification: async () => ({ ...notification, conversation_id: conversationId }),
          loadPlan: vi.fn(async () => ({ id: planId })),
          loadConversation,
        }),
      ).resolves.toEqual({ status: 'ready', destination: { kind: 'plan', planId } });
      expect(loadConversation).not.toHaveBeenCalled();
    });
  });
});
