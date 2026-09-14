import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { canManage, isAdmin, type CurrentUser, type OrgRole } from '@service-center/shared';
import { supabase } from '../lib/supabase';
import { api, getStoredOrganizationId, setStoredOrganizationId } from '../lib/api';

interface AuthContextValue {
  session: Session | null;
  user: CurrentUser | null;
  organizationId: string | null;
  role: OrgRole | null;
  canManage: boolean;
  /** Owners and admins: membership, org settings and AI chord sheet imports. */
  isAdmin: boolean;
  loading: boolean;
  switchOrganization: (id: string) => void;
  refreshUser: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(getStoredOrganizationId());
  const [loading, setLoading] = useState(true);
  /** Whether a user has loaded at least once, so revalidation can stay quiet. */
  const loadedOnce = useRef(false);

  /**
   * Supabase re-emits `SIGNED_IN` every time the tab becomes visible again,
   * handing back a fresh object that carries the same token. Storing that as a
   * new session would restart the load below and throw the whole authenticated
   * tree back to the sign-in spinner, so only a genuine change of token or
   * signed-in user counts as a new session.
   */
  const applySession = useCallback((next: Session | null) => {
    setSession((current) =>
      current?.access_token === next?.access_token && current?.user.id === next?.user.id
        ? current
        : next,
    );
  }, []);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      applySession(data.session);
      if (!data.session) setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      applySession(next);
      if (!next) {
        loadedOnce.current = false;
        setUser(null);
        setOrganizationId(null);
        setStoredOrganizationId(null);
        setLoading(false);
      }
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [applySession]);

  const loadUser = useCallback(async () => {
    const current = await api.me();
    setUser(current);

    // Fall back to the first membership when nothing is stored, or when the
    // stored organization is one the user no longer belongs to.
    const stored = getStoredOrganizationId();
    const valid = current.memberships.some((m) => m.organization.id === stored);
    const next = valid ? stored : (current.memberships[0]?.organization.id ?? null);

    setOrganizationId(next);
    setStoredOrganizationId(next);
  }, []);

  useEffect(() => {
    if (!session) return;
    let active = true;

    // Only the first load blocks the UI. When the token is later refreshed the
    // user is revalidated in the background, so a mid-session refresh does not
    // blank the page the person is working on.
    if (!loadedOnce.current) setLoading(true);

    loadUser()
      .then(() => {
        loadedOnce.current = true;
      })
      .catch((error) => {
        console.error('Could not load the current user', error);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [session, loadUser]);

  const switchOrganization = useCallback((id: string) => {
    setStoredOrganizationId(id);
    setOrganizationId(id);
    // A full reload is the simplest way to guarantee no cached query from the
    // previous organization leaks into the new one.
    window.location.reload();
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const role = user?.memberships.find((m) => m.organization.id === organizationId)?.role ?? null;
    return {
      session,
      user,
      organizationId,
      role,
      canManage: canManage(role),
      isAdmin: isAdmin(role),
      loading,
      switchOrganization,
      refreshUser: loadUser,
      signOut: async () => {
        await supabase.auth.signOut();
      },
    };
  }, [session, user, organizationId, loading, switchOrganization, loadUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
};
