import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import * as Notifications from 'expo-notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { notificationKeys } from '../lib/notification-keys';
import {
  registerForPushNotifications,
  revokePushRegistration,
  setBadgeCount,
  unregisterPushNotifications,
} from '../lib/push';
import {
  DeviceRegistrationLifecycle,
  setDeviceSignOutHandler,
  setDeviceSignOutRecoveryHandler,
  type DeviceRegistrationState,
} from '../lib/device-registration-lifecycle';
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
const DEVICE_REGISTRATION_TIMEOUT_MS = 2_000;
const DEVICE_REGISTRATION_RENEW_MS = 24 * 60 * 60 * 1000;

/**
 * Owns everything that is true app-wide about notifications: the unread count
 * behind the bell, this device's push registration, and what happens when a
 * push is tapped.
 */
export const NotificationsProvider = ({ children }: { children: ReactNode }) => {
  const { session, queryScope } = useAuth();
  const queryClient = useQueryClient();
  const registrationRef = useRef<DeviceRegistrationLifecycle | null>(null);
  if (!registrationRef.current) {
    registrationRef.current = new DeviceRegistrationLifecycle({
      register: registerForPushNotifications,
      unregisterAuthenticated: unregisterPushNotifications,
      revoke: revokePushRegistration,
      resetBadge: () => setBadgeCount(0),
      timeoutMs: DEVICE_REGISTRATION_TIMEOUT_MS,
    });
  }
  const registration = registrationRef.current;
  const [registrationState, setRegistrationState] = useState<DeviceRegistrationState>(
    registration.getState,
  );

  const unreadQuery = useQuery({
    queryKey: notificationKeys.unread(queryScope),
    queryFn: () => api.unreadNotificationCount(),
    enabled: Boolean(queryScope),
    refetchInterval: POLL_INTERVAL_MS,
  });

  const unread = unreadQuery.data?.unread ?? 0;

  useEffect(() => registration.subscribe(setRegistrationState), [registration]);

  // Account-wide ownership: organization switches deliberately do not rerun
  // this effect. A daily renewal keeps the thirty-day server lease current
  // while the app stays open for an extended period.
  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (userId) void registration.activate(userId);
    else registration.deactivateWithoutSession();
  }, [registration, userId]);

  useEffect(() => {
    if (!userId) return;
    const timer = setInterval(() => {
      void registration.activate(userId, true);
    }, DEVICE_REGISTRATION_RENEW_MS);
    return () => clearInterval(timer);
  }, [registration, userId]);

  useEffect(() => {
    setDeviceSignOutHandler(() => registration.prepareForSignOut());
    setDeviceSignOutRecoveryHandler(async () => {
      if (userId) await registration.recoverAfterFailedSignOut(userId);
    });
    return () => {
      setDeviceSignOutHandler(null);
      setDeviceSignOutRecoveryHandler(null);
    };
  }, [registration, userId]);

  useEffect(() => {
    if (registrationState.error) {
      console.warn('[push] device registration or cleanup failed', registrationState.error);
    }
  }, [registrationState.error]);

  const invalidate = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: notificationKeys.all(queryScope) });
  }, [queryClient, queryScope]);

  // A push that lands while the app is open should move the badge straight
  // away rather than waiting for the next poll.
  useEffect(() => {
    const received = Notifications.addNotificationReceivedListener(() => {
      void invalidate();
    });
    const tapped = Notifications.addNotificationResponseReceivedListener(() => {
      void invalidate();
    });
    return () => {
      received.remove();
      tapped.remove();
    };
  }, [invalidate]);

  useEffect(() => {
    void setBadgeCount(unread).catch(() => {
      // Badges are unsupported on some Android launchers; not worth surfacing.
    });
  }, [unread]);

  const value = useMemo<NotificationsContextValue>(
    () => ({
      unread,
      pushEnabled: registrationState.pushEnabled,
      refresh: async () => {
        await unreadQuery.refetch();
      },
    }),
    [registrationState.pushEnabled, unread, unreadQuery],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
};

export const useNotifications = (): NotificationsContextValue => {
  const context = useContext(NotificationsContext);
  if (!context) throw new Error('useNotifications must be used inside <NotificationsProvider>');
  return context;
};
