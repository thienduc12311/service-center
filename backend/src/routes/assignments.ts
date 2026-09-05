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
import { raw, unwrap, unwrapOne } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import { respondUrlFor, sendScheduleNotifications } from '../services/notifications.js';

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

  const created = await unwrap(
    req.db
      .from('assignments')
      .upsert(
        assignments.map((a) => ({
          plan_id: plan.id,
          user_id: a.user_id,
          team_id: a.team_id,
          position_id: a.position_id ?? null,
          notes: a.notes ?? null,
          status: 'unconfirmed' as const,
          created_by: req.auth.userId,
        })),
        { onConflict: 'plan_id,user_id,team_id,position_id', ignoreDuplicates: true },
      )
      .select('*'),
  );

  if (notify && created?.length) {
    await notifyAssignments(req, plan, created.map((a) => a.id));
  }

  res.status(201).json({ created: created ?? [], conflicts: blocking });
});

/** Re-sends invitations for everyone on the plan who hasn't replied. */
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

  const notified = await notifyAssignments(req, plan, (pending ?? []).map((a) => a.id));
  res.json({ notified });
});

async function notifyAssignments(
  req: { db: import('../lib/supabase.js').Db },
  plan: { id: string; title: string; service_date: string },
  assignmentIds: string[],
): Promise<number> {
  if (assignmentIds.length === 0) return 0;

  const rows = (await unwrap(
    raw(req.db)
      .from('assignments')
      .select(
        'id, person:profiles!assignments_user_id_fkey(full_name, email), team:teams(name), position:team_positions(name)',
      )
      .in('id', assignmentIds),
  )) as unknown as Array<{
    id: string;
    person: { full_name: string | null; email: string | null } | null;
    team: { name: string } | null;
    position: { name: string } | null;
  }>;

  const sent = await sendScheduleNotifications(
    rows
      .filter((r) => r.person?.email)
      .map((r) => ({
        to: r.person!.email!,
        personName: r.person?.full_name ?? null,
        planTitle: plan.title,
        serviceDate: plan.service_date,
        teamName: r.team?.name ?? null,
        positionName: r.position?.name ?? null,
        respondUrl: respondUrlFor(plan.id, r.id),
      })),
  );

  await unwrap(
    req.db.from('assignments').update({ notified_at: new Date().toISOString() }).in('id', assignmentIds),
  );
  return sent;
}

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
    req.db.from('assignments').select('id, user_id').eq('id', param(req, 'id')).maybeSingle(),
  );
  if (!assignment) throw HttpError.notFound('Assignment not found');
  if (assignment.user_id !== req.auth.userId) {
    throw HttpError.forbidden('You can only respond to your own invitations');
  }

  const updated = await unwrapOne(
    req.db
      .from('assignments')
      .update({ status: req.body.status, notes: req.body.notes ?? null })
      .eq('id', assignment.id)
      .select('*')
      .single(),
  );
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
