const required = (name: string, value: string | undefined): string => {
  if (!value) {
    throw new Error(`Missing ${name}. Copy frontend/.env.example to frontend/.env and fill it in.`);
  }
  return value;
};

export const env = {
  supabaseUrl: required('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL),
  supabaseAnonKey: required('VITE_SUPABASE_ANON_KEY', import.meta.env.VITE_SUPABASE_ANON_KEY),
  apiUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:4000',
};
