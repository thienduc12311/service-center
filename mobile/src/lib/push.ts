import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import type { DevicePlatform } from '@service-center/shared';
import { api } from './api';

/**
 * Push registration. Kept out of the React tree so the provider stays a thin
 * lifecycle wrapper around it.
 */
export interface PushRegistration {
  token: string;
  platform: DevicePlatform;
}

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

/**
 * Asks for permission (once — the OS remembers the answer) and registers this
 * device with the API. Returns null when push isn't available: a simulator, a
 * denied prompt, or a project with no EAS id.
 */
export const registerForPushNotifications = async (): Promise<PushRegistration | null> => {
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
  await api.registerDevice({ token, platform, device_name: Device.deviceName });
  return { token, platform };
};

/** Called on sign-out so a shared phone stops receiving the old user's pushes. */
export const unregisterPushNotifications = async (token: string): Promise<void> => {
  await api.unregisterDevice(token);
};

export const setBadgeCount = async (count: number): Promise<void> => {
  await Notifications.setBadgeCountAsync(count);
};
