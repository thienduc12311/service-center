import { Router, type Request } from 'express';
import { param } from '../lib/params.js';
import { randomUUID } from 'node:crypto';
import {
  conflictCheckSchema,
  createAssignmentsSchema,
  notifyPlanSchema,
  releaseAssignmentsSchema,
  releaseAssignmentsPreviewSchema,
  respondToAssignmentSchema,
  previewAssignmentResponsesSchema,
  respondToAssignmentSnapshotsSchema,
  setResponseOwnerSchema,
  type ReleaseAssignmentsInput,
  type ReleaseAssignmentsPreviewInput,
  type AssignmentReleasePreview,
  type SetResponseOwnerInput,
  type AssignmentNotificationSendResult,
  type CreateAssignmentsResult,
  type CreateAssignmentsInput,
  type NotifyPlanInput,
  type RespondToAssignmentInput,
  type PreviewAssignmentResponsesInput,
  type RespondToAssignmentSnapshotsInput,
  updateAssignmentSchema,
  type MyScheduleEntry,
  type SchedulingConflict,
  type AssignmentRow,
  type PreferenceWarning,
  checkAssignmentConflictsSchema,
  setAssignmentAttendanceSchema,
  type AssignmentTimeResponseRow,
  type AttendanceInterval,
  type CheckAssignmentConflictsInput,
  type ConflictCheckResult,
  type PlanTimeRow,
  type SetAssignmentAttendanceInput,
} from '@service-center/shared';
import { preferenceWarnings } from '../services/availability.js';
import { attendanceFor, blockingConflicts, checkConflicts } from '../services/attendance.js';
import { isUntimed, timesForAttendance } from '../model/attendance.model.js';
import { TIME_RESPONSE_COLUMNS, withResponseNote, type PublicTimeResponseRow } from '../model/time-response.model.js';
import { timeResponseNotesFor } from '../services/time-response-notes.js';
import { z } from 'zod';
import { validateBody, validateQuery, parsedQuery } from '../lib/validate.js';
import { requireCapability } from '../middleware/organization.js';
import { adminDb, raw, unwrap, unwrapOne, type Db } from '../lib/supabase.js';
import { chunk } from '../lib/chunk.js';
import { fetchAllPages, inChunks } from '../lib/paging.js';
import type { ReleasePreviewAssignment } from '../model/release.model.js';
import { HttpError, fromPostgrestError } from '../lib/errors.js';
import { createResponses, latestDeclineReasons } from '../services/assignment-responses.js';
import { effectIdForKey, notificationSendResult, notifyPlanAssignments } from '../services/deliveries.js';
import { isHeldUntilPublish } from '../model/plan-publish.model.js';
import { deliverEffectNow } from '../services/delivery-worker.js';
import { releasePlanAssignments } from '../services/releases.js';

export const planAssignmentsRouter: Router = Router({ mergeParams: true });
export const planNotifyRouter: Router = Router({ mergeParams: true });
export const planReleaseRouter: Router = Router({ mergeParams: true });
export const assignmentsRouter: Router = Router();
export const scheduleRouter: Router = Router();
export const schedulingRouter: Router = Router();
export const planAssignmentTimesRouter: Router = Router({ mergeParams: true });

const responses = createResponses({ serviceDb: adminDb, deliver: deliverEffectNow });

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
  if (error) throw fromPostgrestError(error);
  return (data ?? []) as SchedulingConflict[];
};

/**
 * F03: preference warnings never block scheduling. When a scheduler goes
 * ahead anyway, each affected new assignment records which warnings applied
 * and the optional reason, so the decision is reviewable later.
 */
