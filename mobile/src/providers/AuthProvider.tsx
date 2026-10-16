import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { canManage, isAdmin, type CurrentUser, type OrgRole } from '@service-center/shared';
import { supabase } from '../lib/supabase';
import { api, setApiRequestContext, setUnauthorizedHandler } from '../lib/api';
import { loadStoredOrganizationId, storeOrganizationId } from '../lib/organization-storage';
import {
  runDeviceSignOutHandler,
  runDeviceSignOutRecoveryHandler,
} from '../lib/device-registration-lifecycle';
import {
  NativeSessionLifecycle,
  type NativeSessionIdentity,
  type ProtectedQueryScope,
  type SessionLifecycleState,
} from '../lib/session-lifecycle';

interface AuthContextValue {
  session: Session | null;
  user: CurrentUser | null;
  organizationId: string | null;
  role: OrgRole | null;
  canManage: boolean;
  /** Owners and admins: membership, org settings and AI chord sheet imports. */
  isAdmin: boolean;
  loading: boolean;
  ready: boolean;
  error: unknown;
  generation: number;
  queryScope: ProtectedQueryScope | null;
  currentQueryScope: () => ProtectedQueryScope | null;
  isCurrentGeneration: (generation: number) => boolean;
  refreshUser: () => Promise<void>;
  retry: () => Promise<void>;
  switchOrganization: (id: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const sessionIdentity = (session: Session | null): NativeSessionIdentity | null =>
  session ? { accessToken: session.access_token, userId: session.user.id } : null;

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const lifecycleRef = useRef<NativeSessionLifecycle | null>(null);
  const signOutPromiseRef = useRef<Promise<void> | null>(null);

  if (!lifecycleRef.current) {
    lifecycleRef.current = new NativeSessionLifecycle({
      cache: {
        cancel: async () => {
          await queryClient.cancelQueries();
        },
        clear: () => queryClient.clear(),
      },
      loadCurrentUser: () => api.me(),
      loadStoredOrganizationId,
      storeOrganizationId,
      setRequestContext: setApiRequestContext,
    });
  }

  const lifecycle = lifecycleRef.current;
  const [lifecycleState, setLifecycleState] = useState<SessionLifecycleState>(
    lifecycle.getState,
  );

  useEffect(() => lifecycle.subscribe(setLifecycleState), [lifecycle]);

  const signOut = useCallback((): Promise<void> => {
    if (signOutPromiseRef.current) return signOutPromiseRef.current;
    const promise = (async () => {
      const cleanup = await runDeviceSignOutHandler();
      if (
        cleanup.unregister === 'failed' ||
        cleanup.unregister === 'timed_out' ||
        cleanup.badge !== 'completed'
      ) {
        console.warn('[push] sign-out continued with deferred device cleanup', {
          unregister: cleanup.unregister,
          badge: cleanup.badge,
          fallbackQueued: cleanup.fallbackQueued,
        });
      }

      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) {
        void runDeviceSignOutRecoveryHandler().catch((recoveryError: unknown) => {
          console.warn('[push] could not restore registration after sign-out failed', recoveryError);
        });
        throw error;
      }
    })().finally(() => {
      signOutPromiseRef.current = null;
    });
    signOutPromiseRef.current = promise;
    return promise;
  }, []);

  useEffect(() => {
    let active = true;

    const applySession = (next: Session | null): void => {
      if (!active) return;
      setSession(next);
      void lifecycle.handleSession(sessionIdentity(next));
    };

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      applySession(next);
    });

    setUnauthorizedHandler((context) => {
      if (!lifecycle.isRequestCurrent(context)) return;
      void signOut().catch((error: unknown) => {
        console.warn('[auth] could not finish sign-out', error);
      });
    });

    return () => {
      active = false;
      setUnauthorizedHandler(null);
      subscription.subscription.unsubscribe();
    };
  }, [lifecycle, signOut]);

  const isCurrentGeneration = useCallback(
    (generation: number): boolean => {
      const current = lifecycle.getState();
      return current.phase === 'ready' && current.generation === generation;
    },
    [lifecycle],
  );

  const value = useMemo<AuthContextValue>(() => {
    const { user, organizationId, generation, phase, error } = lifecycleState;
    const role = user?.memberships.find((m) => m.organization.id === organizationId)?.role ?? null;
    return {
      session,
      user,
      organizationId,
      role,
      canManage: canManage(role),
      isAdmin: isAdmin(role),
      loading: phase === 'loading',
      ready: phase === 'ready' || phase === 'signed-out',
      error,
      generation,
      queryScope: lifecycle.queryScope(),
      currentQueryScope: lifecycle.queryScope,
      isCurrentGeneration,
      refreshUser: async () => {
        await lifecycle.refreshUser();
      },
      retry: () => lifecycle.retry(),
      switchOrganization: (id: string) => lifecycle.switchOrganization(id),
      signOut,
    };
  }, [isCurrentGeneration, lifecycle, lifecycleState, session, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
};
