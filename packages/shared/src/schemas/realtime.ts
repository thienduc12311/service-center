import { z } from 'zod';
import { uuid } from './common.js';

/** Resources that have a private Realtime poke topic. */
export const realtimeResourceSchema = z.enum(['conversation', 'live_plan', 'live_run']);
export type RealtimeResource = z.infer<typeof realtimeResourceSchema>;

/** Most ids one request may ask topics for (the conversation list subscribes to at most 90). */
export const REALTIME_TOPIC_REQUEST_LIMIT = 100;

export const realtimeResourceTopicsSchema = z.object({
  resource: realtimeResourceSchema,
  ids: z.array(uuid).max(REALTIME_TOPIC_REQUEST_LIMIT),
});
export type RealtimeResourceTopicsInput = z.infer<typeof realtimeResourceTopicsSchema>;
