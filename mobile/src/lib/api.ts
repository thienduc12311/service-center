import AsyncStorage from '@react-native-async-storage/async-storage';
import { ServiceCenterApi } from '@service-center/shared';
import { supabase } from './supabase';
import { env } from './env';

const ORG_KEY = 'service-center.organization-id';

/**
 * AsyncStorage is async but the API client needs the org id synchronously, so
 * it is mirrored in memory and hydrated once at startup.
 */
let organizationId: string | null = null;

export const hydrateOrganizationId = async (): Promise<string | null> => {
  organizationId = await AsyncStorage.getItem(ORG_KEY);
  return organizationId;
};

export const setOrganizationId = async (id: string | null): Promise<void> => {
  organizationId = id;
  if (id) await AsyncStorage.setItem(ORG_KEY, id);
  else await AsyncStorage.removeItem(ORG_KEY);
};

export const getOrganizationId = (): string | null => organizationId;

export const api = new ServiceCenterApi({
  baseUrl: env.apiUrl,
  getAccessToken: async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
  getOrganizationId,
  onUnauthorized: () => {
    void supabase.auth.signOut();
  },
});
