import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { notificationKeys } from '../lib/notification-keys';
import {
  registerForPushNotifications,
  setBadgeCount,
  unregisterPushNotifications,
} from '../lib/push';
import { useAuth } from './AuthProvider';

interface NotificationsContextValue {
  /** Unread in the active organization — what the bell's badge shows. */
  unread: number;
  /** True once this device is registered for push. False on a simulator. */
  pushEnabled: boolean;
  refresh: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

/** How often the badge re-checks while the app is open. */
const POLL_INTERVAL_MS = 60_000;

/**
 * Owns everything that is true app-wide about notifications: the unread count
 * behind the bell, this device's push registration, and what happens when a
 * push is tapped.
 */
export const NotificationsProvider = ({ children }: { children: ReactNode }) => {
  const { session, organizationId } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [pushToken, setPushToken] = useState<string | null>(null);
  // Survives the effect cleanup that runs when the session ends, so the token
  // can still be handed back to the API on sign-out.
  const tokenRef = useRef<string | null>(null);

  const unreadQuery = useQuery({
    queryKey: notificationKeys.unread(organizationId),
    queryFn: () => api.unreadNotificationCount(),
    enabled: Boolean(session && organizationId),
    refetchInterval: POLL_INTERVAL_MS,
  });

  const unread = unreadQuery.data?.unread ?? 0;

  // Register once per signed-in session; the OS remembers the permission.
  useEffect(() => {
    if (!session) return;
    let active = true;

    void registerForPushNotifications()
      .then((registration) => {
        if (!active || !registration) return;
        tokenRef.current = registration.token;
        setPushToken(registration.token);
      })
      .catch((error) => console.warn('Could not register for push notifications', error));

    return () => {
      active = false;
    };
  }, [session]);

  // Hand the token back when the session ends, so the next person to sign in
  // on this phone doesn't inherit the previous user's notifications.
  useEffect(() => {
    if (session || !tokenRef.current) return;
    const token = tokenRef.current;
    tokenRef.current = null;
    setPushToken(null);
    void unregisterPushNotifications(token).catch(() => {
      // Signed out already — the server rejects the call, and the row is
      // harmless until the next registration replaces it.
    });
  }, [session]);

  const invalidate = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: notificationKeys.all });
  }, [queryClient]);

  // A push that lands while the app is open should move the badge straight
  // away rather than waiting for the next poll.
  useEffect(() => {
    const received = Notifications.addNotificationReceivedListener(() => {
      void invalidate();
    });
    const tapped = Notifications.addNotificationResponseReceivedListener(() => {
      void invalidate();
      router.push('/notifications');
    });
    return () => {
      received.remove();
      tapped.remove();
    };
  }, [invalidate, router]);

  useEffect(() => {
    void setBadgeCount(unread).catch(() => {
      // Badges are unsupported on some Android launchers; not worth surfacing.
    });
  }, [unread]);

  const value = useMemo<NotificationsContextValue>(
    () => ({
      unread,
      pushEnabled: pushToken !== null,
      refresh: async () => {
        await unreadQuery.refetch();
      },
    }),
    [unread, pushToken, unreadQuery],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
};

export const useNotifications = (): NotificationsContextValue => {
  const context = useContext(NotificationsContext);
  if (!context) throw new Error('useNotifications must be used inside <NotificationsProvider>');
  return context;
};
