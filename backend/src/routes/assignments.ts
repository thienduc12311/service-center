import { Router } from 'express';
import { param } from '../lib/params.js';
import {
  conflictCheckSchema,
  createAssignmentsSchema,
  respondToAssignmentSchema,
  updateAssignmentSchema,
  type MyScheduleEntry,
  type SchedulingConflict,
} from '@service-center/shared';
import { z } from 'zod';
import { validateBody, validateQuery, parsedQuery } from '../lib/validate.js';
import { requireManager } from '../middleware/organization.js';
import { adminDb, raw, unwrap, unwrapOne } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import { respondUrlFor, sendScheduleNotifications, type ScheduleNotification } from '../services/notifications.js';
import { generateAssignmentToken } from '../services/assignment-tokens.js';
import { renderIcs, type IcsEvent } from '../lib/ics.js';
import { config } from '../config.js';

export const planAssignmentsRouter: Router = Router({ mergeParams: true });
export const planNotifyRouter: Router = Router({ mergeParams: true });
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

/** A row we're about to insert into `assignments`. */
type NewAssignmentRow = {
  plan_id: string;
  user_id: string;
  team_id: string;
  position_id: string | null;
  notes: string | null;
  status: 'unconfirmed';
  created_by: string;
};

/** Identity of an assignment, matching the two partial unique indexes on the table. */
const assignmentKey = (a: { user_id: string; team_id: string; position_id: string | null }): string =>
  `${a.user_id}:${a.team_id}:${a.position_id ?? ''}`;

// ---------------------------------------------- schedule people onto a plan --
planAssignmentsRouter.post('/', requireManager, validateBody(createAssignmentsSchema), async (req, res) => {
  const planId = param(req, 'planId');
  const { assignments, ignore_conflicts, notify } = req.body as {
    assignments: Array<{ user_id: string; team_id: string; position_id?: string | null; notes?: string | null }>;
    ignore_conflicts: boolean;
    notify: boolean;
  };

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

  // The uniqueness rules for an assignment live in two *partial* indexes
  // (one for rows with a position, one for rows without), which Postgres can't
  // infer from a plain `ON CONFLICT (columns)` clause — so skip existing rows
  // here instead of upserting.
  const existing = await unwrap(
    req.db
      .from('assignments')
      .select('user_id, team_id, position_id')
      .eq('plan_id', plan.id)
      .in('user_id', assignments.map((a) => a.user_id)),
  );
  const seen = new Set((existing ?? []).map((a) => assignmentKey(a)));

  const toInsert: NewAssignmentRow[] = [];
  for (const a of assignments) {
    const row: NewAssignmentRow = {
      plan_id: plan.id,
      user_id: a.user_id,
      team_id: a.team_id,
      position_id: a.position_id ?? null,
      notes: a.notes ?? null,
      status: 'unconfirmed',
      created_by: req.auth.userId,
    };
    const key = assignmentKey(row);
    if (seen.has(key)) continue; // already scheduled, or duplicated in this request
    seen.add(key);
    toInsert.push(row);
  }

  const created = toInsert.length
    ? await unwrap(req.db.from('assignments').insert(toInsert).select('*'))
    : [];

  if (notify && created?.length) {
    await notifyAssignments({ db: req.db, orgId: req.orgId, authUserId: req.auth.userId }, plan, created.map((a) => a.id));
  }

  res.status(201).json({ created: created ?? [], conflicts: blocking });
});

/** Re-sends notifications for everyone on the plan who hasn't replied. */
planNotifyRouter.post('/', requireManager, async (req, res) => {
  const planId = param(req, 'planId');
  const plan = await unwrap(
    req.db
      .from('plans')
      .select('id, title, service_date')
      .eq('id', planId)
      .eq('organization_id', req.orgId)
      .maybeSingle(),
  );
  if (!plan) throw HttpError.notFound('Plan not found');

  const pending = await unwrap(
    req.db.from('assignments').select('id').eq('plan_id', plan.id).eq('status', 'unconfirmed'),
  );

  const result = await notifyAssignments({ db: req.db, orgId: req.orgId, authUserId: req.auth.userId }, plan, (pending ?? []).map((a) => a.id));
  res.json(result);
});

interface AssignmentNotificationInput {
  db: import('../lib/supabase.js').Db;
  orgId: string;
  authUserId: string;
}

