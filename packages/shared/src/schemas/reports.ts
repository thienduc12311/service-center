import { z } from 'zod';
import { parseLocalDate } from '../lib/timezone.js';
import { idempotencyKey, uuid } from './common.js';
import { planStatusSchema } from './plan.js';

const localDate = z.string().refine((value) => parseLocalDate(value) !== null, 'Choose a valid date');

/** Query strings carry lists as `a,b,c`; JSON bodies carry arrays. */
const listOf = <T extends z.ZodTypeAny>(item: T, max: number) =>
  z.preprocess(
    (value) =>
      typeof value === 'string' ? value.split(',').map((part) => part.trim()).filter(Boolean) : value ?? [],
    z.array(item).max(max),
  );

const queryBoolean = (fallback: boolean) =>
  z.preprocess((value) => (value === 'true' ? true : value === 'false' ? false : value), z.boolean().default(fallback));

export const attendanceStatusSchema = z.enum(['present', 'absent', 'unknown']);
export const reportKindSchema = z.enum(['staffing', 'participation', 'song_usage', 'run_times', 'schedule']);
export const assignmentStatusFilterSchema = z.enum(['confirmed', 'unconfirmed', 'declined']);

// =============================================================== attendance

export const attendanceSheetQuerySchema = z.object({ plan_time_id: uuid.optional() });

export const attendanceMarkSchema = z.object({
  person_id: uuid,
  /** The team this mark is recorded through; must be one the Person is on at that time. */
  team_id: uuid,
  status: attendanceStatusSchema,
  /** The record revision you saw; 0 when nothing was recorded yet. */
  expected_revision: z.number().int().min(0),
});

export const recordAttendanceSchema = z.object({
  plan_time_id: uuid,
  marks: z
    .array(attendanceMarkSchema)
    .min(1)
    .max(500)
    .refine((marks) => new Set(marks.map((mark) => mark.person_id)).size === marks.length, {
      message: 'Mark each person once',
    }),
  reason: z.string().trim().max(500).nullish(),
  idempotency_key: idempotencyKey,
});

export const attendanceHistoryQuerySchema = z.object({ plan_time_id: uuid, person_id: uuid });

// ================================================================== reports

/** Longest report range (inclusive local days). */
export const REPORT_MAX_DAYS = 366;

