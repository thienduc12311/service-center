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
  type CreateAssignmentsInput,
  type NotifyPlanInput,
  type RespondToAssignmentInput,
  type PreviewAssignmentResponsesInput,
  type RespondToAssignmentSnapshotsInput,
  type AssignmentRequestSnapshotRow,
  type AssignmentResponseCommitResult,
  updateAssignmentSchema,
  type MyScheduleEntry,
  type SchedulingConflict,
  type AssignmentRow,
  type PreferenceWarning,
} from '@service-center/shared';
import { preferenceWarnings } from '../services/availability.js';
import { z } from 'zod';
import { validateBody, validateQuery, parsedQuery } from '../lib/validate.js';
import { requireCapability } from '../middleware/organization.js';
import { adminDb, raw, unwrap } from '../lib/supabase.js';
import { HttpError, fromPostgrestError } from '../lib/errors.js';
import { latestDeclineReasons, respondToOwnAssignment } from '../services/assignment-responses.js';
import {
  effectIdForKey,
  latestResponseEffectId,
  notifyPlanAssignments,
} from '../services/deliveries.js';
import { deliverEffectNow } from '../services/delivery-worker.js';
import { loadAssignmentResponseReview } from '../services/assignment-snapshots.js';

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

interface ExactConflictScope {
  personId: string;
  timeIds: string[];
}

const exactConflictsFor = async (
  req: { db: import('../lib/supabase.js').Db; orgId: string },
  scopes: readonly ExactConflictScope[],
): Promise<SchedulingConflict[]> => {
  const rows = await Promise.all(
    scopes.filter((scope) => scope.timeIds.length > 0).map(async (scope) => {
      const { data, error } = await raw(req.db).rpc('scheduling_conflicts_for_people', {
        p_organization_id: req.orgId,
        p_person_ids: [scope.personId],
        p_plan_time_ids: scope.timeIds,
        p_exclude_assignment_ids: [],
      });
      if (error) throw new HttpError(500, error.message, error.code);
      return (data ?? []).map((conflict: {
        person_id: string;
        conflict_type: 'blockout' | 'double_booked';
        detail: string | null;
        starts_at: string;
        ends_at: string;
        plan_id: string | null;
      }) => ({
        user_id: conflict.person_id,
        conflict_type: conflict.conflict_type,
        detail: conflict.detail,
        starts_at: conflict.starts_at,
        ends_at: conflict.ends_at,
        plan_id: conflict.plan_id,
      } satisfies SchedulingConflict));
    }),
  );
  return rows.flat();
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
  const { assignments, ignore_conflicts, notify, idempotency_key, visibility, response_owner_id, preference_override_reason } =
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
  const planTimes = (await unwrap(req.db.from('plan_times').select('id').eq('plan_id', plan.id))) ?? [];

  const legacyUserIds = assignments.flatMap((assignment) => assignment.user_id ? [assignment.user_id] : []);
  const linked = legacyUserIds.length
    ? await unwrap(req.db.from('people').select('id, profile_id').eq('organization_id', req.orgId).in('profile_id', legacyUserIds))
    : [];
  const personForProfile = new Map((linked ?? []).map((person) => [person.profile_id, person.id]));
  const scopes = assignments.map((assignment): ExactConflictScope => ({
    personId: assignment.person_id ?? personForProfile.get(assignment.user_id ?? '') ?? '',
    timeIds: assignment.attendance_mode === 'selected'
      ? assignment.time_ids
      : planTimes.map((time) => time.id),
  }));
  let conflicts = await exactConflictsFor(req, scopes.filter((scope) => Boolean(scope.personId)));
  if (planTimes.length === 0 && legacyUserIds.length > 0) {
    const window = await serviceWindow(req.db, plan.id, plan.service_date);
    conflicts = await conflictsFor(req, window.starts_at, window.ends_at, legacyUserIds);
  }

  const blocking = conflicts;
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
    }),
  );

  if (notify && (created ?? []).some((row) => row.visibility === 'released')) {
    await deliverEffectNow(await effectIdForKey(req.db, req.orgId, effectKey));
  }

  const warnings = await recordPreferenceOverrides(req, plan.id, created ?? [], preference_override_reason ?? null);
  res.status(201).json({ created: created ?? [], conflicts: blocking, warnings });
});

