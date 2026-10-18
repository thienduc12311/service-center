import { Router, type Request } from 'express';
import {
  calendarQuerySchema,
  type AssignmentStatus,
  type CalendarEvent,
  type CalendarQuery,
} from '@service-center/shared';
import { attendanceFor } from '../services/attendance.js';
import { parsedQuery, validateQuery } from '../lib/validate.js';
import { raw, unwrap } from '../lib/supabase.js';

export const calendarRouter: Router = Router();

interface RawPlanTime {
  id: string;
  kind: CalendarEvent['kind'];
  name: string | null;
  starts_at: string;
  ends_at: string;
  plan: {
    id: string;
    title: string;
    status: CalendarEvent['status'];
    location: string | null;
    service_type_id: string | null;
    service_type: { name: string } | null;
    assignments: Array<{ team_id: string; visibility: string }>;
  } | null;
}

/** An answer that still stands outranks a decline on another position. */
const STATUS_RANK: Record<AssignmentStatus, number> = { confirmed: 2, unconfirmed: 1, declined: 0 };

/** For each plan time, my status on the released request(s) that cover it. */
const myStatusForTimes = async (req: Request, planIds: readonly string[]): Promise<Map<string, AssignmentStatus>> => {
  const statusByTime = new Map<string, AssignmentStatus>();
  if (planIds.length === 0) return statusByTime;
  const me = await unwrap(
    req.db.from('people').select('id').eq('organization_id', req.orgId).eq('profile_id', req.auth.userId).maybeSingle(),
  );
  if (!me) return statusByTime;
  const mine = (await unwrap(
    req.db.from('assignments').select('id, status').eq('person_id', me.id).eq('visibility', 'released').in('plan_id', [...planIds]),
  )) ?? [];
  const attendance = await attendanceFor(req.db, mine.map((assignment) => assignment.id));
  for (const assignment of mine) {
    for (const interval of attendance.get(assignment.id) ?? []) {
      if (!interval.plan_time_id) continue;
      const current = statusByTime.get(interval.plan_time_id);
      if (!current || STATUS_RANK[assignment.status] > STATUS_RANK[current]) {
        statusByTime.set(interval.plan_time_id, assignment.status);
      }
    }
  }
  return statusByTime;
};

/**
 * Feeds every calendar surface — the web month/week grid and the mobile agenda.
 * One event per plan time, so a Sunday with a Friday rehearsal produces two.
 */
calendarRouter.get('/', validateQuery(calendarQuerySchema), async (req, res) => {
  const { from, to, service_type_id, team_id, mine, include_rehearsals } =
    parsedQuery<CalendarQuery>(res);

  let query = raw(req.db)
    .from('plan_times')
    .select(
      `id, kind, name, starts_at, ends_at,
       plan:plans!inner(
         id, title, status, location, service_type_id, organization_id,
         service_type:service_types(name),
         assignments:assignments(team_id, visibility)
       )`,
    )
    .eq('plan.organization_id', req.orgId)
    .gte('starts_at', from)
    .lte('starts_at', to)
    .order('starts_at');

  if (service_type_id) query = query.eq('plan.service_type_id', service_type_id);
  if (!include_rehearsals) query = query.eq('kind', 'service');

  const rows = (await unwrap(query)) as unknown as RawPlanTime[];
  const myStatusByTime = await myStatusForTimes(req, [...new Set(rows.flatMap((row) => (row.plan ? [row.plan.id] : [])))]);

  const events: CalendarEvent[] = [];
  for (const row of rows) {
    if (!row.plan) continue;
    // A leader's prepared drafts are not anyone's schedule yet.
    const assignments = (row.plan.assignments ?? []).filter((a) => a.visibility === 'released');

    // F04: "mine" means the times my requests cover, not every time on a plan
    // I'm somewhere on.
    const myStatus = myStatusByTime.get(row.id);
    if (mine && !myStatus) continue;
    if (team_id && !assignments.some((a) => a.team_id === team_id)) continue;

    events.push({
      id: row.id,
      plan_id: row.plan.id,
      title: row.name ? `${row.plan.title} · ${row.name}` : row.plan.title,
      kind: row.kind,
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      status: row.plan.status,
      location: row.plan.location,
      service_type: row.plan.service_type?.name ?? null,
      ...(myStatus ? { my_assignment_status: myStatus } : {}),
    } as CalendarEvent);
  }

  res.json(events);
});
