import type { CurrentUser } from '@service-center/shared';
import type { NativeApiRequestContext } from './api';

export interface NativeSessionIdentity {
  accessToken: string;
  userId: string;
}

export interface ProtectedQueryScope {
  generation: number;
  userId: string;
  organizationId: string;
}

export type SessionLifecyclePhase = 'loading' | 'ready' | 'signed-out' | 'error';

export interface SessionLifecycleState {
  phase: SessionLifecyclePhase;
  generation: number;
  session: NativeSessionIdentity | null;
  user: CurrentUser | null;
  organizationId: string | null;
  error: unknown;
}

export interface SessionLifecycleCache {
  cancel: () => Promise<void>;
  clear: () => void;
}

export interface SessionLifecycleDependencies {
  cache: SessionLifecycleCache;
  loadCurrentUser: () => Promise<CurrentUser>;
  loadStoredOrganizationId: (userId: string) => Promise<string | null>;
  storeOrganizationId: (userId: string, organizationId: string | null) => Promise<void>;
  setRequestContext: (context: NativeApiRequestContext) => void;
}

type SessionLifecycleListener = (state: SessionLifecycleState) => void;

const requestContext = (
  generation: number,
  session: NativeSessionIdentity | null,
  organizationId: string | null,
): NativeApiRequestContext => ({
  accessToken: session?.accessToken ?? null,
  organizationId,
  metadata: { generation, userId: session?.userId ?? null },
});

const authorizedOrganization = (
  user: CurrentUser,
  requested: string | null,
): string | null => {
  if (requested && user.memberships.some(({ organization }) => organization.id === requested)) {
    return requested;
  }
  return user.memberships[0]?.organization.id ?? null;
};

/**
 * Serializes account/organization transitions independently of React. A
 * generation check surrounds every awaited step so late work can only finish
 * inside the identity that started it.
 */
export class NativeSessionLifecycle {
  private state: SessionLifecycleState = {
    phase: 'loading',
    generation: 0,
    session: null,
    user: null,
    organizationId: null,
    error: null,
  };

  private listeners = new Set<SessionLifecycleListener>();

  constructor(private readonly dependencies: SessionLifecycleDependencies) {
    this.dependencies.setRequestContext(requestContext(0, null, null));
  }

  getState = (): SessionLifecycleState => this.state;

  subscribe = (listener: SessionLifecycleListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(state: SessionLifecycleState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }

  private isGenerationCurrent(generation: number): boolean {
    return this.state.generation === generation;
  }

  isRequestCurrent = (context: NativeApiRequestContext): boolean => {
    const { session, generation, organizationId } = this.state;
    return Boolean(
      session &&
        context.metadata.generation === generation &&
        context.metadata.userId === session.userId &&
        context.accessToken === session.accessToken &&
        (context.organizationId ?? null) === organizationId,
    );
  };

  queryScope = (): ProtectedQueryScope | null => {
    const { phase, generation, session, organizationId } = this.state;
    if (phase !== 'ready' || !session || !organizationId) return null;
    return { generation, userId: session.userId, organizationId };
  };

  handleSession = async (session: NativeSessionIdentity | null): Promise<void> => {
    const current = this.state.session;
    if (session && current?.userId === session.userId) {
      this.publish({ ...this.state, session });
      this.dependencies.setRequestContext(
        requestContext(
          this.state.generation,
          session,
          this.state.phase === 'ready' ? this.state.organizationId : null,
        ),
      );
      return;
    }
    await this.transition(session, null);
  };

  retry = async (): Promise<void> => {
    await this.transition(this.state.session, this.state.organizationId);
  };

  switchOrganization = async (organizationId: string): Promise<void> => {
    const { session, user } = this.state;
    if (!session || !user) throw new Error('Sign in before choosing an organization.');
    if (!user.memberships.some(({ organization }) => organization.id === organizationId)) {
      throw new Error('You no longer have access to that organization.');
    }
    await this.transition(session, organizationId);
  };

  refreshUser = async (): Promise<boolean> => {
    const { generation, session, organizationId, phase } = this.state;
    if (!session || phase !== 'ready') {
      await this.retry();
      return this.state.phase === 'ready';
    }

    try {
      const user = await this.dependencies.loadCurrentUser();
      if (!this.isGenerationCurrent(generation)) return false;
      const nextOrganizationId = authorizedOrganization(user, organizationId);
      if (nextOrganizationId !== organizationId) {
        await this.transition(session, nextOrganizationId);
        return this.state.phase === 'ready';
      }
      this.publish({ ...this.state, user, error: null });
      return true;
    } catch (error) {
      if (!this.isGenerationCurrent(generation)) return false;
      this.publish({ ...this.state, error });
      throw error;
    }
  };

  private async transition(
    session: NativeSessionIdentity | null,
    requestedOrganizationId: string | null,
  ): Promise<void> {
    const generation = this.state.generation + 1;
    this.publish({
      phase: 'loading',
      generation,
      session,
      user: null,
      organizationId: null,
      error: null,
    });
    this.dependencies.setRequestContext(requestContext(generation, session, null));

    await this.dependencies.cache.cancel();
    if (!this.isGenerationCurrent(generation)) return;
    this.dependencies.cache.clear();

    if (!session) {
      this.publish({
        phase: 'signed-out',
        generation,
        session: null,
        user: null,
        organizationId: null,
        error: null,
      });
      return;
    }

    try {
      const [storedOrganizationId, user] = await Promise.all([
        requestedOrganizationId
          ? Promise.resolve(requestedOrganizationId)
          : this.dependencies.loadStoredOrganizationId(session.userId),
        this.dependencies.loadCurrentUser(),
      ]);
      if (!this.isGenerationCurrent(generation)) return;

      const organizationId = authorizedOrganization(user, storedOrganizationId);
      await this.dependencies.storeOrganizationId(session.userId, organizationId);
      if (!this.isGenerationCurrent(generation)) return;
      const activeSession = this.state.session;
      if (!activeSession || activeSession.userId !== session.userId) return;

      this.dependencies.setRequestContext(requestContext(generation, activeSession, organizationId));
      this.publish({
        phase: 'ready',
        generation,
        session: activeSession,
        user,
        organizationId,
        error: null,
      });
    } catch (error) {
      if (!this.isGenerationCurrent(generation)) return;
      const activeSession = this.state.session;
      this.dependencies.setRequestContext(requestContext(generation, activeSession, null));
      this.publish({
        phase: 'error',
        generation,
        session: activeSession,
        user: null,
        organizationId: null,
        error,
      });
    }
  }
}
