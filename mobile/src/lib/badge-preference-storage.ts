import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseBadgePreference, type BadgePreference } from './notification-settings';

/**
 * MOB-020: the app-icon badge choice, per account on this device (a shared
 * phone keeps each person's choice). The server copy on the device
 * registration is what pushes obey; this copy is what the next registration sends.
 */
const badgeKey = (userId: string): string => `service-center.badge-preference.${userId}`;

export const loadBadgePreference = async (userId: string): Promise<BadgePreference> =>
  parseBadgePreference(await AsyncStorage.getItem(badgeKey(userId)));

export const storeBadgePreference = async (userId: string, preference: BadgePreference): Promise<void> => {
  await AsyncStorage.setItem(badgeKey(userId), preference);
};
