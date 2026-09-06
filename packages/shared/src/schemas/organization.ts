import { z } from 'zod';
import { nonEmpty, uuid } from './common.js';

export const orgRoleSchema = z.enum(['owner', 'admin', 'scheduler', 'member']);

export const createOrganizationSchema = z.object({
  name: nonEmpty.max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,40}$/, 'Use 2–40 lowercase letters, numbers or dashes'),
  timezone: z.string().default('America/Toronto'),
  logo_url: z.string().url().nullish(),
  address_line1: z.string().trim().max(200).nullish(),
  address_line2: z.string().trim().max(200).nullish(),
  city: z.string().trim().max(100).nullish(),
  state_province: z.string().trim().max(100).nullish(),
  postal_code: z.string().trim().max(20).nullish(),
  country: z.string().trim().max(100).nullish(),
  denomination: z.string().trim().max(120).nullish(),
  /** Self-reported congregation size — distinct from the count of people actually in the system. */
  member_count: z.number().int().min(0).nullish(),
});

export const updateOrganizationSchema = createOrganizationSchema.partial().omit({ slug: true });

export const updateMemberSchema = z.object({
  role: orgRoleSchema.optional(),
  status: z.enum(['invited', 'active', 'inactive']).optional(),
});

export const updateProfileSchema = z.object({
  full_name: nonEmpty.max(120).optional(),
  phone: z.string().trim().max(40).nullish(),
  avatar_url: z.string().url().nullish(),
});

export const serviceTypeSchema = z.object({
  name: nonEmpty.max(120),
  description: z.string().trim().max(500).nullish(),
  sort_order: z.number().int().min(0).default(0),
});

export const blockoutSchema = z
  .object({
    starts_at: z.string(),
    ends_at: z.string(),
    reason: z.string().trim().max(200).nullish(),
    user_id: uuid.optional(), // schedulers may record on someone's behalf
  })
  .refine((v) => new Date(v.starts_at) < new Date(v.ends_at), {
    message: 'End must be after start',
    path: ['ends_at'],
  });

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type BlockoutInput = z.infer<typeof blockoutSchema>;