/**
 * Releases exactly the prepared requests the leader reviewed, and records
 * their notification in the same transaction. Repeating it is a no-op.
 */
planReleaseRouter.post('/', requireCapability('scheduling.manage'), validateBody(releaseAssignmentsSchema), async (req, res) => {
  const planId = param(req, 'planId');
  const { assignment_ids, expected_revisions, notify, idempotency_key } = req.body as ReleaseAssignmentsInput;
  const plan = await unwrap(
    req.db.from('plans').select('id').eq('id', planId).eq('organization_id', req.orgId).maybeSingle(),
  );
  if (!plan) throw HttpError.notFound('Plan not found');

  const revisions = expected_revisions.length > 0
    ? expected_revisions
    : ((await unwrap(
        req.db.from('assignments').select('id, request_revision').eq('plan_id', plan.id).in('id', assignment_ids),
      )) ?? []).map((assignment) => ({
        assignment_id: assignment.id,
        request_revision: assignment.request_revision,
      }));

  const effectKey = `release:${plan.id}:${idempotency_key ?? randomUUID()}`;
  const released = await unwrap(
    req.db.rpc('release_plan_assignments_versioned', {
      p_plan_id: plan.id,
      p_assignment_ids: assignment_ids,
      p_expected_revisions: revisions,
      p_notify: notify,
      p_effect_key: effectKey,
    }),
  );
  if (notify && (released ?? []).length > 0) {
    await deliverEffectNow(await effectIdForKey(req.db, req.orgId, effectKey));
  }
  res.json({ released: released ?? [] });
});

