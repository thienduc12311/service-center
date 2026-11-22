import 'dotenv/config';
import { z } from 'zod';
import { parseTrustProxy } from './lib/trust-proxy.js';
import { optionalSecret } from './lib/optional-secret.js';

/** Problems with optional settings: reported, never fatal (see optionalSecret). */
const configWarnings: string[] = [];
const warn = (message: string): void => {
  configWarnings.push(message);
};

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  /**
   * Proxies in front of the API whose X-Forwarded-For is believed: "false"
   * (default; direct access, local dev), a hop count ("1" behind one load
   * balancer such as Vercel/Render), or proxy addresses/CIDRs.
   */
  TRUST_PROXY: z
    .string()
    .default('false')
    .transform((value, ctx) => {
      try {
        return parseTrustProxy(value);
      } catch (error) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : 'invalid' });
        return z.NEVER;
      }
    }),
  /** Upper bound for any single request the API makes to Supabase (PostgREST, Auth). */
  SUPABASE_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(15_000),
  /** Upper bound for Supabase Storage requests, which move whole files. */
  SUPABASE_STORAGE_TIMEOUT_MS: z.coerce.number().int().min(1000).default(60_000),

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
  /** The super-admin dashboard (admin.graceaogchurch.com), linked from application emails. */
  ADMIN_APP_URL: z.string().url().default('http://localhost:5174'),
  API_URL: z.string().url().default('http://localhost:4000'),
  /**
   * Store listings for the mobile app, linked from invitation emails. Unset
   * (or empty): the badge shows as "Coming soon" and links nowhere.
   */
  IOS_APP_STORE_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  ANDROID_PLAY_STORE_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),

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
   * Empty or shorter than 16 characters counts as unset (with a warning).
   */
  CRON_SECRET: optionalSecret(
    { name: 'CRON_SECRET', isValid: (value) => value.length >= 16, requirement: 'at least 16 characters' },
    warn,
  ),
  /**
   * F08: HMAC key for emailed response-link tokens. Set: a delivery's link
   * token is the same on every attempt, so retries carry an identical
   * payload and the email provider's idempotency key can drop a duplicate
   * (Resend keeps keys for 24 hours). Unset: a fresh random token per attempt
   * and no provider idempotency key. Keep it secret and stable; rotating it
   * only changes tokens minted afterwards (issued links stay valid by hash).
   * Empty or shorter than 32 characters counts as unset (with a warning).
   */
  DELIVERY_LINK_SECRET: optionalSecret(
    { name: 'DELIVERY_LINK_SECRET', isValid: (value) => value.length >= 32, requirement: 'at least 32 characters' },
    warn,
  ),
  /**
   * F17: base64 encoding of 32 random bytes; encrypts webhook signing secrets
   * at rest (AES-256-GCM). Unset: webhooks cannot be registered or sent (the
   * read-only developer API still works). Rotating it makes stored secrets
   * unreadable — affected endpoints fail with `secret_unavailable` and must be
   * registered again. Empty or malformed counts as unset (with a warning).
   */
  INTEGRATION_SECRET_KEY: optionalSecret(
    {
      name: 'INTEGRATION_SECRET_KEY',
      isValid: (value) => Buffer.from(value, 'base64').length === 32,
      requirement: 'base64 of exactly 32 bytes',
    },
    warn,
  ),
  /**
   * F17: allow webhook destinations on loopback/private networks. For local
   * development and tests only; refused in production.
   */
  WEBHOOK_ALLOW_PRIVATE_DESTINATIONS: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /** Read notifications older than this many days are deleted by the scheduled worker. */
  NOTIFICATION_READ_RETENTION_DAYS: z.coerce.number().int().min(1).default(90),
  /** Unread notifications older than this many days are deleted by the scheduled worker. */
  NOTIFICATION_UNREAD_RETENTION_DAYS: z.coerce.number().int().min(1).default(180),
  MAIL_FROM_ADDRESS: z.string().email().default('notifications@example.com'),
  MAIL_FROM_NAME: z.string().default('Service Center'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}\n\nCopy backend/.env.example to backend/.env and fill it in.`);
}

const env = parsed.data;

for (const message of configWarnings) console.warn(message);

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
