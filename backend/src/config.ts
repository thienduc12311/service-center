import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  /**
   * Allow any *.vercel.app origin. Preview deployments get a fresh hostname
   * on every push, so they can never be listed in CORS_ORIGINS. Set this on
   * the preview environment only — never in production.
   */
  CORS_ALLOW_VERCEL_PREVIEWS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  APP_URL: z.string().url().default('http://localhost:5173'),
  API_URL: z.string().url().default('http://localhost:4000'),

  /** Send real push notifications through Expo. Off by default: local runs log instead. */
  PUSH_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /** Only needed once push security is enabled on the Expo project. */
  EXPO_ACCESS_TOKEN: z.string().optional(),

  RESEND_API_KEY: z.string().optional(),

  /**
   * Bearer secret for the delivery worker entry point
   * (`/api/v1/internal/deliveries/run`). Vercel Cron sends it automatically
   * when set under this name. Unset: the entry point answers 404 and only
   * deliveries kicked by API requests (and `npm run worker`) are processed.
   */
  CRON_SECRET: z.string().min(16).optional(),
  /**
   * F08: HMAC key for emailed response-link tokens. Set: a delivery's link
   * token is the same on every attempt, so retries carry an identical
   * payload and the email provider's idempotency key can drop a duplicate
   * (Resend keeps keys for 24 hours). Unset: a fresh random token per attempt
   * and no provider idempotency key. Keep it secret and stable; rotating it
   * only changes tokens minted afterwards (issued links stay valid by hash).
   */
  DELIVERY_LINK_SECRET: z.string().min(32).optional(),
  /**
   * F17: base64 encoding of 32 random bytes; encrypts webhook signing secrets
   * at rest (AES-256-GCM). Unset: webhooks cannot be registered or sent (the
   * read-only developer API still works). Rotating it makes stored secrets
   * unreadable — affected endpoints fail with `secret_unavailable` and must be
   * registered again.
   */
  INTEGRATION_SECRET_KEY: z
    .string()
    .refine((value) => Buffer.from(value, 'base64').length === 32, 'must be base64 of exactly 32 bytes')
    .optional(),
  /**
   * F17: allow webhook destinations on loopback/private networks. For local
   * development and tests only; refused in production.
   */
  WEBHOOK_ALLOW_PRIVATE_DESTINATIONS: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  MAIL_FROM_ADDRESS: z.string().email().default('notifications@example.com'),
  MAIL_FROM_NAME: z.string().default('Service Center'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}\n\nCopy backend/.env.example to backend/.env and fill it in.`);
}

const env = parsed.data;

if (env.NODE_ENV === 'production' && env.WEBHOOK_ALLOW_PRIVATE_DESTINATIONS) {
  throw new Error('WEBHOOK_ALLOW_PRIVATE_DESTINATIONS must not be enabled in production.');
}

export const config = {
  ...env,
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  corsOrigins: env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
  version: '0.1.0',
} as const;
