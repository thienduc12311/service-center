import { Router } from 'express';
import { param } from '../lib/params.js';
import { randomUUID } from 'node:crypto';
import {
  conflictCheckSchema,
  createAssignmentsSchema,
  notifyPlanSchema,
  releaseAssignmentsSchema,
  respondToAssignmentSchema,
  setResponseOwnerSchema,
  type ReleaseAssignmentsInput,
  type SetResponseOwnerInput,
  type AssignmentNotificationSendResult,
  type CreateAssignmentsInput,
  type NotifyPlanInput,
  type RespondToAssignmentInput,
  updateAssignmentSchema,
  type MyScheduleEntry,
  type SchedulingConflict,
} from '@service-center/shared';
import { z } from 'zod';
import { validateBody, validateQuery, parsedQuery } from '../lib/validate.js';
import { requireCapability } from '../middleware/organization.js';
import { adminDb, raw, unwrap } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import { latestDeclineReasons, respondToOwnAssignment } from '../services/assignment-responses.js';
import {
  effectIdForKey,
  latestResponseEffectId,
  notifyPlanAssignments,
} from '../services/deliveries.js';
import { deliverEffectNow } from '../services/delivery-worker.js';

export const planAssignmentsRouter: Router = Router({ mergeParams: true });
export const planNotifyRouter: Router = Router({ mergeParams: true });
export const planReleaseRouter: Router = Router({ mergeParams: true });
export const assignmentsRouter: Router = Router();
export const scheduleRouter: Router = Router();
export const schedulingRouter: Router = Router();

const conflictsFor = async (
  req: { db: import('../lib/supabase.js').Db; orgId: string },
  startsAt: string,
  endsAt: string,
  userIds: string[],
): Promise<SchedulingConflict[]> => {
  const { data, error } = await raw(req.db).rpc('scheduling_conflicts', {
    p_organization_id: req.orgId,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
    p_user_ids: userIds,
  });
  if (error) throw new HttpError(500, error.message, error.code);
  return (data ?? []) as SchedulingConflict[];
};

/** The service window a plan occupies, used for conflict detection. */
const serviceWindow = async (
  db: import('../lib/supabase.js').Db,
  planId: string,
  serviceDate: string,
): Promise<{ starts_at: string; ends_at: string }> => {
  const times = await unwrap(
    db.from('plan_times').select('starts_at, ends_at').eq('plan_id', planId).eq('kind', 'service'),
  );
  if (times?.length) {
    const starts = times.map((t) => new Date(t.starts_at).getTime());
    const ends = times.map((t) => new Date(t.ends_at).getTime());
    return {
      starts_at: new Date(Math.min(...starts)).toISOString(),
      ends_at: new Date(Math.max(...ends)).toISOString(),
    };
  }
  // Plans without explicit times still need a window; assume two hours.
  const start = new Date(serviceDate);
  return {
    starts_at: start.toISOString(),
    ends_at: new Date(start.getTime() + 2 * 60 * 60 * 1000).toISOString(),
  };
};

// ---------------------------------------------- schedule people onto a plan --
planAssignmentsRouter.post('/', requireCapability('scheduling.manage'), validateBody(createAssignmentsSchema), async (req, res) => {
  const planId = param(req, 'planId');
  const { assignments, ignore_conflicts, notify, idempotency_key, visibility, response_owner_id } =
    req.body as CreateAssignmentsInput;

  const plan = await unwrap(
    req.db
      .from('plans')
      .select('id, title, service_date')
      .eq('id', planId)
      .eq('organization_id', req.orgId)
      .maybeSingle(),
  );
  if (!plan) throw HttpError.notFound('Plan not found');

  const window = await serviceWindow(req.db, plan.id, plan.service_date);
  const conflicts = await conflictsFor(
    req,
    window.starts_at,
    window.ends_at,
    assignments.map((a) => a.user_id),
  );

  // Conflicts against this very plan aren't conflicts — they're re-saves.
  const blocking = conflicts.filter((c) => c.plan_id !== plan.id);
  if (blocking.length > 0 && !ignore_conflicts) {
    throw HttpError.conflict(
      'Some people are unavailable or already scheduled at that time',
      blocking,
    );
  }

  // One transaction: same-organization and team-scope checks, the inserts
  // (people already on the plan are skipped) and, when notifying, the request
  // effect for released rows. Prepared rows are never notified here.
  const effectKey = `assignments:${plan.id}:${idempotency_key ?? randomUUID()}`;
  const created = await unwrap(
    req.db.rpc('schedule_plan_assignments', {
      p_plan_id: plan.id,
      p_assignments: assignments.map((a) => ({
        user_id: a.user_id,
        team_id: a.team_id,
        position_id: a.position_id ?? null,
        notes: a.notes ?? null,
        visibility: a.visibility ?? null,
      })),
      p_notify: notify,
      p_effect_key: effectKey,
      p_visibility: visibility ?? null,
      p_response_owner: response_owner_id ?? null,
    }),
  );

  if (notify && (created ?? []).some((row) => row.visibility === 'released')) {
    await deliverEffectNow(await effectIdForKey(req.db, req.orgId, effectKey));
  }

  res.status(201).json({ created: created ?? [], conflicts: blocking });
});

