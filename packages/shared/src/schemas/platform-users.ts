import { z } from 'zod';
import { nonEmpty, uuid } from './common.js';

/**
 * Super-admin user management and super-admin invitations.
 * See docs/plans/super-admin-dashboard.md.
 */

export const adminUserParamsSchema = z.object({ id: uuid });

/** `POST /api/v1/admin/users/:id/block`: shown in the dashboard and the activity log. */
export const blockUserSchema = z.object({ reason: nonEmpty.max(500) });

/** `DELETE /api/v1/admin/users/:id`: the account's email, typed to confirm. */
export const deleteUserSchema = z.object({ confirm_email: z.string().trim().toLowerCase().min(1).max(320) });

/** `POST /api/v1/admin/admins/invitations`. */
export const invitePlatformAdminSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  days: z.number().int().min(1).max(30).default(7),
});

export const platformAdminInvitationParamsSchema = z.object({ id: uuid });

export type BlockUserInput = z.infer<typeof blockUserSchema>;
export type DeleteUserInput = z.infer<typeof deleteUserSchema>;
export type InvitePlatformAdminInput = z.infer<typeof invitePlatformAdminSchema>;
export type InvitePlatformAdminRequest = z.input<typeof invitePlatformAdminSchema>;