interface AssignmentNotificationPlan {
  id: string;
  title: string;
  service_date: string;
  location?: string | null;
  organization_id?: string;
  created_by?: string | null;
}

interface NotifyAssignmentsResult {
  notified: number;
  skipped: string[];
}

interface AssignmentNotificationAssignment {
  id: string;
  user_id: string;
  team: { name: string } | null;
  position: { name: string } | null;
}

export const notifyAssignments = async (
  req: AssignmentNotificationInput,
  plan: AssignmentNotificationPlan,
  assignmentIds: string[],
): Promise<NotifyAssignmentsResult> => {
  if (assignmentIds.length === 0) return { notified: 0, skipped: [] };

  const rows = (await unwrap(
    raw(req.db)
      .from('assignments')
      .select('id, user_id, team:teams(name), position:team_positions(name)')
      .in('id', assignmentIds),
  )) as unknown as AssignmentNotificationAssignment[];
  const planRecord = await unwrap(req.db.from('plans').select('organization_id, created_by').eq('id', plan.id).eq('organization_id', req.orgId).single());
  const scheduler = planRecord?.created_by
    ? await unwrap(req.db.from('profiles').select('email').eq('id', planRecord.created_by).maybeSingle())
    : null;
  const organization = await unwrapOne(req.db.from('organizations').select('name').eq('id', planRecord?.organization_id ?? req.orgId).single());
  const userIds = [...new Set(rows.map((row) => row.user_id))];
  const profiles = (await unwrap(raw(req.db).from('profiles').select('id, full_name, email').in('id', userIds))) as Array<{ id: string; full_name: string | null; email: string | null }>;
  const people = (await unwrap(raw(req.db).from('people').select('profile_id, first_name, last_name, email').in('profile_id', userIds))) as Array<{ profile_id: string | null; first_name: string; last_name: string | null; email: string | null }>;
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const personByProfileId = new Map(people.filter((person) => person.profile_id).map((person) => [person.profile_id!, person]));
  const times = (await unwrap(raw(req.db).from('plan_times').select('id, kind, name, starts_at, ends_at, ics_sequence').eq('plan_id', plan.id))) as Array<{ id: string; kind: string; name: string | null; starts_at: string; ends_at: string; ics_sequence: number }>;
  const host = new URL(config.API_URL).host;
  const events: IcsEvent[] = times.map((time) => ({
    uid: `plan-time-${time.id}@${host}`,
    summary: time.name ? `${plan.title} · ${time.name}` : plan.title,
    startsAt: time.starts_at,
    endsAt: time.ends_at,
    sequence: time.ics_sequence,
    location: plan.location,
  }));
  const ics = renderIcs(events, { calendarName: plan.title, productId: `-//${host}//Service Center//EN` });
  const notifications: ScheduleNotification[] = [];
  const skipped: string[] = [];
  const sentUserIds: string[] = [];

  for (const userId of userIds) {
    const profile = profileById.get(userId);
    const person = personByProfileId.get(userId);
    const email = profile?.email ?? person?.email;
    const userRows = rows.filter((row) => row.user_id === userId);
    if (!email) {
      skipped.push(profile?.full_name ?? `${person?.first_name ?? 'Unknown person'} ${person?.last_name ?? ''}`.trim());
      continue;
    }
    const token = generateAssignmentToken(plan.service_date);
    const existing = await unwrap(adminDb.from('assignment_notifications').select('id').eq('plan_id', plan.id).eq('user_id', userId).is('responded_at', null).maybeSingle());
    if (existing) {
      await unwrap(adminDb.from('assignment_notifications').update({ token_hash: token.tokenHash, email, expires_at: token.expiresAt.toISOString(), sent_at: null, created_by: req.authUserId }).eq('id', existing.id));
    } else {
      await unwrap(adminDb.from('assignment_notifications').insert({ organization_id: plan.organization_id ?? req.orgId, plan_id: plan.id, user_id: userId, email, token_hash: token.tokenHash, expires_at: token.expiresAt.toISOString(), created_by: req.authUserId }));
    }
    notifications.push({
      to: email,
      personName: profile?.full_name ?? person?.first_name ?? null,
      planTitle: plan.title,
      serviceDate: plan.service_date,
      teamName: userRows[0]?.team?.name ?? null,
      positionName: userRows[0]?.position?.name ?? null,
      assignments: userRows.map((row) => ({ teamName: row.team?.name ?? null, positionName: row.position?.name ?? null })),
      respondUrl: respondUrlFor(token.token),
      schedulerEmail: scheduler?.email ?? null,
      organizationName: organization.name,
      ics,
    });
    sentUserIds.push(userId);
  }

  const sent = await sendScheduleNotifications(notifications);

  if (sentUserIds.length) {
    const sentAt = new Date().toISOString();
    await unwrap(adminDb.from('assignment_notifications').update({ sent_at: sentAt }).eq('plan_id', plan.id).in('user_id', sentUserIds).is('responded_at', null));
    await unwrap(req.db.from('assignments').update({ notified_at: sentAt }).in('id', rows.filter((row) => sentUserIds.includes(row.user_id)).map((row) => row.id)));
  }
  return { notified: sent, skipped };
}

