import {
  ApiError,
  type CurrentUser,
  type NotificationFeedItem,
  type PrivateNavigationIntent,
} from '@service-center/shared';
import type { ProtectedQueryScope } from './session-lifecycle';

export type PrivateIntentDestination =
  | { kind: 'plan'; planId: string }
  | { kind: 'notifications' };

export type PrivateIntentFailure = 'no-access' | 'unavailable' | 'network';

export type PrivateIntentResolution =
  | { status: 'ready'; destination: PrivateIntentDestination }
  | { status: 'failed'; reason: PrivateIntentFailure };

export interface PrivateIntentDependencies {
  switchOrganization: (organizationId: string) => Promise<void>;
  currentScope: () => ProtectedQueryScope | null;
  loadNotification: (notificationId: string) => Promise<NotificationFeedItem>;
  loadPlan: (planId: string) => Promise<unknown>;
}

/**
 * Keeps at most one private intent pending through authentication and consumes
 * each source once. A second, distinct tap replaces an older pending tap.
 */
export class PrivateIntentCoordinator {
  private pending: PrivateNavigationIntent | null = null;
  private active: PrivateNavigationIntent | null = null;
  private consumed = new Set<string>();

  offer(intent: PrivateNavigationIntent): boolean {
    if (
      this.consumed.has(intent.intentId) ||
      this.active?.intentId === intent.intentId ||
      this.pending?.intentId === intent.intentId
    ) {
      return false;
    }
    this.pending = intent;
    return true;
  }

  hasPending = (): boolean => this.pending !== null;

  takeIfReady(ready: boolean): PrivateNavigationIntent | null {
    if (!ready || this.active || !this.pending) return null;
    this.active = this.pending;
    this.pending = null;
    return this.active;
  }

  complete(intent: PrivateNavigationIntent, consume = true): void {
    if (this.active?.intentId !== intent.intentId) return;
    if (consume) this.consumed.add(intent.intentId);
    this.active = null;
    if (this.consumed.size > 100) {
      const oldest = this.consumed.values().next().value as string | undefined;
      if (oldest) this.consumed.delete(oldest);
    }
  }
}

/** Membership is checked before switching; the scoped fetch is final authority. */
export const resolvePrivateNavigationIntent = async (
  intent: PrivateNavigationIntent,
  user: CurrentUser,
  activeOrganizationId: string | null,
  dependencies: PrivateIntentDependencies,
): Promise<PrivateIntentResolution> => {
  const isMember = user.memberships.some(
    ({ organization }) => organization.id === intent.organizationId,
  );
  if (!isMember) return { status: 'failed', reason: 'no-access' };

  try {
    if (activeOrganizationId !== intent.organizationId) {
      await dependencies.switchOrganization(intent.organizationId);
    }
  } catch {
    return { status: 'failed', reason: 'no-access' };
  }

  const scope = dependencies.currentScope();
  if (
    !scope ||
    scope.userId !== user.profile.id ||
    scope.organizationId !== intent.organizationId
  ) {
    return { status: 'failed', reason: 'no-access' };
  }

  if (intent.notificationId) {
    try {
      const notification = await dependencies.loadNotification(intent.notificationId);
      if (
        notification.organization_id !== intent.organizationId ||
        notification.type !== intent.notificationType ||
        notification.plan_id !== (intent.kind === 'plan' ? intent.planId : null)
      ) {
        return { status: 'failed', reason: 'unavailable' };
      }
    } catch (error) {
      if (error instanceof ApiError && [401, 403].includes(error.status)) {
        return { status: 'failed', reason: 'no-access' };
      }
      if (error instanceof ApiError && error.status === 404) {
        return { status: 'failed', reason: 'unavailable' };
      }
      return { status: 'failed', reason: 'network' };
    }
  }

  if (intent.kind === 'notifications') {
    return { status: 'ready', destination: { kind: 'notifications' } };
  }

  try {
    await dependencies.loadPlan(intent.planId);
    const verifiedScope = dependencies.currentScope();
    if (
      !verifiedScope ||
      verifiedScope.userId !== user.profile.id ||
      verifiedScope.organizationId !== intent.organizationId
    ) {
      return { status: 'failed', reason: 'no-access' };
    }
    return { status: 'ready', destination: { kind: 'plan', planId: intent.planId } };
  } catch (error) {
    if (error instanceof ApiError && [401, 403].includes(error.status)) {
      return { status: 'failed', reason: 'no-access' };
    }
    if (error instanceof ApiError && error.status === 404) {
      return { status: 'failed', reason: 'unavailable' };
    }
    return { status: 'failed', reason: 'network' };
  }
};
