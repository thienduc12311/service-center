import { z } from 'zod';
import { uuid } from './common.js';

/** `DELETE /api/v1/me`: the client must say it means it. */
export const deleteAccountSchema = z.object({ confirm: z.literal(true) });

/** `PUT|DELETE /api/v1/me/blocks/:userId`. */
export const userBlockParamsSchema = z.object({ userId: uuid });

export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
export type UserBlockParams = z.infer<typeof userBlockParamsSchema>;
