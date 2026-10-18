import { Router } from 'express';
import {
  combinedScheduleQuerySchema,
  copyAvailabilitySchema,
  scheduleSettingsSchema,
  type CombinedScheduleQuery,
  type CopyAvailabilityInput,
  type ScheduleSettingsInput,
  type UserScheduleSettingsRow,
} from '@service-center/shared';
import { parsedQuery, validateBody, validateQuery } from '../lib/validate.js';
import { unwrap } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import { combinedSchedule, copyAvailability } from '../services/availability.js';

/**
 * F03 Pass D (optional): the signed-in user's own schedule across their
 * organizations. Mounted under /api/v1/me (no active organization needed);
 * copying uses the X-Organization-Id header as the source organization.
 */
export const meAvailabilityRouter: Router = Router();

const defaults = (userId: string): UserScheduleSettingsRow => ({
  user_id: userId, combined_schedule: false, share_busy_across_orgs: false, updated_at: new Date(0).toISOString(),
});

meAvailabilityRouter.get('/schedule-settings', async (req, res) => {
  const row = await unwrap(req.db.from('user_schedule_settings').select('*').eq('user_id', req.auth.userId).maybeSingle());
  res.json(row ?? defaults(req.auth.userId));
});

meAvailabilityRouter.put('/schedule-settings', validateBody(scheduleSettingsSchema), async (req, res) => {
  const input = req.body as ScheduleSettingsInput;
  const row = await unwrap(
    req.db.from('user_schedule_settings')
      .upsert({ user_id: req.auth.userId, ...input, updated_at: new Date().toISOString() })
      .select('*').single(),
  );
  res.json(row);
});

meAvailabilityRouter.get('/combined-schedule', validateQuery(combinedScheduleQuerySchema), async (req, res) => {
  const { from, to } = parsedQuery<CombinedScheduleQuery>(res);
  const settings = await unwrap(
    req.db.from('user_schedule_settings').select('combined_schedule').eq('user_id', req.auth.userId).maybeSingle(),
  );
  if (!settings?.combined_schedule) throw HttpError.forbidden('Turn on the combined schedule first');
  res.json(await combinedSchedule({ db: req.db, userId: req.auth.userId }, from, to));
});

meAvailabilityRouter.post('/availability/copy', validateBody(copyAvailabilitySchema), async (req, res) => {
  const sourceOrgId = req.header('x-organization-id');
  if (!sourceOrgId) throw HttpError.badRequest('Choose the organization to copy from');
  res.json(await copyAvailability({ db: req.db, userId: req.auth.userId }, sourceOrgId, req.body as CopyAvailabilityInput));
});
