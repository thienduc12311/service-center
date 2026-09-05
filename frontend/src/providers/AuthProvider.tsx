import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { canManage, type CurrentUser, type OrgRole } from '@service-center/shared';
import { supabase } from '../lib/supabase';
import { api, getStoredOrganizationId, setStoredOrganizationId } from '../lib/api';

interface AuthContextValue {
  session: Session | null;
  user: CurrentUser | null;
  organizationId: string | null;
  role: OrgRole | null;
  canManage: boolean;
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

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (!data.session) setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) {
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
  }, []);

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

    setLoading(true);
    loadUser()
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