export const reportFiltersSchema = z
  .object({
    from: localDate,
    to: localDate,
    service_type_ids: listOf(uuid, 50),
    team_ids: listOf(uuid, 100),
    plan_statuses: listOf(planStatusSchema, 3).transform((value) => (value.length ? value : ['published' as const])),
    assignment_statuses: listOf(assignmentStatusFilterSchema, 3).transform((value) =>
      value.length ? value : (['confirmed', 'unconfirmed', 'declined'] as const).slice(),
    ),
    include_archived_people: queryBoolean(true),
    include_rehearsals: queryBoolean(false),
  })
  .superRefine((value, ctx) => {
    const from = parseLocalDate(value.from);
    const to = parseLocalDate(value.to);
    if (!from || !to) return;
    const days =
      (Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) / 86_400_000;
    if (days < 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '`to` must be on or after `from`', path: ['to'] });
    if (days >= REPORT_MAX_DAYS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Choose at most ${REPORT_MAX_DAYS} days`, path: ['to'] });
    }
  });

export const reportQuerySchema = z.intersection(
  reportFiltersSchema,
  z.object({ format: z.enum(['json', 'csv']).default('json') }),
);

export const requestReportExportSchema = z.object({
  kind: reportKindSchema,
  filters: reportFiltersSchema,
  idempotency_key: idempotencyKey,
});

// ============================================================ calendar feeds

export const calendarLayerSchema = z.enum(['blockouts', 'birthdays', 'anniversaries']);

export const createScopedFeedSchema = z
  .object({
    scope_type: z.enum(['service_type', 'team']),
    service_type_id: uuid.nullish(),
    team_id: uuid.nullish(),
    include_rehearsals: z.boolean().default(true),
    layers: z.array(calendarLayerSchema).max(3).default([]),
    label: z.string().trim().max(80).nullish(),
  })
  .refine(
    (value) =>
      value.scope_type === 'service_type' ? Boolean(value.service_type_id) && !value.team_id : Boolean(value.team_id) && !value.service_type_id,
    { message: 'Choose one service type or one team', path: ['scope_type'] },
  )
  .refine((value) => value.scope_type === 'team' || value.layers.length === 0, {
    message: 'Layers are available on team feeds only',
    path: ['layers'],
  });

export const calendarLayersQuerySchema = z.object({
  team_id: uuid,
  from: localDate,
  to: localDate,
  layers: listOf(calendarLayerSchema, 3).refine((value) => value.length > 0, 'Choose a layer'),
});

export const personCalendarSharingSchema = z.object({
  share_birthday: z.boolean(),
  share_anniversary: z.boolean(),
});

// ============================================================== publication

export const publicPlanFieldSchema = z.enum([
  'title',
  'date',
  'times',
  'location',
  'service_type',
  'order',
  'item_lengths',
  'songs',
  'song_authors',
  'song_keys',
]);

export const publishPlanSchema = z.object({
  fields: z.array(publicPlanFieldSchema).min(1).max(10),
  publish_mode: z.enum(['now', 'service_day']),
  expected_revision: z.number().int().min(0),
  new_link: z.boolean().default(false),
});

export const revokePlanPublicationSchema = z.object({ expected_revision: z.number().int().min(1) });

export const setPublicLinkSchema = z.object({
  kind: z.enum(['upcoming', 'recent']),
  action: z.enum(['create', 'rotate', 'revoke']),
});

export type AttendanceSheetQuery = z.infer<typeof attendanceSheetQuerySchema>;
export type AttendanceMarkInput = z.infer<typeof attendanceMarkSchema>;
export type RecordAttendanceInput = z.infer<typeof recordAttendanceSchema>;
export type RecordAttendanceRequest = z.input<typeof recordAttendanceSchema>;
export type AttendanceHistoryQuery = z.infer<typeof attendanceHistoryQuerySchema>;
export type ReportFiltersInput = z.infer<typeof reportFiltersSchema>;
/** What a client sends (lists as arrays; the query string joins them). */
export interface ReportFiltersRequest {
  from: string;
  to: string;
  service_type_ids?: string[];
  team_ids?: string[];
  plan_statuses?: Array<'draft' | 'published' | 'archived'>;
  assignment_statuses?: Array<'confirmed' | 'unconfirmed' | 'declined'>;
  include_archived_people?: boolean;
  include_rehearsals?: boolean;
}
export type ReportQueryInput = z.infer<typeof reportQuerySchema>;
export type RequestReportExportInput = z.infer<typeof requestReportExportSchema>;
export interface RequestReportExportRequest {
  kind: z.infer<typeof reportKindSchema>;
  filters: ReportFiltersRequest;
  idempotency_key: string;
}
export type CreateScopedFeedInput = z.infer<typeof createScopedFeedSchema>;
export type CreateScopedFeedRequest = z.input<typeof createScopedFeedSchema>;
export type CalendarLayersQuery = z.infer<typeof calendarLayersQuerySchema>;
export interface CalendarLayersRequest {
  team_id: string;
  from: string;
  to: string;
  layers: Array<z.infer<typeof calendarLayerSchema>>;
}
export type PersonCalendarSharingInput = z.infer<typeof personCalendarSharingSchema>;
export type PublishPlanInput = z.infer<typeof publishPlanSchema>;
export type PublishPlanRequest = z.input<typeof publishPlanSchema>;
export type RevokePlanPublicationInput = z.infer<typeof revokePlanPublicationSchema>;
export type SetPublicLinkInput = z.infer<typeof setPublicLinkSchema>;
