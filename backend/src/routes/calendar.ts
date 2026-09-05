import { Router } from 'express';
import { calendarQuerySchema, type CalendarEvent, type CalendarQuery } from '@service-center/shared';
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
    assignments: Array<{ user_id: string; team_id: string; status: CalendarEvent['status'] }>;
  } | null;
}

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
         assignments:assignments(user_id, team_id, status)
       )`,
    )
    .eq('plan.organization_id', req.orgId)
    .gte('starts_at', from)
    .lte('starts_at', to)
    .order('starts_at');

  if (service_type_id) query = query.eq('plan.service_type_id', service_type_id);
  if (!include_rehearsals) query = query.eq('kind', 'service');

  const rows = (await unwrap(query)) as unknown as RawPlanTime[];

  const events: CalendarEvent[] = [];
  for (const row of rows) {
    if (!row.plan) continue;
    const assignments = row.plan.assignments ?? [];

    const myAssignment = assignments.find((a) => a.user_id === req.auth.userId);
    if (mine && !myAssignment) continue;
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
      ...(myAssignment ? { my_assignment_status: myAssignment.status } : {}),
    } as CalendarEvent);
  }

  res.json(events);
});
