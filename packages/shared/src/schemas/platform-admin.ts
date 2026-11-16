import { z } from 'zod';
import { nonEmpty, uuid } from './common.js';

/**
 * Super-admin dashboard and church applications.
 * See docs/plans/super-admin-dashboard.md.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

/** An IANA zone name the database also knows (checked again when the church is created). */
const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown time zone');

/** Same rule as `organizations.slug`. */
export const churchSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]{2,40}$/, 'Use 2–40 lowercase letters, numbers or dashes');

const churchDetailsShape = {
  church_name: nonEmpty.max(120),
  leader_name: nonEmpty.max(120),
  contact_phone: optionalText(40),
  website: optionalText(300),
  address_line1: optionalText(200),
  address_line2: optionalText(200),
  city: nonEmpty.max(100),
  state_province: optionalText(100),
  postal_code: optionalText(20),
  country: nonEmpty.max(100),
  expected_member_count: z.number().int().min(0).max(1_000_000).nullish().transform((value) => value ?? null),
  timezone: timezoneSchema,
  note: optionalText(2000),
};

/** `POST /api/v1/church-applications`. */
export const submitChurchApplicationSchema = z.object(churchDetailsShape);

/**
 * `PATCH /api/v1/church-applications/:id` (the applicant, while pending) and
 * `PATCH /api/v1/admin/church-applications/:id` (a super admin, before deciding).
 */
export const updateChurchApplicationSchema = z
  .object(churchDetailsShape)
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Change at least one field');

export const churchApplicationParamsSchema = z.object({ id: uuid });

/** `POST /api/v1/admin/church-applications/:id/approve`. */
export const approveChurchApplicationSchema = z.object({ slug: churchSlugSchema });

/** `POST /api/v1/admin/church-applications/:id/reject`: shown to the applicant. */
export const rejectChurchApplicationSchema = z.object({ reason: nonEmpty.max(1000) });

export const churchApplicationStatusSchema = z.enum(['pending', 'approved', 'rejected', 'withdrawn']);

/** `GET /api/v1/admin/church-applications`. */
export const adminChurchApplicationsQuerySchema = z.object({
  status: churchApplicationStatusSchema.optional(),
});

/** `POST /api/v1/admin/organizations`: create a church directly and name its owner. */
export const adminCreateChurchSchema = z.object({
  name: nonEmpty.max(120),
  slug: churchSlugSchema,
  timezone: timezoneSchema,
  owner_email: z.string().trim().toLowerCase().email().max(320),
  address_line1: optionalText(200),
  address_line2: optionalText(200),
  city: optionalText(100),
  state_province: optionalText(100),
  postal_code: optionalText(20),
  country: optionalText(100),
  member_count: z.number().int().min(0).max(1_000_000).nullish().transform((value) => value ?? null),
});

export const adminOrganizationParamsSchema = z.object({ id: uuid });

/** 1 MB to 1 TB; null returns the church to the platform default. */
const quotaBytesSchema = z.number().int().min(1_048_576).max(1_099_511_627_776);

/** `PUT /api/v1/admin/organizations/:id/quota`. */
export const setOrganizationQuotaSchema = z.object({ storage_quota_bytes: quotaBytesSchema.nullable() });

/** `POST /api/v1/admin/organizations/:id/disable`: the owner sees the reason. */
export const disableOrganizationSchema = z.object({ reason: nonEmpty.max(500) });

/** `POST /api/v1/admin/organizations/:id/access`: enter the church as a temporary owner. */
export const enterOrganizationSchema = z.object({ hours: z.number().int().min(1).max(24).default(8) });

/** `PATCH /api/v1/admin/settings`. */
export const updatePlatformSettingsSchema = z
  .object({
    default_storage_quota_bytes: quotaBytesSchema.optional(),
    allow_self_serve_church_creation: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Change at least one setting');

/** `GET /api/v1/admin/activity`: newest first, paged by id. */
export const adminActivityQuerySchema = z.object({
  organization_id: uuid.optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type SubmitChurchApplicationInput = z.infer<typeof submitChurchApplicationSchema>;
export type SubmitChurchApplicationRequest = z.input<typeof submitChurchApplicationSchema>;
export type UpdateChurchApplicationInput = z.infer<typeof updateChurchApplicationSchema>;
export type UpdateChurchApplicationRequest = z.input<typeof updateChurchApplicationSchema>;
export type ApproveChurchApplicationInput = z.infer<typeof approveChurchApplicationSchema>;
export type RejectChurchApplicationInput = z.infer<typeof rejectChurchApplicationSchema>;
export type AdminChurchApplicationsQuery = z.infer<typeof adminChurchApplicationsQuerySchema>;
export type AdminCreateChurchInput = z.infer<typeof adminCreateChurchSchema>;
export type AdminCreateChurchRequest = z.input<typeof adminCreateChurchSchema>;
export type SetOrganizationQuotaInput = z.infer<typeof setOrganizationQuotaSchema>;
export type DisableOrganizationInput = z.infer<typeof disableOrganizationSchema>;
export type EnterOrganizationInput = z.infer<typeof enterOrganizationSchema>;
export type EnterOrganizationRequest = z.input<typeof enterOrganizationSchema>;
export type UpdatePlatformSettingsInput = z.infer<typeof updatePlatformSettingsSchema>;
export type AdminActivityQuery = z.infer<typeof adminActivityQuerySchema>;
export type AdminActivityRequest = z.input<typeof adminActivityQuerySchema>;
