import { z } from 'zod';
import { uuid } from './common.js';
import { churchSlugSchema } from './platform-admin.js';

/**
 * Joining a church by its URL slug.
 * See supabase/migrations/20261117000000_church_join_requests.sql.
 */

/** Longest message or decline reason (the database checks it again). */
export const CHURCH_JOIN_TEXT_MAX = 500;

const optionalText = z
  .string()
  .trim()
  .max(CHURCH_JOIN_TEXT_MAX)
  .nullish()
  .transform((value) => (value ? value : null));

/** `GET /api/v1/church-join-requests/lookup?slug=`. */
export const churchLookupQuerySchema = z.object({ slug: churchSlugSchema });

/** `POST /api/v1/church-join-requests`. */
export const createChurchJoinRequestSchema = z.object({
  slug: churchSlugSchema,
  message: optionalText,
});

/** `POST /api/v1/people/join-requests/:id/decline`: shown to the requester. */
export const declineChurchJoinRequestSchema = z.object({ reason: optionalText });

export const churchJoinRequestParamsSchema = z.object({ id: uuid });

export type ChurchLookupQuery = z.infer<typeof churchLookupQuerySchema>;
export type CreateChurchJoinRequestInput = z.infer<typeof createChurchJoinRequestSchema>;
export type CreateChurchJoinRequestRequest = z.input<typeof createChurchJoinRequestSchema>;
export type DeclineChurchJoinRequestInput = z.infer<typeof declineChurchJoinRequestSchema>;
export type DeclineChurchJoinRequestRequest = z.input<typeof declineChurchJoinRequestSchema>;