const recordPreferenceOverrides = async (
  req: Request,
  planId: string,
  created: ReadonlyArray<Pick<AssignmentRow, 'id' | 'person_id' | 'team_id'>>,
  reason: string | null,
): Promise<PreferenceWarning[]> => {
  const byTeam = new Map<string, Set<string>>();
  for (const row of created) {
    if (!row.person_id || !row.team_id) continue;
    byTeam.set(row.team_id, (byTeam.get(row.team_id) ?? new Set()).add(row.person_id));
  }
  const ctx = { db: req.db, orgId: req.orgId, userId: req.auth.userId, access: req.access };
  const warnings: PreferenceWarning[] = [];
  const overrides: Array<{ organization_id: string; assignment_id: string; warning_codes: string[]; reason: string | null }> = [];
  for (const [teamId, people] of byTeam) {
    const teamWarnings = await preferenceWarnings(ctx, { plan_id: planId, team_id: teamId, person_ids: [...people] });
    warnings.push(...teamWarnings);
    for (const row of created.filter((r) => r.team_id === teamId)) {
      const codes = [...new Set(teamWarnings.filter((w) => w.person_id === row.person_id).map((w) => w.code))];
      if (codes.length) overrides.push({ organization_id: req.orgId, assignment_id: row.id, warning_codes: codes, reason });
    }
  }
  if (overrides.length) await unwrap(req.db.from('assignment_preference_overrides').insert(overrides));
  return warnings;
};

// ---------------------------------------------- schedule people onto a plan --
planAssignmentsRouter.post('/', requireCapability('scheduling.manage'), validateBody(createAssignmentsSchema), async (req, res) => {
  const planId = param(req, 'planId');
  const {
    assignments,
    ignore_conflicts,
    conflict_override_reason,
    notify,
    idempotency_key,
    visibility,
    response_owner_id,
    preference_override_reason,
  } = req.body as CreateAssignmentsInput;

  const plan = await unwrap(
    req.db
      .from('plans')
      .select('id, status')
      .eq('id', planId)
      .eq('organization_id', req.orgId)
      .maybeSingle(),
  );
  if (!plan) throw HttpError.notFound('Plan not found');
  // F04: actual attendance intervals through the shared resolver (rehearsals,
  // gaps and touching ends included). Blocking conflicts need a reason and the
  // override capability; the database re-checks under per-Person locks at
  // commit, so this preview can never let a stale decision through.
  const check = await checkConflicts(
    { db: req.db, orgId: req.orgId },
    assignments.map((assignment, index) => ({
      key: String(index),
      person_id: assignment.person_id,
      user_id: assignment.user_id,
      plan_id: plan.id,
      team_id: assignment.team_id,
      position_id: assignment.position_id ?? null,
      attendance_mode: assignment.attendance_mode,
      time_ids: assignment.attendance_mode === 'selected' ? assignment.time_ids : [],
    })),
  );
  const blocking = blockingConflicts(check);
  const overrideReason = conflict_override_reason?.trim() || null;
  if (blocking.length > 0 && !overrideReason) {
    throw new HttpError(
      409,
      ignore_conflicts
        ? 'Give a reason to schedule over these conflicts'
        : 'Some people are unavailable or already scheduled at that time',
      'scheduling_conflict',
      check.conflicts,
    );
  }
  if (blocking.length > 0 && !check.override_permitted) {
    throw HttpError.forbidden('You cannot schedule over these conflicts');
  }

  // One transaction: same-organization and team-scope checks, the inserts
  // (people already on the plan are skipped) and, when notifying, the request
  // effect for released rows. Prepared rows are never notified here, and
  // nothing is sent on a draft plan (ADR-0006): publishing asks them.
  const heldUntilPublish = isHeldUntilPublish(plan.status);
  const effectKey = `assignments:${plan.id}:${idempotency_key ?? randomUUID()}`;
  const created = await unwrap(
    req.db.rpc('schedule_plan_assignments', {
      p_plan_id: plan.id,
      p_assignments: assignments.map((a) => ({
        user_id: a.user_id,
        person_id: a.person_id ?? null,
        team_id: a.team_id,
        position_id: a.position_id ?? null,
        notes: a.notes ?? null,
        visibility: a.visibility ?? null,
        attendance_mode: a.attendance_mode,
        time_ids: a.time_ids,
      })),
      p_notify: notify,
      p_effect_key: effectKey,
      p_visibility: visibility ?? null,
      p_response_owner: response_owner_id ?? null,
      p_conflict_override_reason: blocking.length > 0 ? overrideReason : null,
    }),
  );

  if (notify && !heldUntilPublish && (created ?? []).some((row) => row.visibility === 'released')) {
    await deliverEffectNow(await effectIdForKey(req.db, req.orgId, effectKey));
  }

  const warnings = await recordPreferenceOverrides(req, plan.id, created ?? [], preference_override_reason ?? null);
  const result: CreateAssignmentsResult = {
    created: created ?? [],
    conflicts: check.conflicts,
    warnings,
    ...(heldUntilPublish ? { held_until_publish: true } : {}),
  };
  res.status(201).json(result);
});

