import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  APP_URL: z.string().url().default('http://localhost:5173'),
  API_URL: z.string().url().default('http://localhost:4000'),

  OCR_PROVIDER: z.enum(['stub', 'gemini', 'openai', 'anthropic']).default('stub'),
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),

  /** Chord sheet imports allowed per admin per day. 0 disables importing. */
  AI_IMPORT_DAILY_LIMIT: z.coerce.number().int().min(0).default(10),

  /** Send real push notifications through Expo. Off by default: local runs log instead. */
  PUSH_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /** Only needed once push security is enabled on the Expo project. */
  EXPO_ACCESS_TOKEN: z.string().optional(),

  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM_ADDRESS: z.string().email().default('notifications@example.com'),
  MAIL_FROM_NAME: z.string().default('Service Center'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}\n\nCopy backend/.env.example to backend/.env and fill it in.`);
}

const env = parsed.data;

export const config = {
  ...env,
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  corsOrigins: env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
  version: '0.1.0',
} as const;