/**
 * Releases exactly the prepared requests the leader reviewed, and records
 * their notification in the same transaction. Repeating it is a no-op.
 */
planReleaseRouter.post('/', requireCapability('scheduling.manage'), validateBody(releaseAssignmentsSchema), async (req, res) => {
  const planId = param(req, 'planId');
  const { assignment_ids, notify, idempotency_key } = req.body as ReleaseAssignmentsInput;
  const plan = await unwrap(
    req.db.from('plans').select('id').eq('id', planId).eq('organization_id', req.orgId).maybeSingle(),
  );
  if (!plan) throw HttpError.notFound('Plan not found');

  const effectKey = `release:${plan.id}:${idempotency_key ?? randomUUID()}`;
  const released = await unwrap(
    req.db.rpc('release_plan_assignments', {
      p_plan_id: plan.id,
      p_assignment_ids: assignment_ids,
      p_notify: notify,
      p_effect_key: effectKey,
    }),
  );
  if (notify && (released ?? []).length > 0) {
    await deliverEffectNow(await effectIdForKey(req.db, req.orgId, effectKey));
  }
  res.json({ released: released ?? [] });
});

/** Re-sends notifications for everyone on the plan who hasn't replied. */
planNotifyRouter.post('/', requireCapability('scheduling.manage'), validateBody(notifyPlanSchema), async (req, res) => {
  const planId = param(req, 'planId');
  const { idempotency_key } = req.body as NotifyPlanInput;
  const plan = await unwrap(
    req.db.from('plans').select('id').eq('id', planId).eq('organization_id', req.orgId).maybeSingle(),
  );
  if (!plan) throw HttpError.notFound('Plan not found');

  // Only released requests are ever reminded; prepared ones were never sent.
  const pending = await unwrap(
    req.db
      .from('assignments')
      .select('id')
      .eq('plan_id', plan.id)
      .eq('status', 'unconfirmed')
      .eq('visibility', 'released'),
  );

  const result: AssignmentNotificationSendResult = await notifyPlanAssignments({
    db: req.db,
    orgId: req.orgId,
    planId: plan.id,
    template: 'assignment_reminder',
    assignmentIds: (pending ?? []).map((a) => a.id),
    idempotencyKey: idempotency_key,
    reason: 'notify',
  });
  res.json(result);
});

export interface ConfirmedAssignmentNotificationInput {
  db: import('../lib/supabase.js').Db;
  orgId: string;
  planId: string;
}

/** After a plan's time or location changes, tell the people who confirmed. */
export const notifyConfirmedAssignmentsForPlan = async (
  input: ConfirmedAssignmentNotificationInput,
): Promise<AssignmentNotificationSendResult> => {
  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const assignments = await unwrap(
    input.db
      .from('assignments')
      .select('id')
      .eq('plan_id', input.planId)
      .eq('status', 'confirmed')
      .eq('visibility', 'released')
      .or(`notified_at.is.null,notified_at.lt.${cutoff}`),
  );
  return notifyPlanAssignments({
    db: input.db,
    orgId: input.orgId,
    planId: input.planId,
    template: 'assignment_request',
    assignmentIds: (assignments ?? []).map((assignment) => assignment.id),
    reason: 'plan-changed',
  });
};

// -------------------------------------------------- single assignment ------
/**
 * Who hears the answers. The new owner must schedule each request's team on
 * its plan; every change is audited.
 */
assignmentsRouter.put('/response-owner', requireCapability('scheduling.manage'), validateBody(setResponseOwnerSchema), async (req, res) => {
  const { assignment_ids, response_owner_id } = req.body as SetResponseOwnerInput;
  res.json(
    (await unwrap(
      req.db.rpc('set_assignment_response_owner', { p_assignment_ids: assignment_ids, p_owner: response_owner_id }),
    )) ?? [],
  );
});

