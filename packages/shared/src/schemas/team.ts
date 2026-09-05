import { z } from 'zod';
import { nonEmpty, uuid } from './common.js';

export const createTeamSchema = z.object({
  name: nonEmpty.max(120),
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

export const teamMembershipSchema = z.object({
  user_id: uuid,
  position_id: uuid.nullish(),
});

export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type TeamMembershipInput = z.infer<typeof teamMembershipSchema>;
