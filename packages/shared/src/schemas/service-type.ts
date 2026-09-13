import { z } from 'zod';
import { nonEmpty } from './common.js';
import { planTimeSchema } from './plan.js';

export const planRecurrenceSchema = z.enum(['weekly', 'biweekly', 'monthly', 'occasionally']);

/**
 * One team the setup wizard should create alongside the service type. The
 * client sends the template it picked (or a team the user typed themselves),
 * never a team id — nothing exists yet at that point.
 */
export const serviceTypeSetupTeamSchema = z.object({
  name: nonEmpty.max(120),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Expected a hex colour like #6366f1')
    .default('#6366f1'),
  positions: z.array(nonEmpty.max(80)).max(50).default([]),
});

/**
 * The whole "Add a Service Type" wizard in one request: the service type, the
 * first plan with its service times, and the teams that run it. One request
 * rather than three so a failure half-way can't leave an organization with a
 * service type nobody can plan against.
 */
export const serviceTypeSetupSchema = z.object({
  name: nonEmpty.max(120),
  description: z.string().trim().max(500).nullish(),
  recurrence: planRecurrenceSchema.default('weekly'),
  /** Defaults to the service type name when the client doesn't override it. */
  plan_title: nonEmpty.max(200).optional(),
  times: z.array(planTimeSchema).min(1).max(20),
  teams: z.array(serviceTypeSetupTeamSchema).max(40).default([]),
  /** "You will be added as a team leader to any teams selected." */
  join_teams: z.boolean().default(true),
});

export type ServiceTypeSetupTeamInput = z.infer<typeof serviceTypeSetupTeamSchema>;
export type ServiceTypeSetupInput = z.infer<typeof serviceTypeSetupSchema>;
export type ServiceTypeSetupPayload = z.input<typeof serviceTypeSetupSchema>;
