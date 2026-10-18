import { z } from 'zod';
import { idempotencyKey, uuid } from './common.js';

export const createSignupOpportunitySchema = z.object({
  team_id: uuid,
  position_id: uuid,
  applicable_time_ids: z.array(uuid).max(20).default([]),
  capacity: z.number().int().min(1).max(200),
  approval_policy: z.enum(['direct', 'leader_approval']),
  closes_at: z.string().datetime({ offset: true }),
  reservation_minutes: z.number().int().min(5).max(10_080).default(1_440),
});
export const updateSignupOpportunitySchema = createSignupOpportunitySchema.pick({
  capacity: true, approval_policy: true, closes_at: true, reservation_minutes: true,
}).partial().extend({ state: z.enum(['open', 'closed']).optional(), expected_version: z.number().int().positive() });
export const claimSignupOpportunitySchema = z.object({ expected_version: z.number().int().positive(), idempotency_key: idempotencyKey });
export const decideSignupClaimSchema = z.object({ expected_version: z.number().int().positive(), action: z.enum(['approve', 'reject']) });
export const cancelSignupClaimSchema = z.object({ expected_version: z.number().int().positive() });
export const createReplacementRequestSchema = z.object({ assignment_id: uuid, expected_revision: z.number().int().nonnegative(), idempotency_key: idempotencyKey, expires_at: z.string().datetime({ offset: true }) });
export const cancelReplacementRequestSchema = z.object({ expected_version: z.number().int().positive() });
export const issueReplacementOfferSchema = z.object({ candidate_person_id: uuid, expected_version: z.number().int().positive(), idempotency_key: idempotencyKey });
export const actOnReplacementOfferSchema = z.object({ expected_version: z.number().int().positive(), action: z.enum(['accept','decline','approve','reject']) });
export const createApprovedSwapSchema = z.object({ first_assignment_id: uuid, second_assignment_id: uuid, first_revision: z.number().int().nonnegative(), second_revision: z.number().int().nonnegative(), expires_at: z.string().datetime({ offset: true }), idempotency_key: idempotencyKey });
export const actOnApprovedSwapSchema = z.object({ expected_version: z.number().int().positive(), action: z.enum(['consent','approve','cancel','reject']) });

export type CreateSignupOpportunityInput = z.infer<typeof createSignupOpportunitySchema>;
export type UpdateSignupOpportunityInput = z.infer<typeof updateSignupOpportunitySchema>;
export type ClaimSignupOpportunityInput = z.infer<typeof claimSignupOpportunitySchema>;
export type DecideSignupClaimInput = z.infer<typeof decideSignupClaimSchema>;
export type CancelSignupClaimInput = z.infer<typeof cancelSignupClaimSchema>;
export type CreateReplacementRequestInput = z.infer<typeof createReplacementRequestSchema>;
export type CancelReplacementRequestInput = z.infer<typeof cancelReplacementRequestSchema>;
export type IssueReplacementOfferInput = z.infer<typeof issueReplacementOfferSchema>;
export type ActOnReplacementOfferInput = z.infer<typeof actOnReplacementOfferSchema>;
export type CreateApprovedSwapInput = z.infer<typeof createApprovedSwapSchema>;
export type ActOnApprovedSwapInput = z.infer<typeof actOnApprovedSwapSchema>;