/**
 * Releases exactly the prepared requests the leader reviewed as a one-plan
 * F08 release batch (one message per Person), recorded in the same
 * transaction. Repeating it with the same idempotency key is a no-op.
 */
planReleaseRouter.post('/', requireCapability('scheduling.manage'), validateBody(releaseAssignmentsSchema), async (req, res) => {
  const planId = param(req, 'planId');
  const input = req.body as ReleaseAssignmentsInput;
  const plan = await unwrap(
    req.db.from('plans').select('id').eq('id', planId).eq('organization_id', req.orgId).maybeSingle(),
  );
  if (!plan) throw HttpError.notFound('Plan not found');
  const released: AssignmentRow[] = await releasePlanAssignments(req.db, req.orgId, req.auth.userId, plan.id, input);
  res.json({ released });
});

planReleaseRouter.post(
  '/preview',
  requireCapability('scheduling.manage'),
  validateBody(releaseAssignmentsPreviewSchema),
  async (req, res) => {
    const planId = param(req, 'planId');
    const { assignment_ids } = req.body as ReleaseAssignmentsPreviewInput;
    // Up to 500 requests: URL-safe `.in()` chunks.
    const assignments = await inChunks(assignment_ids, async (ids) => (await unwrap(
      raw(req.db).from('assignments').select(
        'id, person_id, request_revision, team:teams(name), position:team_positions(name)',
      ).eq('plan_id', planId).eq('visibility', 'prepared').in('id', ids),
    )) as unknown as ReleasePreviewAssignment[] | null);
    if (assignments.length !== assignment_ids.length) {
      throw new HttpError(409, 'Prepared requests changed. Refresh the release review.', 'assignment_release_stale');
    }
    const [times, attendance, people] = await Promise.all([
      unwrap(req.db.from('plan_times').select('*').eq('plan_id', planId).order('sort_order')),
      attendanceFor(req.db, assignment_ids),
      inChunks([...new Set(assignments.map((assignment) => assignment.person_id))], (ids) =>
        unwrap(req.db.from('people_directory').select('*').in('id', ids))),
    ]);
    const personNames = new Map((people ?? []).map((person) => [
      person.id,
      [person.first_name, person.last_name].filter(Boolean).join(' '),
    ]));
    const preview: AssignmentReleasePreview = {
      plan_id: planId,
      assignments: assignments.map((assignment) => ({
        assignment_id: assignment.id,
        person_id: assignment.person_id,
        person_name: personNames.get(assignment.person_id) ?? 'Person',
        team_name: assignment.team?.name ?? 'Team',
        position_name: assignment.position?.name ?? null,
        request_revision: assignment.request_revision,
        times: timesForAttendance(attendance.get(assignment.id) ?? [], times ?? []),
        untimed: isUntimed(attendance.get(assignment.id) ?? []),
      })),
    };
    res.json(preview);
  },
);

