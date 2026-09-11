const required = (name: string, value: string | undefined): string => {
  if (!value) {
    throw new Error(`Missing ${name}. Copy frontend/.env.example to frontend/.env and fill it in.`);
  }
  return value;
};

export const env = {
  supabaseUrl: required('SUPABASE_URL', import.meta.env.SUPABASE_URL),
  supabaseAnonKey: required('SUPABASE_ANON_KEY', import.meta.env.SUPABASE_ANON_KEY),
  apiUrl: import.meta.env.API_URL ?? 'http://localhost:4000',
};