export interface ConfirmedAssignmentNotificationInput {
  db: import('../lib/supabase.js').Db;
  orgId: string;
  authUserId: string;
  planId: string;
}

export const notifyConfirmedAssignmentsForPlan = async (
  input: ConfirmedAssignmentNotificationInput,
): Promise<NotifyAssignmentsResult> => {
  const plan = await unwrapOne(
    input.db.from('plans').select('id, title, service_date, location, organization_id').eq('id', input.planId).eq('organization_id', input.orgId).single(),
  );
  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const assignments = await unwrap(
    input.db.from('assignments').select('id').eq('plan_id', input.planId).eq('status', 'confirmed').or(`notified_at.is.null,notified_at.lt.${cutoff}`),
  );
  return notifyAssignments(input, plan, (assignments ?? []).map((assignment) => assignment.id));
};

// -------------------------------------------------- single assignment ------
assignmentsRouter.patch('/:id', requireManager, validateBody(updateAssignmentSchema), async (req, res) => {
  const updated = await unwrap(
    req.db.from('assignments').update(req.body).eq('id', param(req, 'id')).select('*').maybeSingle(),
  );
  if (!updated) throw HttpError.notFound('Assignment not found');
  res.json(updated);
});

assignmentsRouter.delete('/:id', requireManager, async (req, res) => {
  await unwrap(req.db.from('assignments').delete().eq('id', param(req, 'id')));
  res.status(204).end();
});

/**
 * Accept or decline. RLS lets a person update only their own assignment, so
 * this endpoint is safe for every role.
 */
assignmentsRouter.post('/:id/respond', validateBody(respondToAssignmentSchema), async (req, res) => {
  const assignment = await unwrap(
    req.db.from('assignments').select('id, user_id, plan_id, created_by').eq('id', param(req, 'id')).maybeSingle(),
  );
  if (!assignment) throw HttpError.notFound('Assignment not found');
  if (assignment.user_id !== req.auth.userId) {
    throw HttpError.forbidden('You can only respond to your own assignments');
  }

  const updated = await unwrapOne(
    req.db
      .from('assignments')
      .update({ status: req.body.status, notes: req.body.notes ?? null, responded_at: new Date().toISOString() })
      .eq('id', assignment.id)
      .select('*')
      .single(),
  );
  if (req.body.status === 'declined' && assignment.created_by) {
    const [scheduler, plan] = await Promise.all([
      unwrap(req.db.from('profiles').select('email').eq('id', assignment.created_by).maybeSingle()),
      unwrapOne(req.db.from('plans').select('title, service_date').eq('id', assignment.plan_id).single()),
    ]);
    if (scheduler?.email) {
      await sendScheduleNotifications([{
        to: scheduler.email,
        personName: null,
        planTitle: `${plan.title} — assignment declined`,
        serviceDate: plan.service_date,
        teamName: null,
        positionName: null,
        respondUrl: `${config.APP_URL}/plans/${assignment.plan_id}`,
      }]);
    }
  }
  res.json(updated);
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

  res.json(entries);
});

// ------------------------------------------------------ conflict check -----
schedulingRouter.post('/conflicts', requireManager, validateBody(conflictCheckSchema), async (req, res) => {
  const { starts_at, ends_at, user_ids } = req.body as {
    starts_at: string;
    ends_at: string;
    user_ids: string[];
  };
  res.json(await conflictsFor(req, starts_at, ends_at, user_ids));
});
