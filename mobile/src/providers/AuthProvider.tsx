import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { canManage, type CurrentUser, type OrgRole } from '@service-center/shared';
import { supabase } from '../lib/supabase';
import { api, getOrganizationId, hydrateOrganizationId, setOrganizationId } from '../lib/api';

interface AuthContextValue {
  session: Session | null;
  user: CurrentUser | null;
  organizationId: string | null;
  role: OrgRole | null;
  canManage: boolean;
  loading: boolean;
  refreshUser: () => Promise<void>;
  switchOrganization: (id: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [organizationId, setOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    void (async () => {
      await hydrateOrganizationId();
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setOrgId(getOrganizationId());
      setSession(data.session);
      if (!data.session) setLoading(false);
    })();

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) {
        setUser(null);
        setOrgId(null);
        void setOrganizationId(null);
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

    const stored = getOrganizationId();
    const valid = current.memberships.some((m) => m.organization.id === stored);
    const next = valid ? stored : (current.memberships[0]?.organization.id ?? null);

    await setOrganizationId(next);
    setOrgId(next);
  }, []);

  useEffect(() => {
    if (!session) return;
    let active = true;
    setLoading(true);

    loadUser()
      .catch((error) => console.warn('Could not load the current user', error))
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [session, loadUser]);

  const value = useMemo<AuthContextValue>(() => {
    const role = user?.memberships.find((m) => m.organization.id === organizationId)?.role ?? null;
    return {
      session,
      user,
      organizationId,
      role,
      canManage: canManage(role),
      loading,
      refreshUser: loadUser,
      switchOrganization: async (id: string) => {
        await setOrganizationId(id);
        setOrgId(id);
        await loadUser();
      },
      signOut: async () => {
        await supabase.auth.signOut();
      },
    };
  }, [session, user, organizationId, loading, loadUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
};
