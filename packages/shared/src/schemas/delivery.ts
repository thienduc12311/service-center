import { z } from 'zod';
import { idempotencyKey, uuid } from './common.js';

export const deliveryChannelSchema = z.enum(['in_app', 'push', 'email']);
export const deliveryStatusSchema = z.enum([
  'queued',
  'sending',
  'simulated',
  'provider_accepted',
  'delivered',
  'failed',
  'ambiguous',
  'skipped',
  'cancelled',
]);

/** Re-send requests to everyone on a plan who hasn't answered. */
export const notifyPlanSchema = z.object({
  idempotency_key: idempotencyKey.optional(),
});

/** Administrator outcome list: newest first, bounded, cursor by `before`. */
export const listDeliveriesQuerySchema = z.object({
  status: deliveryStatusSchema.optional(),
  channel: deliveryChannelSchema.optional(),
  plan_id: uuid.optional(),
  /** Only deliveries an administrator could act on (failed or ambiguous). */
  needs_attention: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .default(false),
  before: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Bounded worker run, for a scheduler (cron) or a manual invocation. */
export const runDeliveryWorkerSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type NotifyPlanInput = z.infer<typeof notifyPlanSchema>;
export type ListDeliveriesQuery = z.infer<typeof listDeliveriesQuerySchema>;
/** What a client sends; defaults are applied by the server. */
export type ListDeliveriesRequest = z.input<typeof listDeliveriesQuerySchema>;
export type RunDeliveryWorkerInput = z.infer<typeof runDeliveryWorkerSchema>;
