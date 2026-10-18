import { z } from 'zod';
import { idempotencyKey, uuid } from './common.js';

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const proposalLockSchema = z.object({ plan_id: uuid, position_id: uuid, person_id: uuid });
export const proposalExclusionSchema = z.object({ plan_id: uuid, position_id: uuid, person_id: uuid });

const editsSchema = z.object({
  locks: z.array(proposalLockSchema).max(400).default([]),
  exclusions: z.array(proposalExclusionSchema).max(400).default([]),
}).refine((value) => !value.locks.some((lock) => value.exclusions.some((ex) =>
  ex.plan_id === lock.plan_id && ex.position_id === lock.position_id && ex.person_id === lock.person_id)), {
  message: 'A person cannot be both locked and excluded for the same position', path: ['exclusions'],
});

/** `POST /scheduling/proposals` — capture a snapshot and run the engine (no staffing effects). */
export const createStaffingProposalSchema = z.object({
  plan_ids: z.array(uuid).min(1).max(12),
  team_ids: z.array(uuid).min(1).max(20),
  lookback_days: z.number().int().min(7).max(365).default(90),
  /** Recorded tie-break seed; generated when omitted so a replay can reuse it. */
  seed: z.string().trim().regex(/^[A-Za-z0-9_-]{4,64}$/).optional(),
  rotation_ids: z.array(uuid).max(20).optional(),
  locks: z.array(proposalLockSchema).max(400).default([]),
  exclusions: z.array(proposalExclusionSchema).max(400).default([]),
});

/** `POST /scheduling/proposals/:id/recompute` — rerun on the same snapshot with reviewer edits. */
export const recomputeStaffingProposalSchema = z.object({
  expected_revision: z.number().int().min(0),
  edits: editsSchema,
});

/** `POST /scheduling/proposals/:id/commit` — create prepared requests atomically. */
export const commitStaffingProposalSchema = z.object({
  expected_revision: z.number().int().min(0),
  idempotency_key: idempotencyKey,
});

const rotationSlotSchema = z.object({
  week_index: z.number().int().min(0).max(11),
  position_id: uuid,
  person_id: uuid,
});
const rotationExceptionSchema = z.object({
  local_date: localDate,
  position_id: uuid,
  person_id: uuid.nullable(),
  note: z.string().trim().max(200).nullish().transform((value) => value || null),
});

const rotationBody = z.object({
  name: z.string().trim().min(1).max(80),
  cycle_weeks: z.number().int().min(1).max(12),
  anchor_date: localDate,
  substitute_policy: z.enum(['vacancy', 'fairness']).default('vacancy'),
  slots: z.array(rotationSlotSchema).max(240).default([]),
  exceptions: z.array(rotationExceptionSchema).max(200).default([]),
});

const checkRotation = (value: z.infer<typeof rotationBody>, ctx: z.RefinementCtx): void => {
  if (value.slots.some((slot) => slot.week_index >= value.cycle_weeks)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Every slot must fall inside the cycle', path: ['slots'] });
  }
  const slotKeys = value.slots.map((slot) => `${slot.week_index}:${slot.position_id}:${slot.person_id}`);
  if (new Set(slotKeys).size !== slotKeys.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A person appears twice in the same week and position', path: ['slots'] });
  }
  const exceptionKeys = value.exceptions.map((item) => `${item.local_date}:${item.position_id}:${item.person_id ?? 'skip'}`);
  if (new Set(exceptionKeys).size !== exceptionKeys.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate exception', path: ['exceptions'] });
  }
};

export const createTeamRotationSchema = rotationBody.extend({ team_id: uuid }).superRefine(checkRotation);
export const updateTeamRotationSchema = rotationBody.extend({ expected_revision: z.number().int().min(0) }).superRefine(checkRotation);

export const rotationPreviewQuerySchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
}).refine((value) => new Date(value.to) > new Date(value.from), { message: '`to` must be after `from`', path: ['to'] })
  .refine((value) => new Date(value.to).getTime() - new Date(value.from).getTime() <= 184 * 86_400_000, {
    message: 'Preview at most six months', path: ['to'],
  });

export type CreateStaffingProposalInput = z.infer<typeof createStaffingProposalSchema>;
export type RecomputeStaffingProposalInput = z.infer<typeof recomputeStaffingProposalSchema>;
export type CommitStaffingProposalInput = z.infer<typeof commitStaffingProposalSchema>;
export type CreateTeamRotationInput = z.infer<typeof createTeamRotationSchema>;
export type UpdateTeamRotationInput = z.infer<typeof updateTeamRotationSchema>;
export type RotationPreviewQuery = z.infer<typeof rotationPreviewQuerySchema>;

// ---------------------------------------------- stored proposal payloads --
// Stored JSON is re-validated from `unknown` before the engine replays it.

const id = z.string().min(1).max(100);
const assignmentStatus = z.enum(['unconfirmed', 'confirmed', 'declined']);

export const proposalSnapshotSchema = z.object({
  rule_version: z.literal('f06.fairness.v1'),
  organization_id: id,
  time_zone: z.string().min(1).max(64),
  captured_at: z.string(),
  lookback_days: z.number().int().min(7).max(365),
  team_ids: z.array(id).max(20),
  plans: z.array(z.object({
    id, title: z.string(), service_date: z.string(), local_date: localDate,
    service_type_id: id.nullable(), staffing_revision: z.number().int(),
    needs: z.array(z.object({ team_id: id, position_id: id, needed: z.number().int().min(0).max(99) })),
  })).max(12),
  people: z.array(z.object({ id, full_name: z.string() })).max(2000),
  memberships: z.array(z.object({ person_id: id, team_id: id, position_id: id })).max(5000),
  assignments: z.array(z.object({
    id, plan_id: id, person_id: id, team_id: id, position_id: id.nullable(),
    status: assignmentStatus, visibility: z.enum(['prepared', 'released']),
  })).max(5000),
  unavailable: z.array(z.object({ person_id: id, plan_id: id, code: z.enum(['blockout', 'overlapping_commitment']) })).max(20000),
  preferences: z.array(z.object({ person_id: id, plan_id: id, team_id: id, codes: z.array(z.string()).max(20) })).max(20000),
  serving: z.array(z.object({ person_id: id, plan_id: id, service_date: z.string() })).max(50000),
  rotations: z.array(z.object({
    id, team_id: id, name: z.string(), revision: z.number().int(), cycle_weeks: z.number().int().min(1).max(12),
    anchor_date: localDate, substitute_policy: z.enum(['vacancy', 'fairness']),
    slots: z.array(z.object({ week_index: z.number().int().min(0).max(11), position_id: id, person_id: id })),
    exceptions: z.array(z.object({ local_date: localDate, position_id: id, person_id: id.nullable() })),
  })).max(20),
});

export const proposalEditsSchema = z.object({
  locks: z.array(proposalLockSchema).max(400),
  exclusions: z.array(proposalExclusionSchema).max(400),
});

export const proposalBaseRevisionsSchema = z.array(z.object({ plan_id: uuid, staffing_revision: z.number().int().min(0) }));
export const proposalRotationVersionsSchema = z.array(z.object({ rotation_id: uuid, revision: z.number().int().min(0) }));
