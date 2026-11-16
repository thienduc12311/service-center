/**
 * Who is signed in, and which step of the admin sign-in they are on:
 *
 *   signed out → password → GET /admin/session
 *     403 not_platform_admin → "Not authorized" (and signed out)
 *     mfa_required           → two-factor step (enroll or enter a code), then aal2
 *     otherwise              → the dashboard
 *
 * Any later call refused with `mfa_required` or `not_platform_admin` (see
 * lib/access-events) sends the admin back to the matching step.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminSession } from '@service-center/shared';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';
import { onAccessProblem } from '../lib/access-events';
import { accessProblemOf, NOT_PLATFORM_ADMIN } from '../lib/errors';
import { adminSessionKey } from '../hooks/queries';

export type AdminAuthStage =
  | { kind: 'loading' }
  | { kind: 'signed_out' }
  | { kind: 'not_authorized'; email: string | null }
  | { kind: 'two_factor'; session: Session; adminSession: AdminSession }
  | { kind: 'ready'; session: Session; adminSession: AdminSession }
  | { kind: 'error'; error: unknown };

export interface AdminAuthContextValue {
  stage: AdminAuthStage;
  /** The signed-in email, once there is a session. */
  email: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** After a two-factor code was verified: ask the API again with the `aal2` session. */
  completeTwoFactor: () => Promise<void>;
  /** Leave the "Not authorized" screen for the sign-in form. */
  dismissNotAuthorized: () => void;
  /** Retry loading the admin session after an error. */
  retry: () => void;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

export interface AdminAuthProviderProps {
  children: ReactNode;
}

export const AdminAuthProvider = ({ children }: AdminAuthProviderProps) => {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  /** Set when the API said this account is not a super admin; survives the sign-out that follows. */
  const [notAuthorized, setNotAuthorized] = useState<{ email: string | null } | null>(null);
  /** Set when a later call said two-factor login is needed again. */
  const [twoFactorForced, setTwoFactorForced] = useState(false);

  useEffect(() => {
    // Fires INITIAL_SESSION first, then every change. Only state is set here:
    // calling Supabase from inside this callback can deadlock its auth lock.
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setSessionLoaded(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;
  const email = session?.user.email ?? null;

  const adminSessionQuery = useQuery<AdminSession>({
    queryKey: adminSessionKey(userId ?? 'signed-out'),
    queryFn: () => api.adminSession(),
    enabled: userId !== null,
    staleTime: Infinity,
    retry: false,
  });

  const signOut = useCallback(async () => {
    setTwoFactorForced(false);
    const { error } = await supabase.auth.signOut();
    queryClient.clear();
    if (error) {
      // The local session is gone even when the server call fails; drop it from the UI too.
      setSession(null);
    }
  }, [queryClient]);

  const refuse = useCallback(
    (refusedEmail: string | null) => {
      setNotAuthorized({ email: refusedEmail });
      void signOut();
    },
    [signOut],
  );

  // GET /admin/session itself refused: not a super admin.
  useEffect(() => {
    if (accessProblemOf(adminSessionQuery.error) === NOT_PLATFORM_ADMIN) refuse(email);
  }, [adminSessionQuery.error, email, refuse]);

  // Any other call refused later on.
  useEffect(
    () =>
      onAccessProblem((problem) => {
        if (problem === NOT_PLATFORM_ADMIN) {
          refuse(email);
          return;
        }
        setTwoFactorForced(true);
        if (userId) void queryClient.invalidateQueries({ queryKey: adminSessionKey(userId) });
      }),
    [email, userId, queryClient, refuse],
  );

  const signIn = useCallback(async (signInEmail: string, password: string) => {
    setNotAuthorized(null);
    const { error } = await supabase.auth.signInWithPassword({ email: signInEmail, password });
    if (error) throw error;
  }, []);

  const completeTwoFactor = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const nextUserId = data.session?.user.id;
    if (!nextUserId) return;
    const adminSession = await queryClient.fetchQuery({
      queryKey: adminSessionKey(nextUserId),
      queryFn: () => api.adminSession(),
      staleTime: 0,
    });
    if (!adminSession.mfa_required) setTwoFactorForced(false);
  }, [queryClient]);

  const dismissNotAuthorized = useCallback(() => setNotAuthorized(null), []);

  const { refetch } = adminSessionQuery;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  const stage = useMemo<AdminAuthStage>(() => {
    if (notAuthorized) return { kind: 'not_authorized', email: notAuthorized.email };
    if (!sessionLoaded) return { kind: 'loading' };
    if (!session) return { kind: 'signed_out' };
    if (adminSessionQuery.isError) {
      return accessProblemOf(adminSessionQuery.error) === NOT_PLATFORM_ADMIN
        ? { kind: 'not_authorized', email }
        : { kind: 'error', error: adminSessionQuery.error };
    }
    const adminSession = adminSessionQuery.data;
    if (!adminSession) return { kind: 'loading' };
    if (adminSession.mfa_required || twoFactorForced) return { kind: 'two_factor', session, adminSession };
    return { kind: 'ready', session, adminSession };
  }, [
    notAuthorized,
    sessionLoaded,
    session,
    email,
    adminSessionQuery.isError,
    adminSessionQuery.error,
    adminSessionQuery.data,
    twoFactorForced,
  ]);

  const value = useMemo<AdminAuthContextValue>(
    () => ({ stage, email, signIn, signOut, completeTwoFactor, dismissNotAuthorized, retry }),
    [stage, email, signIn, signOut, completeTwoFactor, dismissNotAuthorized, retry],
  );

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
};

export const useAdminAuth = (): AdminAuthContextValue => {
  const value = useContext(AdminAuthContext);
  if (!value) throw new Error('useAdminAuth must be used inside AdminAuthProvider');
  return value;
};