/** Re-sends notifications for everyone on the plan who hasn't replied. */
planNotifyRouter.post('/', requireCapability('scheduling.manage'), validateBody(notifyPlanSchema), async (req, res) => {
  const planId = param(req, 'planId');
  const { idempotency_key } = req.body as NotifyPlanInput;
  const plan = await unwrap(
    req.db.from('plans').select('id, status').eq('id', planId).eq('organization_id', req.orgId).maybeSingle(),
  );
  if (!plan) throw HttpError.notFound('Plan not found');
  // ADR-0006: a draft plan sends nothing; publishing asks everyone released.
  if (isHeldUntilPublish(plan.status)) {
    const held: AssignmentNotificationSendResult = { ...(await notificationSendResult(req.db, null)), held_until_publish: true };
    res.json(held);
    return;
  }

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

/** Freezes exactly the selected released requests/times for a review screen. */
assignmentsRouter.post(
  '/responses/preview',
  validateBody(previewAssignmentResponsesSchema),
  async (req, res) => {
    const { assignment_ids } = req.body as PreviewAssignmentResponsesInput;
    res.json(await responses.previewSnapshots({ db: req.db, orgId: req.orgId }, assignment_ids));
  },
);

/** Commits every reviewed snapshot atomically, with transport retry safety. */
assignmentsRouter.post(
  '/responses/commit',
  validateBody(respondToAssignmentSnapshotsSchema),
  async (req, res) => {
    const body = req.body as RespondToAssignmentSnapshotsInput;
    res.json(await responses.commitSnapshotResponses({ db: req.db, orgId: req.orgId }, body));
  },
);

assignmentsRouter.patch('/:id', requireCapability('scheduling.manage'), validateBody(updateAssignmentSchema), async (req, res) => {
  const updated = await unwrap(
    req.db.from('assignments').update(req.body).eq('id', param(req, 'id')).select('*').maybeSingle(),
  );
  if (!updated) throw HttpError.notFound('Assignment not found');
  res.json(updated);
});

/**
 * Removing a request is how a scheduler withdraws it, sent or not. Live
 * response snapshots drop it in the database; anything else that still holds
 * on to the row reads as a conflict rather than a bad request.
 */
assignmentsRouter.delete('/:id', requireCapability('scheduling.manage'), async (req, res) => {
  const { data, error } = await req.db.from('assignments').delete().eq('id', param(req, 'id')).select('id');
  if (error?.code === '23503') {
    throw HttpError.conflict('This assignment is still in use and cannot be removed yet');
  }
  if (error) throw fromPostgrestError(error);
  if (!data || data.length === 0) throw HttpError.notFound('Assignment not found');
  res.status(204).end();
});

/**
 * Accept, decline or withdraw a confirmation. The database checks and writes
 * the answer as the caller (RLS: only their own assignment), so this endpoint
 * is safe for every role.
 */
assignmentsRouter.post('/:id/respond', validateBody(respondToAssignmentSchema), async (req, res) => {
  const body = req.body as RespondToAssignmentInput;
  res.json(
    await responses.respondAsSelf({
      db: req.db,
      orgId: req.orgId,
      assignmentId: param(req, 'id'),
      status: body.status,
      reason: body.reason,
      expectedStatus: body.expected_status,
    }),
  );
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

/**
 * Time responses for many assignments, in URL-safe batches (W7-RESP-D5). The
 * private decline reason is attached only where the caller may read it (W9-JRN-D1).
 */
const timeResponsesFor = async (db: Db, assignmentIds: readonly string[]): Promise<AssignmentTimeResponseRow[]> => {
  const [batches, notes] = await Promise.all([
    Promise.all(
      chunk(assignmentIds).map((ids) =>
        unwrap(db.from('assignment_time_responses').select(TIME_RESPONSE_COLUMNS).in('assignment_id', ids)),
      ),
    ),
    timeResponseNotesFor(db, assignmentIds),
  ]);
  return batches.flatMap((rows): PublicTimeResponseRow[] => rows ?? []).map((row) => withResponseNote(row, notes));
};

scheduleRouter.get('/mine', validateQuery(myScheduleQuerySchema), async (req, res) => {
  const { from, to, status, include_past } = parsedQuery<z.infer<typeof myScheduleQuerySchema>>(res);

  const me = await unwrap(
    req.db.from('people').select('id').eq('organization_id', req.orgId).eq('profile_id', req.auth.userId).maybeSingle(),
  );
  if (!me) return res.json([]);

  // Every page, on the assignment's unique id: a long history passes PostgREST's
  // 1000-row cap and used to drop entries silently (W9-DATA-D4). Sorted by date below.
  const since = from || (include_past ? undefined : new Date().toISOString());
  const rows = await fetchAllPages(async (pageFrom, pageTo) => {
    let query = raw(req.db)
      .from('assignments')
      .select(
        `*,
         team:teams(id, name, color),
         position:team_positions(id, name),
         plan:plans!inner(id, title, service_date, location, status, organization_id, times:plan_times(*))`,
      )
      .eq('person_id', me.id)
      // A recipient surface: a leader who prepared themself still sees only released requests here.
      .eq('visibility', 'released')
      .eq('plan.organization_id', req.orgId);
    if (status) query = query.eq('status', status);
    if (since) query = query.gte('plan.service_date', since);
    if (to) query = query.lte('plan.service_date', to);
    return (await unwrap(query.order('id').range(pageFrom, pageTo))) as Array<Record<string, unknown>> | null;
  });
  const assignmentIds = rows.map((row) => String(row.id));
  const [attendance, timeResponses] = assignmentIds.length
    ? await Promise.all([
        attendanceFor(req.db, assignmentIds),
        timeResponsesFor(req.db, assignmentIds),
      ])
    : [new Map<string, AttendanceInterval[]>(), []];

  const entries: MyScheduleEntry[] = rows
    .map((row) => {
      const { plan, team, position, ...assignment } = row as {
        plan: { times?: unknown[] } & Record<string, unknown>;
        team: unknown;
        position: unknown;
      } & Record<string, unknown>;
      const { times = [], ...planFields } = plan ?? {};
      const assignmentId = String(assignment.id);
      const covered = attendance.get(assignmentId) ?? [];
      return {
        assignment,
        response_note: null,
        plan: planFields,
        team,
        position,
        // F04: only the times this request covers, from the shared resolver.
        times: timesForAttendance(covered, times as PlanTimeRow[]),
        time_responses: (timeResponses ?? []).filter((response) => response.assignment_id === assignmentId),
        untimed: isUntimed(covered),
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

/**
 * F04: typed, redacted conflicts for prospective requests — actual
 * service/rehearsal/other intervals, blockouts as their own kind, and whether
 * the caller may schedule over each one.
 */
schedulingRouter.post(
  '/conflicts/check',
  requireCapability('scheduling.manage'),
  validateBody(checkAssignmentConflictsSchema),
  async (req, res) => {
    const { candidates, exclude_assignment_ids } = req.body as CheckAssignmentConflictsInput;
    const result: ConflictCheckResult = await checkConflicts(
      { db: req.db, orgId: req.orgId },
      candidates,
      exclude_assignment_ids,
    );
    res.json(result);
  },
);

/**
 * F04: change which times existing requests cover. Expected revisions make a
 * stale editor fail; released requests whose times changed are re-sent to
 * exactly those people, and older reviews/links for them become stale.
 */
planAssignmentTimesRouter.put(
  '/',
  requireCapability('scheduling.manage'),
  validateBody(setAssignmentAttendanceSchema),
  async (req, res) => {
    const planId = param(req, 'planId');
    const { changes, conflict_override_reason, notify, idempotency_key } = req.body as SetAssignmentAttendanceInput;
    await unwrapOne(req.db.from('plans').select('id').eq('id', planId).eq('organization_id', req.orgId).single());
    const effectKey = `attendance:${planId}:${idempotency_key ?? randomUUID()}`;
    const updated = await unwrap(
      req.db.rpc('set_assignment_attendance', {
        p_plan_id: planId,
        p_changes: changes,
        p_conflict_override_reason: conflict_override_reason ?? null,
        p_notify: notify,
        p_effect_key: effectKey,
      }),
    );
    if (notify) {
      const effect = await unwrap(
        req.db.from('delivery_effects').select('id').eq('organization_id', req.orgId).eq('effect_key', effectKey).maybeSingle(),
      );
      if (effect) await deliverEffectNow(effect.id);
    }
    res.json({ updated: updated ?? [] });
  },
);
