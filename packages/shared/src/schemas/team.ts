import { z } from 'zod';
import { nonEmpty, uuid } from './common.js';

export const createTeamSchema = z.object({
  name: nonEmpty.max(120),
  description: z.string().max(500).nullish(),
  service_type_id: uuid.nullish(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Expected a hex colour like #6366f1')
    .default('#6366f1'),
  sort_order: z.number().int().min(0).default(0),
  positions: z.array(nonEmpty.max(80)).max(50).optional(),
});

export const updateTeamSchema = createTeamSchema.partial().omit({ positions: true });

export const createPositionSchema = z.object({
  name: nonEmpty.max(80),
  sort_order: z.number().int().min(0).default(0),
});

export const updatePositionSchema = createPositionSchema.partial();

export const teamMembershipSchema = z.object({
  user_id: uuid,
  position_id: uuid.nullish(),
});

// `infer` is the parsed shape the backend works with (defaults applied);
// `input` is what a client may send, where defaulted fields are optional.
export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
export type CreatePositionInput = z.infer<typeof createPositionSchema>;
export type UpdatePositionInput = z.infer<typeof updatePositionSchema>;

export type CreateTeamPayload = z.input<typeof createTeamSchema>;
export type UpdateTeamPayload = z.input<typeof updateTeamSchema>;
export type CreatePositionPayload = z.input<typeof createPositionSchema>;
export type UpdatePositionPayload = z.input<typeof updatePositionSchema>;
export type TeamMembershipInput = z.infer<typeof teamMembershipSchema>;
