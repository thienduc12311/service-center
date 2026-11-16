import { createClient } from '@supabase/supabase-js';
import type { Database } from '@service-center/shared';
import { env } from './env';

/** Same Supabase auth project and accounts as the main app; no sign-up or magic links here. */
export const supabase = createClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
