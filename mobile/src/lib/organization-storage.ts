import AsyncStorage from '@react-native-async-storage/async-storage';

const LEGACY_ORGANIZATION_KEY = 'service-center.organization-id';
const organizationKey = (userId: string): string =>
  `service-center.organization-id.${userId}`;

export const loadStoredOrganizationId = async (userId: string): Promise<string | null> => {
  // The old global value could belong to a different account on a shared device.
  await AsyncStorage.removeItem(LEGACY_ORGANIZATION_KEY);
  return AsyncStorage.getItem(organizationKey(userId));
};

export const storeOrganizationId = async (
  userId: string,
  organizationId: string | null,
): Promise<void> => {
  const key = organizationKey(userId);
  if (organizationId) await AsyncStorage.setItem(key, organizationId);
  else await AsyncStorage.removeItem(key);
};
