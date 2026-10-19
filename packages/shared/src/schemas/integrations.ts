import { z } from 'zod';
import { uuid } from './common.js';

export const apiScopeSchema = z.enum(['plans.read', 'songs.read']);
export const webhookEventTypeSchema = z.enum(['plan.published', 'plan.unpublished', 'plan.deleted']);

/** Matches the database bound (100) on stored request keys. */
const integrationKey = z.string().trim().min(8).max(100);

export const createApiCredentialSchema = z.object({
  name: z.string().trim().min(1, 'Name the credential').max(80),
  scopes: z.array(apiScopeSchema).min(1, 'Choose at least one scope').max(2),
  /** ISO instant; omitted or null = no expiry. */
  expires_at: z.string().datetime({ offset: true }).nullish(),
  rate_limit_per_minute: z.number().int().min(1).max(600).default(60),
  idempotency_key: integrationKey,
});

const PRIVATE_HOST =
  /^(localhost|.*\.localhost|.*\.local|.*\.internal|0\.0\.0\.0|\[?::1?\]?|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/i;

/**
 * Syntactic checks a browser can run. The server re-validates and resolves
 * the host at registration and at every send (see the destination guard).
 */
export const webhookUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .url('Enter a full URL')
  .superRefine((value, ctx) => {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Use an https:// URL' });
    }
    if (url.username || url.password) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Credentials in the URL are not allowed' });
    }
    if (url.hash) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Remove the #fragment' });
    }
  });

/** True for a host that can never be a public webhook destination. */
export const isPrivateWebhookHost = (hostname: string): boolean => PRIVATE_HOST.test(hostname);

export const createWebhookEndpointSchema = z.object({
  url: webhookUrlSchema,
  description: z.string().trim().max(200).nullish(),
  event_types: z.array(webhookEventTypeSchema).min(1, 'Choose at least one event').max(3),
  idempotency_key: integrationKey,
});

export const setWebhookEnabledSchema = z.object({
  enabled: z.boolean(),
  expected_revision: z.number().int().min(1),
});

export const webhookDeliveriesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

// ======================================================= external API v1

const cursor = z.string().trim().min(1).max(200);
const pageLimit = z.coerce.number().int().min(1).max(100).default(50);

export const externalPageQuerySchema = z.object({ cursor: cursor.optional(), limit: pageLimit });

export const externalPlansQuerySchema = z
  .object({
    /** ISO instants; the range is half-open [from, to) and at most 366 days. */
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    service_type_id: uuid.optional(),
    cursor: cursor.optional(),
    limit: pageLimit,
  })
  .refine((query) => Date.parse(query.to) > Date.parse(query.from), { message: '`to` must be after `from`', path: ['to'] })
  .refine((query) => Date.parse(query.to) - Date.parse(query.from) <= 366 * 86_400_000, {
    message: 'The range can cover at most 366 days',
    path: ['to'],
  });

export const externalSongsQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  cursor: cursor.optional(),
  limit: pageLimit,
});

export type CreateApiCredentialInput = z.infer<typeof createApiCredentialSchema>;
export type CreateApiCredentialRequest = z.input<typeof createApiCredentialSchema>;
export type CreateWebhookEndpointInput = z.infer<typeof createWebhookEndpointSchema>;
export type SetWebhookEnabledInput = z.infer<typeof setWebhookEnabledSchema>;
export type WebhookDeliveriesQuery = z.infer<typeof webhookDeliveriesQuerySchema>;
export type ExternalPageQuery = z.infer<typeof externalPageQuerySchema>;
export type ExternalPlansQuery = z.infer<typeof externalPlansQuerySchema>;
export type ExternalSongsQuery = z.infer<typeof externalSongsQuerySchema>;
