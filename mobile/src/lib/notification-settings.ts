import type {
  DeliveryChannel,
  ReminderPreferences,
  UnreadNotificationCount,
  UpdateReminderPreferencesInput,
} from '@service-center/shared';

/**
 * MOB-020: pure rules behind the native notification settings. OS permission,
 * the app-icon badge, reminder channels (F08) and chat mute (F09) are four
 * separate choices; none of them implies another.
 */

/** The app-icon badge: the account-wide unread count, or nothing. A device choice. */
export type BadgePreference = 'unread' | 'off';

export const BADGE_PREFERENCES: readonly BadgePreference[] = ['unread', 'off'];

export const DEFAULT_BADGE_PREFERENCE: BadgePreference = 'unread';

export const parseBadgePreference = (value: unknown): BadgePreference =>
  value === 'off' ? 'off' : DEFAULT_BADGE_PREFERENCE;

/**
 * What the app puts on its icon. Uses `account_unread`, the same number the
 * push dispatcher sends, so the badge does not change meaning between a push
 * arriving in the background and the app opening on another organization.
 */
export const badgeCountFor = (
  preference: BadgePreference,
  counts: UnreadNotificationCount | undefined,
): number => (preference === 'off' ? 0 : Math.max(0, counts?.account_unread ?? 0));

/**
 * Whether the server has the device's badge choice. `deviceOnly` when push is
 * not registered (nothing is sent to this device, so only the local badge applies).
 */
export type BadgeSync = 'saved' | 'pending' | 'deviceOnly';

export const badgeSync = (preference: BadgePreference, serverShowBadge: boolean | null): BadgeSync => {
  if (serverShowBadge === null) return 'deviceOnly';
  return serverShowBadge === (preference === 'unread') ? 'saved' : 'pending';
};

/** What the OS reports, reduced to what the screen needs. */
export interface PushPermissionSnapshot {
  /** False on a simulator/emulator: no remote push at all. */
  isDevice: boolean;
  /** False when this build has no EAS project id, so no push token can be minted. */
  pushConfigured: boolean;
  status: 'granted' | 'denied' | 'undetermined';
  canAskAgain: boolean;
}

export type PushPermissionState = 'granted' | 'undetermined' | 'denied' | 'unavailable';

/** `request` asks the OS (the prompt appears once); `openSettings` is the only way back after a refusal. */
export type PushRecovery = 'none' | 'request' | 'openSettings';

export interface PushStatus {
  state: PushPermissionState;
  recovery: PushRecovery;
}

export const pushStatus = (snapshot: PushPermissionSnapshot | null): PushStatus => {
  if (!snapshot) return { state: 'undetermined', recovery: 'none' };
  if (!snapshot.isDevice || !snapshot.pushConfigured) return { state: 'unavailable', recovery: 'none' };
  if (snapshot.status === 'granted') return { state: 'granted', recovery: 'none' };
  // Android reports "denied" before the first prompt on some versions; canAskAgain tells them apart.
  if (snapshot.status === 'undetermined' || snapshot.canAskAgain) return { state: 'undetermined', recovery: 'request' };
  return { state: 'denied', recovery: 'openSettings' };
};

export const REMINDER_CHANNELS: readonly DeliveryChannel[] = ['in_app', 'push', 'email'];

/** The full body `updateMyReminderPreferences` takes, with one channel changed. */
export const reminderPreferencesInput = (
  current: ReminderPreferences,
  channel: DeliveryChannel,
  enabled: boolean,
): UpdateReminderPreferencesInput => ({
  email: current.email,
  push: current.push,
  in_app: current.in_app,
  [channel]: enabled,
});

export const noReminderChannels = (preferences: ReminderPreferences): boolean =>
  !preferences.email && !preferences.push && !preferences.in_app;

/** Push reminders are allowed but this device cannot receive them (other devices still may). */
export const pushRemindersMissThisDevice = (preferences: ReminderPreferences, pushEnabled: boolean): boolean =>
  preferences.push && !pushEnabled;
