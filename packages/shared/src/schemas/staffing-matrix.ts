import { z } from 'zod';
import { idempotencyKey, uuid } from './common.js';
import { attendanceModeSchema } from './attendance.js';

const isoInstant = z.string().datetime({ offset: true });
const visibility = z.enum(['prepared', 'released']);

export const staffingMatrixFiltersSchema = z.object({
  from: isoInstant,
  to: isoInstant,
  service_type_ids: z.array(uuid).max(20).default([]),
  team_ids: z.array(uuid).max(20).default([]),
  plan_ids: z.array(uuid).max(12).default([]),
  search: z.string().trim().max(100).nullish().transform((value) => value || null),
}).refine((value) => new Date(value.to) > new Date(value.from), {
  message: 'The end of the matrix range must be after the start', path: ['to'],
});

export const staffingMatrixQuerySchema = z.object({
  filters: staffingMatrixFiltersSchema,
  cursor: z.string().trim().min(1).max(300).optional(),
  page_size: z.number().int().min(1).max(50).default(25),
});

export const saveStaffingMatrixViewSchema = z.object({
  name: z.string().trim().min(1).max(80),
  filters: staffingMatrixFiltersSchema,
});

const assignAction = z.object({
  kind: z.literal('assign'), plan_id: uuid, person_id: uuid, team_id: uuid,
  position_id: uuid.nullable(), visibility, attendance_mode: attendanceModeSchema,
  time_ids: z.array(uuid).max(20).default([]), notify: z.boolean().default(false),
}).refine((value) => value.attendance_mode === 'all' || value.time_ids.length > 0, {
  message: 'Choose at least one attendance time', path: ['time_ids'],
});

const removeAction = z.object({
  kind: z.literal('remove'), plan_id: uuid, assignment_id: uuid,
  expected_request_revision: z.number().int().min(0),
});

const copyAction = z.object({
  kind: z.literal('copy'), source_assignment_id: uuid,
  expected_source_revision: z.number().int().min(0), destination_plan_id: uuid,
  destination_attendance_mode: attendanceModeSchema,
  destination_time_ids: z.array(uuid).max(20).default([]), visibility,
  notify: z.boolean().default(false),
}).refine((value) => value.destination_attendance_mode === 'all' || value.destination_time_ids.length > 0, {
  message: 'Choose at least one destination time', path: ['destination_time_ids'],
});

const releaseAction = z.object({
  kind: z.literal('release'), plan_id: uuid, assignment_id: uuid,
  expected_request_revision: z.number().int().min(0), notify: z.boolean().default(true),
});

export const staffingMatrixActionSchema = z.union([assignAction, removeAction, copyAction, releaseAction]);
export const previewStaffingMatrixSchema = z.object({ actions: z.array(staffingMatrixActionSchema).min(1).max(200) });

const planRevisionSchema = z.object({ plan_id: uuid, staffing_revision: z.number().int().min(0) });
export const commitStaffingMatrixSchema = z.object({
  operation_id: z.string().regex(/^[a-f0-9]{64}$/),
  actions: z.array(staffingMatrixActionSchema).min(1).max(200),
  base_revisions: z.array(planRevisionSchema).min(1).max(12),
  idempotency_key: idempotencyKey,
});

export type StaffingMatrixFiltersInput = z.infer<typeof staffingMatrixFiltersSchema>;
export type StaffingMatrixQueryInput = z.infer<typeof staffingMatrixQuerySchema>;
export type SaveStaffingMatrixViewInput = z.infer<typeof saveStaffingMatrixViewSchema>;
export type PreviewStaffingMatrixInput = z.infer<typeof previewStaffingMatrixSchema>;
export type CommitStaffingMatrixInput = z.infer<typeof commitStaffingMatrixSchema>;
