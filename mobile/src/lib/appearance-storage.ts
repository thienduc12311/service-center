import AsyncStorage from '@react-native-async-storage/async-storage';
import { APPEARANCE_STORAGE_KEY, parseAppearanceMode, type AppearanceMode } from '@service-center/shared';

/**
 * MOB-021: the light/dark/system choice for this device, under the website's
 * key and with its meaning (absent = system). Not per account: it is how the
 * device looks, so it is kept across sign-out like the website's entry.
 */
export const loadAppearanceMode = async (): Promise<AppearanceMode> =>
  parseAppearanceMode(await AsyncStorage.getItem(APPEARANCE_STORAGE_KEY));

export const storeAppearanceMode = async (mode: AppearanceMode): Promise<void> => {
  if (mode === 'system') await AsyncStorage.removeItem(APPEARANCE_STORAGE_KEY);
  else await AsyncStorage.setItem(APPEARANCE_STORAGE_KEY, mode);
};
