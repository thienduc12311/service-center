import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  type AssignmentRespondPreview,
  type AssignmentRespondResult,
  type AssignmentRequestSnapshotRow,
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
import { loadAssignmentResponseReview } from '../services/assignment-snapshots.js';

export const assignmentRespondRouter: Router = Router();
assignmentRespondRouter.use(rateLimit({ windowMs: 60_000, limit: config.isProduction ? 30 : 10_000, standardHeaders: 'draft-7', legacyHeaders: false }));

interface AssignmentNotificationRecord {
  id: string;
  plan_id: string;
  organization_id: string;
  person_id: string;
  user_id: string | null;
  snapshot_id: string | null;
  email: string;
  expires_at: string;
  responded_at: string | null;
}

interface StoredNotification extends AssignmentNotificationRecord {
  token_hash: string;
  previous_token_hash: string | null;
  previous_snapshot_id: string | null;
  previous_expires_at: string | null;
}

/**
 * Resolves a link token. F08: the last provider-accepted token stays usable
 * (with its own exact snapshot) until its replacement is accepted, so the
 * preview reads whichever snapshot the presented token was issued for —
 * the same rule `respond_via_assignment_link` applies.
 */
const loadNotification = async (token: string): Promise<AssignmentNotificationRecord> => {
  const hash = hashInviteToken(token);
  const notification = await unwrap(
    adminDb.from('assignment_notifications')
      .select('id, plan_id, organization_id, person_id, user_id, snapshot_id, email, expires_at, responded_at, token_hash, previous_token_hash, previous_snapshot_id, previous_expires_at')
      .or(`token_hash.eq.${hash},previous_token_hash.eq.${hash}`)
      .maybeSingle(),
  );
  if (!notification) throw HttpError.notFound('That assignment response link is not valid');
  const stored = notification as StoredNotification;
  const viaPrevious = stored.token_hash !== hash;
  const record: AssignmentNotificationRecord = {
    id: stored.id,
    plan_id: stored.plan_id,
    organization_id: stored.organization_id,
    person_id: stored.person_id,
    user_id: stored.user_id,
    snapshot_id: viaPrevious ? stored.previous_snapshot_id : stored.snapshot_id,
    email: stored.email,
    expires_at: (viaPrevious ? stored.previous_expires_at : stored.expires_at) ?? stored.expires_at,
    responded_at: stored.responded_at,
  };
  if (record.responded_at) throw new HttpError(410, 'This assignment response link has already been used', 'assignment_notification_used');
  if (new Date(record.expires_at) <= new Date()) throw new HttpError(410, 'This assignment response link has expired', 'assignment_notification_expired');
  return record;
};

assignmentRespondRouter.get('/:token', async (req, res) => {
  const notification = await loadNotification(param(req, 'token'));
  if (!notification.snapshot_id) throw new HttpError(409, 'This response link needs to be reissued', 'assignment_request_stale');
  const [plan, person, snapshot] = await Promise.all([
    unwrapOne(adminDb.from('plans').select('title, service_date, location').eq('id', notification.plan_id).single()),
    unwrap(adminDb.from('people').select('first_name, preferred_language').eq('id', notification.person_id).maybeSingle()),
    unwrap(adminDb.from('assignment_request_snapshots').select('*').eq('id', notification.snapshot_id).maybeSingle()),
  ]);
  if (!snapshot || snapshot.superseded_at || snapshot.consumed_at) {
    throw new HttpError(409, 'This request changed. Ask your scheduler for a fresh link.', 'assignment_request_stale');
  }
  const review = await loadAssignmentResponseReview(snapshot as AssignmentRequestSnapshotRow);
  const serviceTime = review.assignments.flatMap((assignment) => assignment.times).find((time) => time.kind === 'service') ?? null;
  const preview: AssignmentRespondPreview = {
    snapshot_id: review.snapshot_id,
    snapshot_version: review.version,
    plan_title: plan.title,
    service_date: plan.service_date,
    service_time: serviceTime ? { starts_at: serviceTime.starts_at, ends_at: serviceTime.ends_at } : null,
    location: plan.location,
    person_first_name: person?.first_name ?? '',
    // Token verified above: the recipient's own language may be used for this page.
    preferred_language: person?.preferred_language ?? null,
    assignments: review.assignments.map((assignment) => ({
      assignment_id: assignment.assignment_id,
      team_name: assignment.team_name,
      position_name: assignment.position_name,
      status: assignment.status,
      request_revision: assignment.request_revision,
      times: assignment.times,
      time_responses: assignment.time_responses,
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
  if (answer.outcome === 'stale') {
    throw new HttpError(409, 'This request changed. Refresh or ask your scheduler for a new link.', 'assignment_request_stale');
  }

  await deliverEffectNow(answer.effect_id);

  const result: AssignmentRespondResult = { status: body.status, assignments_updated: answer.assignments_updated };
  res.json(result);
});
