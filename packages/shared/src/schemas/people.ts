import { z } from 'zod';
import { nonEmpty } from './common.js';
import { orgRoleSchema } from './organization.js';

export const personTypeSchema = z.enum(['adult', 'child']);
export const genderSchema = z.enum(['male', 'female']);

export const createPersonSchema = z.object({
  first_name: nonEmpty.max(80),
  last_name: z.string().trim().max(80).nullish(),
  avatar_url: z.string().url().nullish(),

  email: z.string().trim().toLowerCase().email().nullish(),
  phone: z.string().trim().max(40).nullish(),
  phone_carrier: z.string().trim().max(60).nullish(),

  address_line1: z.string().trim().max(200).nullish(),
  address_line2: z.string().trim().max(200).nullish(),
  city: z.string().trim().max(100).nullish(),
  state_province: z.string().trim().max(100).nullish(),
  postal_code: z.string().trim().max(20).nullish(),
  country: z.string().trim().max(100).nullish(),

  campus: z.string().trim().max(120).nullish(),
  person_type: personTypeSchema.default('adult'),
  gender: genderSchema.nullish(),
  birthdate: z.string().date().nullish(),
  marital_status: z.string().trim().max(40).nullish(),
  anniversary_date: z.string().date().nullish(),
  school: z.string().trim().max(120).nullish(),
  medical_note: z.string().trim().max(2000).nullish(),
});

// `.partial()` alone would keep re-applying `person_type`'s create-time
// default on every update that omits it, silently resetting it to 'adult' —
// override with a plain optional instead.
export const updatePersonSchema = createPersonSchema.partial().extend({
  person_type: personTypeSchema.optional(),
});

export const invitePersonSchema = z.object({
  // Overrides the person's stored email, in case they want to send it
  // somewhere else. Required when the person has no email on file.
  email: z.string().trim().toLowerCase().email().optional(),
  role: orgRoleSchema.exclude(['owner']).default('member'),
});

export const acceptInvitationSchema = z.object({
  password: z.string().min(8).max(72),
});

export type CreatePersonInput = z.infer<typeof createPersonSchema>;
export type UpdatePersonInput = z.infer<typeof updatePersonSchema>;
export type InvitePersonInput = z.infer<typeof invitePersonSchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
