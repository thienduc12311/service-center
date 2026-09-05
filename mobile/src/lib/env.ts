import Constants from 'expo-constants';

/**
 * EXPO_PUBLIC_* env vars win; app.json `extra` is the fallback so the app still
 * runs from a plain `expo start` with no .env file.
 */
const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string | undefined>;

const read = (envValue: string | undefined, extraKey: string, fallback = ''): string =>
  envValue ?? extra[extraKey] ?? fallback;

export const env = {
  supabaseUrl: read(process.env.EXPO_PUBLIC_SUPABASE_URL, 'supabaseUrl'),
  supabaseAnonKey: read(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY, 'supabaseAnonKey'),
  apiUrl: read(process.env.EXPO_PUBLIC_API_URL, 'apiUrl', 'http://localhost:4000'),
};
