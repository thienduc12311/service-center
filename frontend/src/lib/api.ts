import { ServiceCenterApi } from '@service-center/shared';
import { supabase } from './supabase';
import { env } from './env';

const ORG_STORAGE_KEY = 'service-center.organization-id';

export const getStoredOrganizationId = (): string | null =>
  localStorage.getItem(ORG_STORAGE_KEY);

export const setStoredOrganizationId = (id: string | null): void => {
  if (id) localStorage.setItem(ORG_STORAGE_KEY, id);
  else localStorage.removeItem(ORG_STORAGE_KEY);
};

/**
 * A single client instance. It reads the token from Supabase on every request
 * so a refreshed session is picked up without rebuilding the client.
 */
export const api = new ServiceCenterApi({
  baseUrl: env.apiUrl,
  getAccessToken: async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
  getOrganizationId: getStoredOrganizationId,
  onUnauthorized: () => {
    void supabase.auth.signOut();
  },
});
