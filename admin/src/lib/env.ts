/** Build-time configuration, read once. Every value is public: Vite embeds it in the bundle. */
export interface AdminEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
  apiUrl: string;
  /** The main Service Center web app, for "Open in Service Center" links. */
  appUrl: string;
}

const required = (name: string, value: string | undefined): string => {
  if (!value) {
    throw new Error(`Missing ${name}. Copy admin/.env.example to admin/.env and fill it in.`);
  }
  return value;
};

export const env: AdminEnv = {
  supabaseUrl: required('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL),
  supabaseAnonKey: required('VITE_SUPABASE_ANON_KEY', import.meta.env.VITE_SUPABASE_ANON_KEY),
  apiUrl: import.meta.env.VITE_API_URL || 'http://localhost:4000',
  appUrl: import.meta.env.VITE_APP_URL || 'http://localhost:5173',
};
