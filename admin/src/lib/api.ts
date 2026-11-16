import { ServiceCenterApi } from '@service-center/shared';
import { supabase } from './supabase';
import { env } from './env';

/**
 * One client for the whole app. It reads the token from Supabase on every
 * request (so a refreshed or newly `aal2` session is picked up) and never
 * sends an organization id: admin routes are platform-wide.
 */
export const api = new ServiceCenterApi({
  baseUrl: env.apiUrl,
  getAccessToken: async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
  onUnauthorized: () => {
    void supabase.auth.signOut();
  },
});
