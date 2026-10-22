import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { notificationKeys } from '../lib/notification-keys';
import {
  openDeviceNotificationSettings,
  readPushPermission,
  registerForPushNotifications,
  revokePushRegistration,
  setBadgeCount,
  unregisterPushNotifications,
} from '../lib/push';
import { loadBadgePreference, storeBadgePreference } from '../lib/badge-preference-storage';
import {
  DEFAULT_BADGE_PREFERENCE,
  badgeCountFor,
  pushStatus,
  type BadgePreference,
  type PushPermissionSnapshot,
  type PushStatus,
} from '../lib/notification-settings';
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
  /** Unread across the account's organizations — what the app-icon badge shows (when on). */
  accountUnread: number;
  /** True once this device is registered for push. False on a simulator. */
  pushEnabled: boolean;
  /** A registration attempt is in flight. */
  registering: boolean;
  /** The last registration or cleanup failure, if any. */
  registrationError: unknown;
  /** MOB-020: OS permission and how to recover it. */
  push: PushStatus;
  /** MOB-020: this account's app-icon badge choice on this device. */
  badgePreference: BadgePreference;
  /** The badge choice the server applies to pushes; null while not registered. */
  serverShowBadge: boolean | null;
  setBadgePreference: (preference: BadgePreference) => Promise<void>;
  /** Asks the OS (first time) and registers; afterwards re-reads the permission. */
  enablePush: () => Promise<void>;
  /** Retries registration with the current badge choice (no OS prompt unless never asked). */
  retryRegistration: () => Promise<void>;
  openDeviceSettings: () => Promise<void>;
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
  // Read at registration time, so a renewal always sends the latest choice.
  const badgePreferenceRef = useRef<BadgePreference>(DEFAULT_BADGE_PREFERENCE);
  if (!registrationRef.current) {
    registrationRef.current = new DeviceRegistrationLifecycle({
      register: () => registerForPushNotifications(badgePreferenceRef.current === 'unread'),
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
  const accountUnread = unreadQuery.data?.account_unread ?? 0;

  useEffect(() => registration.subscribe(setRegistrationState), [registration]);

  // Account-wide ownership: organization switches deliberately do not rerun
  // this effect. A daily renewal keeps the thirty-day server lease current
  // while the app stays open for an extended period. The account's badge
  // choice is loaded first so the first registration already carries it.
  const userId = session?.user.id ?? null;
  const [badgePreference, setBadgePreferenceState] = useState<BadgePreference>(DEFAULT_BADGE_PREFERENCE);
  useEffect(() => {
    if (!userId) {
      badgePreferenceRef.current = DEFAULT_BADGE_PREFERENCE;
      setBadgePreferenceState(DEFAULT_BADGE_PREFERENCE);
      registration.deactivateWithoutSession();
      return;
    }
    let current = true;
    void loadBadgePreference(userId)
      .catch(() => DEFAULT_BADGE_PREFERENCE)
      .then((preference) => {
        if (!current) return;
        badgePreferenceRef.current = preference;
        setBadgePreferenceState(preference);
        void registration.activate(userId);
      });
    return () => {
      current = false;
    };
  }, [registration, userId]);

  // MOB-020: the OS permission, re-read whenever the app returns to the
  // foreground (for example from the device's Settings app). Turning push on
  // there registers this device without another visit to the screen.
  const [permission, setPermission] = useState<PushPermissionSnapshot | null>(null);
  const refreshPermission = useCallback(async (): Promise<PushPermissionSnapshot | null> => {
    const next = await readPushPermission().catch(() => null);
    setPermission(next);
    return next;
  }, []);
  useEffect(() => {
    void refreshPermission();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshPermission();
    });
    return () => subscription.remove();
  }, [refreshPermission]);
  // Only a change to "granted" (not the first read) registers again; startup
  // registration is the account effect above.
  const previousPermission = useRef<PushPermissionSnapshot['status'] | null>(null);
  useEffect(() => {
    const status = permission?.status ?? null;
    const changedToGranted = previousPermission.current !== null && previousPermission.current !== 'granted' && status === 'granted';
    previousPermission.current = status;
    if (userId && changedToGranted && !registration.getState().pushEnabled) void registration.activate(userId, true);
  }, [permission?.status, registration, userId]);

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

  // The same number pushes put on the icon (account-wide), or 0 when this
  // account turned the badge off on this device.
  const badge = badgeCountFor(badgePreference, unreadQuery.data);
  useEffect(() => {
    void setBadgeCount(badge).catch(() => {
      // Badges are unsupported on some Android launchers; not worth surfacing.
    });
  }, [badge]);

  const setBadgePreference = useCallback(async (preference: BadgePreference): Promise<void> => {
    if (!userId) return;
    badgePreferenceRef.current = preference;
    setBadgePreferenceState(preference);
    await storeBadgePreference(userId, preference);
    // Only an existing registration is renewed: changing the badge never
    // triggers the OS permission prompt.
    if (registration.getState().pushEnabled) await registration.activate(userId, true);
  }, [registration, userId]);

  const enablePush = useCallback(async (): Promise<void> => {
    if (!userId) return;
    await registration.activate(userId, true);
    await refreshPermission();
  }, [refreshPermission, registration, userId]);

  const retryRegistration = useCallback(async (): Promise<void> => {
    if (userId) await registration.activate(userId, true);
  }, [registration, userId]);

  const value = useMemo<NotificationsContextValue>(
    () => ({
      unread,
      accountUnread,
      pushEnabled: registrationState.pushEnabled,
      registering: registrationState.registering,
      registrationError: registrationState.error,
      push: pushStatus(permission),
      badgePreference,
      serverShowBadge: registrationState.showBadge,
      setBadgePreference,
      enablePush,
      retryRegistration,
      openDeviceSettings: openDeviceNotificationSettings,
      refresh: async () => {
        await unreadQuery.refetch();
      },
    }),
    [accountUnread, badgePreference, enablePush, permission, registrationState, retryRegistration, setBadgePreference, unread, unreadQuery],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
};

export const useNotifications = (): NotificationsContextValue => {
  const context = useContext(NotificationsContext);
  if (!context) throw new Error('useNotifications must be used inside <NotificationsProvider>');
  return context;
};
