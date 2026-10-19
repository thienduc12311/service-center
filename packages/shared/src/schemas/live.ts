import { z } from 'zod';
import { idempotencyKey, isoDateTime, uuid } from './common.js';

export const liveCountdownPolicySchema = z.enum(['item', 'planned_end', 'service_end']);

/** One browser tab / device session; the lease belongs to user + client. */
export const liveClientIdSchema = z.string().trim().min(1).max(100);
/** Durable per-command id: a retried command is answered, never applied twice. */
export const liveActionIdSchema = z.string().trim().min(1).max(200);
const liveReason = z.string().trim().min(1, 'Give a reason').max(500, 'Keep the reason under 500 characters');
const revision = z.number().int().min(0);

export const createLiveRunSchema = z.object({
  plan_time_id: uuid,
  countdown_policy: liveCountdownPolicySchema.default('item'),
  idempotency_key: idempotencyKey,
  client_id: liveClientIdSchema,
});

const command = { client_id: liveClientIdSchema, action_id: liveActionIdSchema, expected_revision: revision };

export const liveRunActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), ...command }),
  z.object({ action: z.literal('advance'), ...command }),
  z.object({ action: z.literal('jump'), ...command, target_index: z.number().int().min(0) }),
  z.object({ action: z.literal('pause'), ...command }),
  z.object({ action: z.literal('resume'), ...command }),
  z.object({ action: z.literal('end'), ...command }),
  z.object({ action: z.literal('take_control'), ...command }),
  z.object({ action: z.literal('take_over'), ...command, reason: liveReason.optional() }),
  z.object({ action: z.literal('release_control'), ...command }),
  z.object({ action: z.literal('set_policy'), ...command, countdown_policy: liveCountdownPolicySchema }),
  z.object({ action: z.literal('refresh_snapshot'), ...command }),
  z.object({ action: z.literal('discard'), ...command, reason: liveReason }),
  // Lease heartbeat: no revision or action id; never recorded.
  z.object({ action: z.literal('renew'), client_id: liveClientIdSchema }),
]);

export const correctLiveRunTimeSchema = z.object({
  transition_id: z.number().int().positive(),
  corrected_at: isoDateTime,
  reason: liveReason,
  expected_revision: revision,
});

export type CreateLiveRunInput = z.infer<typeof createLiveRunSchema>;
/** What a client sends; the server applies the policy default. */
export type CreateLiveRunRequest = z.input<typeof createLiveRunSchema>;
export type LiveRunActionInput = z.infer<typeof liveRunActionSchema>;
export type CorrectLiveRunTimeInput = z.infer<typeof correctLiveRunTimeSchema>;