assignmentsRouter.get('/:id/response-owner-history', requireCapability('scheduling.manage'), async (req, res) => {
  res.json(
    (await unwrap(
      req.db
        .from('assignment_owner_changes')
        .select('*')
        .eq('assignment_id', param(req, 'id'))
        .eq('organization_id', req.orgId)
        .order('created_at', { ascending: false }),
    )) ?? [],
  );
});

assignmentsRouter.patch('/:id', requireCapability('scheduling.manage'), validateBody(updateAssignmentSchema), async (req, res) => {
  const updated = await unwrap(
    req.db.from('assignments').update(req.body).eq('id', param(req, 'id')).select('*').maybeSingle(),
  );
  if (!updated) throw HttpError.notFound('Assignment not found');
  res.json(updated);
});

assignmentsRouter.delete('/:id', requireCapability('scheduling.manage'), async (req, res) => {
  await unwrap(req.db.from('assignments').delete().eq('id', param(req, 'id')));
  res.status(204).end();
});

/**
 * Accept, decline or withdraw a confirmation. RLS lets a person update only
 * their own assignment, and a database trigger holds them to the permitted
 * transitions, so this endpoint is safe for every role.
 */
assignmentsRouter.post('/:id/respond', validateBody(respondToAssignmentSchema), async (req, res) => {
  const body = req.body as RespondToAssignmentInput;
  const outcome = await respondToOwnAssignment({
    db: req.db,
    orgId: req.orgId,
    userId: req.auth.userId,
    assignmentId: param(req, 'id'),
    status: body.status,
    reason: body.reason,
    expectedStatus: body.expected_status,
  });
  // The scheduler update was recorded with the answer; deliver it now. A
  // delivery problem never turns a committed answer into an error.
  if (outcome.transition !== 'unchanged') {
    await deliverEffectNow(await latestResponseEffectId(adminDb, outcome.assignment.id));
  }
  res.json(outcome.assignment);
});

// -------------------------------------------------------- my schedule ------
const myScheduleQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  status: z.enum(['unconfirmed', 'confirmed', 'declined']).optional(),
  include_past: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .default(false),
});

scheduleRouter.get('/mine', validateQuery(myScheduleQuerySchema), async (req, res) => {
  const { from, to, status, include_past } = parsedQuery<z.infer<typeof myScheduleQuerySchema>>(res);

  let query = raw(req.db)
    .from('assignments')
    .select(
      `*,
       team:teams(id, name, color),
       position:team_positions(id, name),
       plan:plans!inner(id, title, service_date, location, status, organization_id, times:plan_times(*))`,
    )
    .eq('user_id', req.auth.userId)
    // A recipient surface: a leader who prepared themself still sees only released requests here.
    .eq('visibility', 'released')
    .eq('plan.organization_id', req.orgId);

  if (status) query = query.eq('status', status);
  if (from) query = query.gte('plan.service_date', from);
  else if (!include_past) query = query.gte('plan.service_date', new Date().toISOString());
  if (to) query = query.lte('plan.service_date', to);

  const rows = (await unwrap(query)) as Array<Record<string, unknown>>;

  const entries: MyScheduleEntry[] = rows
    .map((row) => {
      const { plan, team, position, ...assignment } = row as {
        plan: { times?: unknown[] } & Record<string, unknown>;
        team: unknown;
        position: unknown;
      } & Record<string, unknown>;
      const { times = [], ...planFields } = plan ?? {};
      return {
        assignment,
        response_note: null,
        plan: planFields,
        team,
        position,
        times: [...(times as Array<{ starts_at: string }>)].sort(
          (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
        ),
      } as unknown as MyScheduleEntry;
    })
    .sort(
      (a, b) =>
        new Date(a.plan.service_date).getTime() - new Date(b.plan.service_date).getTime(),
    );

  // Only a declined position shows its reason; an earlier decline that a
  // scheduler has since re-requested is history, not the current answer.
  const declined = entries.filter((entry) => entry.assignment.status === 'declined');
  const reasons = await latestDeclineReasons(req.db, declined.map((entry) => entry.assignment.id));
  for (const entry of declined) entry.response_note = reasons.get(entry.assignment.id) ?? null;

  res.json(entries);
});

// ------------------------------------------------------ conflict check -----
schedulingRouter.post('/conflicts', requireCapability('scheduling.manage'), validateBody(conflictCheckSchema), async (req, res) => {
  const { starts_at, ends_at, user_ids } = req.body as {
    starts_at: string;
    ends_at: string;
    user_ids: string[];
  };
  res.json(await conflictsFor(req, starts_at, ends_at, user_ids));
});