planReleaseRouter.post(
  '/preview',
  requireCapability('scheduling.manage'),
  validateBody(releaseAssignmentsPreviewSchema),
  async (req, res) => {
    const planId = param(req, 'planId');
    const { assignment_ids } = req.body as ReleaseAssignmentsPreviewInput;
    const assignments = await unwrap(
      raw(req.db).from('assignments').select(
        'id, person_id, attendance_mode, request_revision, team:teams(name), position:team_positions(name)',
      ).eq('plan_id', planId).eq('visibility', 'prepared').in('id', assignment_ids),
    ) as unknown as Array<{
      id: string;
      person_id: string;
      attendance_mode: 'all' | 'selected';
      request_revision: number;
      team: { name: string } | null;
      position: { name: string } | null;
    }>;
    if (assignments.length !== assignment_ids.length) {
      throw new HttpError(409, 'Prepared requests changed. Refresh the release review.', 'assignment_release_stale');
    }
    const [times, selected, people] = await Promise.all([
      unwrap(req.db.from('plan_times').select('*').eq('plan_id', planId).order('sort_order')),
      unwrap(req.db.from('assignment_attendance_times').select('*').in('assignment_id', assignment_ids)),
      unwrap(req.db.from('people_directory').select('*').in('id', assignments.map((assignment) => assignment.person_id))),
    ]);
    const personNames = new Map((people ?? []).map((person) => [
      person.id,
      [person.first_name, person.last_name].filter(Boolean).join(' '),
    ]));
    const selectedByAssignment = new Map<string, Set<string>>();
    for (const row of selected ?? []) {
      const ids = selectedByAssignment.get(row.assignment_id) ?? new Set<string>();
      ids.add(row.plan_time_id);
      selectedByAssignment.set(row.assignment_id, ids);
    }
    const preview: AssignmentReleasePreview = {
      plan_id: planId,
      assignments: assignments.map((assignment) => ({
        assignment_id: assignment.id,
        person_id: assignment.person_id,
        person_name: personNames.get(assignment.person_id) ?? 'Person',
        team_name: assignment.team?.name ?? 'Team',
        position_name: assignment.position?.name ?? null,
        request_revision: assignment.request_revision,
        times: assignment.attendance_mode === 'selected'
          ? (times ?? []).filter((time) => selectedByAssignment.get(assignment.id)?.has(time.id))
          : (times ?? []),
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

/** Freezes exactly the selected released requests/times for a review screen. */
assignmentsRouter.post(
  '/responses/preview',
  validateBody(previewAssignmentResponsesSchema),
  async (req, res) => {
    const { assignment_ids } = req.body as PreviewAssignmentResponsesInput;
    const snapshots = (await unwrap(
      req.db.rpc('preview_assignment_responses', {
        p_organization_id: req.orgId,
        p_assignment_ids: assignment_ids,
      }),
    )) as AssignmentRequestSnapshotRow[];
    res.json(await Promise.all(snapshots.map(loadAssignmentResponseReview)));
  },
);

/** Commits every reviewed snapshot atomically, with transport retry safety. */
assignmentsRouter.post(
  '/responses/commit',
  validateBody(respondToAssignmentSnapshotsSchema),
  async (req, res) => {
    const body = req.body as RespondToAssignmentSnapshotsInput;
    const result = (await unwrap(
      req.db.rpc('respond_to_assignment_snapshots', {
        p_organization_id: req.orgId,
        p_responses: body.responses,
        p_idempotency_key: body.idempotency_key,
      }),
    )) as AssignmentResponseCommitResult;
    await Promise.all(result.effect_ids.map(deliverEffectNow));
    res.json(result);
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
  const { error } = await req.db.from('assignments').delete().eq('id', param(req, 'id'));
  if (error?.code === '23503') {
    throw HttpError.conflict('This assignment is still in use and cannot be removed yet');
  }
  if (error) throw fromPostgrestError(error);
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

  const me = await unwrap(
    req.db.from('people').select('id').eq('organization_id', req.orgId).eq('profile_id', req.auth.userId).maybeSingle(),
  );
  if (!me) return res.json([]);

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
  if (from) query = query.gte('plan.service_date', from);
  else if (!include_past) query = query.gte('plan.service_date', new Date().toISOString());
  if (to) query = query.lte('plan.service_date', to);

  const rows = (await unwrap(query)) as Array<Record<string, unknown>>;
  const assignmentIds = rows.map((row) => String(row.id));
  const [selectedTimes, timeResponses] = assignmentIds.length
    ? await Promise.all([
        unwrap(req.db.from('assignment_attendance_times').select('*').in('assignment_id', assignmentIds)),
        unwrap(req.db.from('assignment_time_responses').select('*').in('assignment_id', assignmentIds)),
      ])
    : [[], []];
  const selectedByAssignment = new Map<string, Set<string>>();
  for (const selected of selectedTimes ?? []) {
    const ids = selectedByAssignment.get(selected.assignment_id) ?? new Set<string>();
    ids.add(selected.plan_time_id);
    selectedByAssignment.set(selected.assignment_id, ids);
  }

  const entries: MyScheduleEntry[] = rows
    .map((row) => {
      const { plan, team, position, ...assignment } = row as {
        plan: { times?: unknown[] } & Record<string, unknown>;
        team: unknown;
        position: unknown;
      } & Record<string, unknown>;
      const { times = [], ...planFields } = plan ?? {};
      const assignmentId = String(assignment.id);
      const applicable = assignment.attendance_mode === 'selected'
        ? (times as Array<{ id: string; starts_at: string }>).filter((time) =>
            selectedByAssignment.get(assignmentId)?.has(time.id),
          )
        : (times as Array<{ id: string; starts_at: string }>);
      return {
        assignment,
        response_note: null,
        plan: planFields,
        team,
        position,
        times: [...applicable].sort(
          (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
        ),
        time_responses: (timeResponses ?? []).filter((response) => response.assignment_id === assignmentId),
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
