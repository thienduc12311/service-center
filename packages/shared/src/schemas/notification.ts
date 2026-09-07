import { z } from 'zod';
import { uuid } from './common.js';

export const notificationTypeSchema = z.enum([
  'assignment_scheduled',
  'assignment_reminder',
  'assignment_response',
  'plan_updated',
]);

export const listNotificationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  /** Keyset cursor: the `created_at` of the last row already shown. */
  before: z.string().datetime().optional(),
  unread_only: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .default(false),
});

/** Omit `ids` to mark the whole organization's feed as read. */
export const markNotificationsReadSchema = z.object({
  ids: z.array(uuid).min(1).max(200).optional(),
});

export const devicePlatformSchema = z.enum(['ios', 'android', 'web']);

export const registerDeviceSchema = z.object({
  /** An Expo push token, e.g. `ExponentPushToken[xxxxxxxx]`. */
  token: z.string().trim().min(10).max(255),
  platform: devicePlatformSchema,
  device_name: z.string().trim().max(120).nullish(),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
export type MarkNotificationsReadInput = z.infer<typeof markNotificationsReadSchema>;
export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;
