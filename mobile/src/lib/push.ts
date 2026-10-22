import { Linking, Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import type { DevicePlatform, DeviceRegistration } from '@service-center/shared';
import { api } from './api';
import type { PushPermissionSnapshot } from './notification-settings';

/**
 * Push registration. Kept out of the React tree so the provider stays a thin
 * lifecycle wrapper around it.
 */
const ANDROID_CHANNEL_ID = 'default';

/** Foreground behaviour: a banner, matching what people expect from the OS. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const devicePlatform = (): DevicePlatform => {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return 'web';
};

/**
 * Expo needs the EAS project id to mint a push token in a bare/dev-client
 * build. It is absent until the project is linked to EAS, in which case push
 * is simply unavailable and the in-app feed still works.
 */
const projectId = (): string | undefined =>
  Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

/** MOB-020: the OS permission as it is now, without prompting. */
export const readPushPermission = async (): Promise<PushPermissionSnapshot> => {
  const permission = await Notifications.getPermissionsAsync();
  return {
    isDevice: Device.isDevice,
    pushConfigured: Boolean(projectId()),
    status: permission.granted ? 'granted' : permission.status === 'undetermined' ? 'undetermined' : 'denied',
    canAskAgain: permission.canAskAgain,
  };
};

/** After a refusal the OS never prompts again; only its settings screen can turn push back on. */
export const openDeviceNotificationSettings = async (): Promise<void> => {
  await Linking.openSettings();
};

/**
 * Asks for permission (once — the OS remembers the answer) and registers this
 * device with the API. Returns null when push isn't available: a simulator, a
 * denied prompt, or a project with no EAS id. `showBadge` (MOB-020) tells the
 * server whether pushes may set the app-icon badge on this device.
 */
export const registerForPushNotifications = async (showBadge: boolean): Promise<DeviceRegistration | null> => {
  if (!Device.isDevice) return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'Schedule updates',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  const granted =
    existing.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return null;

  const id = projectId();
  if (!id) return null;

  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
  const platform = devicePlatform();
  return api.registerDevice({ token, platform, device_name: Device.deviceName, show_badge: showBadge });
};

/** Called on sign-out so a shared phone stops receiving the old user's pushes. */
export const unregisterPushNotifications = async (token: string): Promise<void> => {
  await api.unregisterDevice(token);
};

/** Auth-independent cleanup for a late registration or expired session. */
export const revokePushRegistration = async (
  registration: DeviceRegistration,
): Promise<void> => {
  await api.revokeDeviceRegistration({
    token: registration.token,
    revocation_secret: registration.revocation_secret,
  });
};

export const setBadgeCount = async (count: number): Promise<void> => {
  await Notifications.setBadgeCountAsync(count);
};
