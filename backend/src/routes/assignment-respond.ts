import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  type AssignmentRespondPreview,
  type AssignmentRespondResult,
  type RespondToAssignmentNotificationInput,
  respondToAssignmentNotificationSchema,
} from '@service-center/shared';
import { param } from '../lib/params.js';
import { validateBody } from '../lib/validate.js';
import { adminDb, raw, unwrap, unwrapOne } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import { hashInviteToken } from '../services/invitations.js';
import { deliverEffectNow } from '../services/delivery-worker.js';
import { config } from '../config.js';

export const assignmentRespondRouter: Router = Router();
assignmentRespondRouter.use(rateLimit({ windowMs: 60_000, limit: config.isProduction ? 30 : 10_000, standardHeaders: 'draft-7', legacyHeaders: false }));

interface AssignmentNotificationRecord {
  id: string;
  plan_id: string;
  organization_id: string;
  user_id: string;
  email: string;
  expires_at: string;
  responded_at: string | null;
}

interface RespondAssignmentRow {
  id: string;
  status: 'unconfirmed' | 'confirmed' | 'declined';
  team: { name: string } | null;
  position: { name: string } | null;
}

const loadNotification = async (token: string): Promise<AssignmentNotificationRecord> => {
  const notification = await unwrap(
    adminDb.from('assignment_notifications').select('id, plan_id, organization_id, user_id, email, expires_at, responded_at').eq('token_hash', hashInviteToken(token)).maybeSingle(),
  );
  if (!notification) throw HttpError.notFound('That assignment response link is not valid');
  const record = notification as AssignmentNotificationRecord;
  if (record.responded_at) throw new HttpError(410, 'This assignment response link has already been used', 'assignment_notification_used');
  if (new Date(record.expires_at) <= new Date()) throw new HttpError(410, 'This assignment response link has expired', 'assignment_notification_expired');
  return record;
};

assignmentRespondRouter.get('/:token', async (req, res) => {
  const notification = await loadNotification(param(req, 'token'));
  const [plan, person, assignments, serviceTime] = await Promise.all([
    unwrapOne(adminDb.from('plans').select('title, service_date, location').eq('id', notification.plan_id).single()),
    unwrap(adminDb.from('people').select('first_name').eq('profile_id', notification.user_id).eq('organization_id', notification.organization_id).maybeSingle()),
    unwrap(raw(adminDb).from('assignments').select('id, status, team:teams(name), position:team_positions(name)').eq('plan_id', notification.plan_id).eq('user_id', notification.user_id).eq('visibility', 'released')),
    unwrap(adminDb.from('plan_times').select('starts_at, ends_at').eq('plan_id', notification.plan_id).eq('kind', 'service').order('starts_at').limit(1).maybeSingle()),
  ]);
  const preview: AssignmentRespondPreview = {
    plan_title: plan.title,
    service_date: plan.service_date,
    service_time: serviceTime,
    location: plan.location,
    person_first_name: person?.first_name ?? 'there',
    assignments: (assignments as unknown as RespondAssignmentRow[]).map((assignment) => ({
      team_name: assignment.team?.name ?? 'Team',
      position_name: assignment.position?.name ?? null,
      status: assignment.status,
    })),
    expires_at: notification.expires_at,
  };
  res.json(preview);
});

/**
 * Answer from the emailed link. Verifying the link, answering every position
 * that may still take the answer, using up the link and recording the
 * scheduler update all happen in one transaction (the same scheduler-update
 * rule as a signed-in answer); the update is delivered after it commits.
 */
assignmentRespondRouter.post('/:token/respond', validateBody(respondToAssignmentNotificationSchema), async (req, res) => {
  const body = req.body as RespondToAssignmentNotificationInput;
  const rows = await unwrap(
    adminDb.rpc('respond_via_assignment_link', {
      p_token_hash: hashInviteToken(param(req, 'token')),
      p_status: body.status,
    }),
  );
  const answer = rows?.[0];
  if (!answer || answer.outcome === 'not_found') throw HttpError.notFound('That assignment response link is not valid');
  if (answer.outcome === 'used') {
    throw new HttpError(410, 'This assignment response link has already been used', 'assignment_notification_used');
  }
  if (answer.outcome === 'expired') {
    throw new HttpError(410, 'This assignment response link has expired', 'assignment_notification_expired');
  }

  await deliverEffectNow(answer.effect_id);

  const result: AssignmentRespondResult = { status: body.status, assignments_updated: answer.assignments_updated };
  res.json(result);
});
