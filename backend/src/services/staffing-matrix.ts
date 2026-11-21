import type { Request } from 'express';
import {
  canAccess,
  decodePeopleCursor,
  encodePeopleCursor,
  type PeopleCursor,
  type AttendanceConflict,
  type StaffingMatrixAction,
  type StaffingMatrixAssignment,
  type StaffingMatrixFilters,
  type StaffingMatrixPage,
  type StaffingMatrixPerson,
  type StaffingMatrixPlan,
  type StaffingMatrixPlanRevision,
  type StaffingMatrixPreview,
  type StaffingMatrixPreviewItem,
  type StaffingMatrixQueryInput,
  type PreferenceWarning,
  type StaffingMatrixWarning,
} from '@service-center/shared';
import { raw, unwrap } from '../lib/supabase.js';
import { fetchAllPages } from '../lib/paging.js';
import { HttpError } from '../lib/errors.js';
import { peopleKeysetFilter } from '../lib/keyset.js';
import { isUuid } from '../lib/params.js';
import { rawSelect, whereSearchMatches } from '../lib/search.js';
import { checkConflicts } from './attendance.js';
import { preferenceWarnings } from './availability.js';

/** The English sentence older clients show for a structured preview warning. */
const matrixWarningEnglish = (warning: StaffingMatrixWarning): string => {
  switch (warning.kind) {
    case 'preference':
      return warning.warning.detail;
    case 'copy_resets_answers':
      return 'Answers and delivery timestamps will be reset on the copied request.';
    case 'team_unavailable':
      return 'The selected team is unavailable.';
    case 'person_unavailable':
      return 'This person is archived or no longer an active member, so they cannot be scheduled.';
  }
};

/** A Person named in a preview, with whether they can still be scheduled. */
interface PreviewPersonRow { id: string; first_name: string; last_name: string | null; schedulable: boolean }
interface MatrixTeamRow { id: string; name: string; service_type_id: string | null }
interface MatrixNeedRow {
  needed: number;
  position: { id: string; name: string; team_id: string; team: { id: string; name: string } | null } | null;
}
interface MatrixPlanRow {
  id: string; title: string; service_date: string; service_type_id: string | null; staffing_revision: number;
  service_type: { name: string } | null;
  times: StaffingMatrixPlan['times'];
  position_needs: MatrixNeedRow[];
}
interface MatrixPersonRow { id: string; first_name: string; last_name: string | null; avatar_url: string | null; campus: string | null; sort_name: string }
interface MatrixAssignmentRow {
  id: string; plan_id: string; person_id: string; team_id: string; position_id: string | null;
  status: StaffingMatrixAssignment['status']; visibility: StaffingMatrixAssignment['visibility'];
  request_revision: number; attendance_mode: StaffingMatrixAssignment['attendance_mode'];
  team: { name: string } | null; position: { name: string } | null;
  attendance_times: Array<{ plan_time_id: string }>;
}
interface RecentAssignmentRow { person_id: string; plan: { service_date: string } | null }

const fullName = (person: MatrixPersonRow): string =>
  [person.first_name, person.last_name].filter(Boolean).join(' ');

const planTeamIds = (_plan: MatrixPlanRow, teams: readonly MatrixTeamRow[]): string[] => teams.map((team) => team.id);

const canScheduleTeam = (req: Request, plan: MatrixPlanRow, teamId: string): boolean =>
  canAccess(req.access, 'scheduling.manage', { serviceTypeId: plan.service_type_id, teamId });

const loadAuthorizedPlans = async (
  req: Request,
  filters: StaffingMatrixFilters,
  teams: readonly MatrixTeamRow[],
): Promise<MatrixPlanRow[]> => {
  const schedulingEntries = req.access?.entries.filter((entry) => entry.capability === 'scheduling.manage') ?? [];
  const crossesServiceTypes = schedulingEntries.some((entry) => entry.scope_type === 'organization' || entry.scope_type === 'team');
  const authorizedServiceTypes = schedulingEntries
    .filter((entry) => entry.scope_type === 'service_type' && entry.scope_id)
    .map((entry) => entry.scope_id as string);
  if (!crossesServiceTypes && authorizedServiceTypes.length === 0) return [];
  let query = raw(req.db)
    .from('plans')
    .select(`id, title, service_date, service_type_id, staffing_revision,
      service_type:service_types(name), times:plan_times(id, kind, name, starts_at, ends_at),
      position_needs:plan_position_needs(needed, position:team_positions(id, name, team_id, team:teams(id, name)))`)
    .eq('organization_id', req.orgId)
    .gte('service_date', filters.from)
    .lte('service_date', filters.to)
    .order('service_date')
    .order('id')
    .limit(13);
  if (!crossesServiceTypes) query = query.in('service_type_id', authorizedServiceTypes);
  if (filters.service_type_ids.length) query = query.in('service_type_id', filters.service_type_ids);
  if (filters.plan_ids.length) query = query.in('id', filters.plan_ids);
  const rows = ((await unwrap(query)) ?? []) as unknown as MatrixPlanRow[];
  const authorized = rows.filter((plan) => {
    const candidates = filters.team_ids.length ? filters.team_ids : planTeamIds(plan, teams);
    return candidates.some((teamId) => canScheduleTeam(req, plan, teamId));
  });
  if (authorized.length > 12) throw HttpError.badRequest('Narrow the filters to 12 plans or fewer');
  return authorized;
};

const mapPlan = (plan: MatrixPlanRow, selectedTeamIds: readonly string[]): StaffingMatrixPlan => ({
  id: plan.id,
  title: plan.title,
  service_date: plan.service_date,
  service_type_id: plan.service_type_id,
  service_type_name: plan.service_type?.name ?? null,
  staffing_revision: plan.staffing_revision,
  times: [...(plan.times ?? [])].sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.id.localeCompare(b.id)),
  needs: (plan.position_needs ?? [])
    .filter((need) => need.position?.team && (!selectedTeamIds.length || selectedTeamIds.includes(need.position.team_id)))
    .map((need) => ({
      team_id: need.position!.team_id,
      team_name: need.position!.team!.name,
      position_id: need.position!.id,
      position_name: need.position!.name,
      needed: need.needed,
    }))
    .sort((a, b) => a.team_name.localeCompare(b.team_name) || a.position_name.localeCompare(b.position_name)),
});

const MATRIX_PERSON_COLUMNS = 'id, first_name, last_name, avatar_url, campus, sort_name';
/** `!inner`: only People with a membership in one of the selected teams. */
const MATRIX_TEAM_EMBED = 'team_memberships!inner()';

/** One page of matrix People and the cursors either side of it. */
interface MatrixPeoplePage {
  rows: MatrixPersonRow[];
  next: string | null;
  prev: string | null;
}

/**
 * The keyset position a request continues from. A bare Person id is the
 * cursor format from before People were ordered by name: it continues after
 * that Person, wherever their name sorts.
 */
const resolveMatrixCursor = async (req: Request, cursor: string | undefined): Promise<PeopleCursor | null> => {
  if (!cursor) return null;
  const decoded = decodePeopleCursor(cursor);
  if (decoded) return decoded;
  if (isUuid(cursor)) {
    const row = (await unwrap(
      raw(req.db).from('people_directory').select('id, sort_name').eq('organization_id', req.orgId).eq('id', cursor.toLowerCase()).maybeSingle(),
    )) as PeopleCursor | null;
    if (row) return { sort_name: row.sort_name, id: row.id };
  }
  throw HttpError.badRequest('Invalid cursor');
};

const cursorOf = (person: MatrixPersonRow): string => encodePeopleCursor({ sort_name: person.sort_name, id: person.id });

/**
 * One page of schedulable People ordered by name, then id (stable across
 * pages), forwards from `cursor` or — `direction: 'prev'` — the page before it.
 * Team and search filters run in SQL, so a big roster needs no id chunking.
 */
const loadPeople = async (req: Request, input: StaffingMatrixQueryInput): Promise<MatrixPeoplePage> => {
  const cursor = await resolveMatrixCursor(req, input.cursor);
  const backward = input.direction === 'prev' && cursor !== null;
  const teamIds = input.filters.team_ids;
  const columns: string = teamIds.length ? `${MATRIX_PERSON_COLUMNS}, ${MATRIX_TEAM_EMBED}` : MATRIX_PERSON_COLUMNS;
  let query = rawSelect(req.db, 'people_directory', columns)
    // Only People who can actually be scheduled: not archived, active membership (W2-STAFF-D2).
    .eq('organization_id', req.orgId)
    .eq('schedulable', true);
  if (teamIds.length) query = query.in('team_memberships.team_id', [...teamIds]);
  query = whereSearchMatches(query, input.filters.search);
  if (cursor) query = query.or(peopleKeysetFilter(cursor, backward ? 'before' : 'after'));
  const fetched = ((await unwrap(
    query.order('sort_name', { ascending: !backward }).order('id', { ascending: !backward }).limit(input.page_size + 1),
  )) ?? []) as unknown as MatrixPersonRow[];
  const more = fetched.length > input.page_size;
  const page = fetched.slice(0, input.page_size);
  const rows = backward ? page.reverse() : page;
  const first = rows[0];
  const last = rows.at(-1);
  if (backward) {
    // Going back, the rows after this page always exist: the page we came from.
    return { rows, next: last ? cursorOf(last) : encodePeopleCursor(cursor), prev: more && first ? cursorOf(first) : null };
  }
  return { rows, next: more && last ? cursorOf(last) : null, prev: cursor && first ? cursorOf(first) : null };
};

export const loadStaffingMatrix = async (req: Request, input: StaffingMatrixQueryInput): Promise<StaffingMatrixPage> => {
  const teams = ((await unwrap(req.db.from('teams').select('id, name, service_type_id').eq('organization_id', req.orgId))) ?? []) as MatrixTeamRow[];
  const selectedTeams = input.filters.team_ids.filter((id) => teams.some((team) => team.id === id));
  const plans = await loadAuthorizedPlans(req, { ...input.filters, team_ids: selectedTeams }, teams);
  if (!plans.length) return { plans: [], people: [], assignments: [], conflicts: [], next_cursor: null, prev_cursor: null };
  const { rows: peopleRows, next, prev } = await loadPeople(req, { ...input, filters: { ...input.filters, team_ids: selectedTeams } });
  const planIds = plans.map((plan) => plan.id);
  const personIds = peopleRows.map((person) => person.id);
  // Up to 12 plans of big teams can pass PostgREST's 1000-row cap: every page.
  const assignments = await fetchAllPages(async (from, to) => {
    let assignmentQuery = raw(req.db).from('assignments').select(
      'id, plan_id, person_id, team_id, position_id, status, visibility, request_revision, attendance_mode, team:teams(name), position:team_positions(name), attendance_times:assignment_attendance_times(plan_time_id)',
    ).in('plan_id', planIds);
    if (selectedTeams.length) assignmentQuery = assignmentQuery.in('team_id', selectedTeams);
    return (await unwrap(assignmentQuery.order('id').range(from, to))) as unknown as MatrixAssignmentRow[] | null;
  });

  const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const recent = personIds.length
    ? (((await unwrap(raw(req.db).from('assignments').select('person_id, plan:plans!inner(service_date)')
        .in('person_id', personIds).eq('visibility', 'released').neq('status', 'declined')
        .gte('plan.service_date', cutoff).lte('plan.service_date', new Date().toISOString()))) ?? []) as unknown as RecentAssignmentRow[])
    : [];
  const recentByPerson = new Map<string, string[]>();
  for (const row of recent) if (row.plan) recentByPerson.set(row.person_id, [...(recentByPerson.get(row.person_id) ?? []), row.plan.service_date]);
  const people: StaffingMatrixPerson[] = peopleRows.map((person) => {
    const dates = recentByPerson.get(person.id) ?? [];
    return { id: person.id, full_name: fullName(person), avatar_url: person.avatar_url, campus: person.campus,
      recent_serving_count: dates.length, last_served_at: dates.sort().at(-1) ?? null };
  });

  const candidates = people.flatMap((person) => plans.map((plan) => ({
    key: `${person.id}:${plan.id}`, person_id: person.id, plan_id: plan.id,
    attendance_mode: 'all' as const, time_ids: [],
  })));
  const conflicts: AttendanceConflict[] = [];
  for (let start = 0; start < candidates.length; start += 200) {
    const checked = await checkConflicts({ db: req.db, orgId: req.orgId }, candidates.slice(start, start + 200));
    conflicts.push(...checked.conflicts);
  }
  const byCell = new Map<string, AttendanceConflict[]>();
  for (const conflict of conflicts) byCell.set(conflict.candidate_key, [...(byCell.get(conflict.candidate_key) ?? []), conflict]);

  return {
    plans: plans.map((plan) => mapPlan(plan, selectedTeams)), people,
    assignments: assignments.map((assignment) => ({
      id: assignment.id, plan_id: assignment.plan_id, person_id: assignment.person_id,
      team_id: assignment.team_id, team_name: assignment.team?.name ?? 'Team',
      position_id: assignment.position_id, position_name: assignment.position?.name ?? null,
      status: assignment.status, visibility: assignment.visibility, request_revision: assignment.request_revision,
      attendance_mode: assignment.attendance_mode,
      time_ids: (assignment.attendance_times ?? []).map((row) => row.plan_time_id).sort(),
    })),
    conflicts: [...byCell.entries()].map(([key, cell]) => {
      const [person_id, plan_id] = key.split(':');
      return { key, person_id: person_id!, plan_id: plan_id!, conflicts: cell };
    }),
    next_cursor: next,
    prev_cursor: prev,
  };
};

interface PreviewAssignmentRow {
  id: string; plan_id: string; person_id: string; team_id: string; position_id: string | null;
  request_revision: number; visibility: StaffingMatrixAssignment['visibility']; notes: string | null;
}

export const previewStaffingMatrix = async (req: Request, actions: readonly StaffingMatrixAction[]): Promise<StaffingMatrixPreview> => {
  const referencedIds = actions.flatMap((action) => action.kind === 'remove' || action.kind === 'release'
    ? [action.assignment_id] : action.kind === 'copy' ? [action.source_assignment_id] : []);
  const assignmentRows = referencedIds.length
    ? (((await unwrap(req.db.from('assignments').select('id, plan_id, person_id, team_id, position_id, request_revision, visibility, notes').in('id', referencedIds))) ?? []) as PreviewAssignmentRow[])
    : [];
  const byAssignment = new Map(assignmentRows.map((row) => [row.id, row]));
  if (assignmentRows.length !== new Set(referencedIds).size) throw new HttpError(409, 'A selected request is no longer available', 'matrix_changed');
  const planIds = [...new Set(actions.flatMap((action) => {
    if (action.kind === 'copy') return [action.destination_plan_id, byAssignment.get(action.source_assignment_id)!.plan_id];
    return [action.plan_id];
  }))];
  if (planIds.length > 12) throw HttpError.badRequest('A staffing matrix contains at most 12 plans');
  const plans = ((await unwrap(req.db.from('plans').select('id, title, service_type_id, staffing_revision').eq('organization_id', req.orgId).in('id', planIds))) ?? []) as Array<{ id: string; title: string; service_type_id: string | null; staffing_revision: number }>;
  if (plans.length !== planIds.length) throw HttpError.notFound('One of those plans is unavailable');
  const teams = ((await unwrap(req.db.from('teams').select('id, name').eq('organization_id', req.orgId))) ?? []) as Array<{ id: string; name: string }>;
  const teamName = new Map(teams.map((team) => [team.id, team.name]));
  const personIds = [...new Set(actions.map((action) => action.kind === 'assign' ? action.person_id : byAssignment.get(action.kind === 'copy' ? action.source_assignment_id : action.assignment_id)!.person_id))];
  const people = ((await unwrap(req.db.from('people_directory').select('id, first_name, last_name, schedulable').in('id', personIds))) ?? []) as PreviewPersonRow[];
  const personName = new Map(people.map((person) => [person.id, [person.first_name, person.last_name].filter(Boolean).join(' ')]));
  const unschedulable = new Set(people.filter((person) => !person.schedulable).map((person) => person.id));
  if (people.length !== personIds.length) throw HttpError.badRequest('One of those people is no longer available');

  const candidates = actions.flatMap((action, index) => {
    if (action.kind === 'assign') return [{ key: String(index), person_id: action.person_id, plan_id: action.plan_id,
      team_id: action.team_id, position_id: action.position_id, attendance_mode: action.attendance_mode, time_ids: action.time_ids }];
    if (action.kind === 'copy') {
      const source = byAssignment.get(action.source_assignment_id)!;
      if (!source) throw new HttpError(409, 'The source request changed', 'matrix_changed');
      return [{ key: String(index), person_id: source.person_id, plan_id: action.destination_plan_id,
        team_id: source.team_id, position_id: source.position_id,
        attendance_mode: action.destination_attendance_mode, time_ids: action.destination_time_ids }];
    }
    return [];
  });
  const checked = await checkConflicts({ db: req.db, orgId: req.orgId }, candidates);
  const conflictsByIndex = new Map<string, AttendanceConflict[]>();
  for (const conflict of checked.conflicts) conflictsByIndex.set(conflict.candidate_key, [...(conflictsByIndex.get(conflict.candidate_key) ?? []), conflict]);
  const preferenceWarningsByIndex = new Map<number, PreferenceWarning[]>();
  for (const [index, action] of actions.entries()) {
    if (action.kind !== 'assign' && action.kind !== 'copy') continue;
    const source = action.kind === 'copy' ? byAssignment.get(action.source_assignment_id) : null;
    const personId = action.kind === 'assign' ? action.person_id : source!.person_id;
    const planId = action.kind === 'assign' ? action.plan_id : action.destination_plan_id;
    const selectedTeamId = action.kind === 'assign' ? action.team_id : source!.team_id;
    const selectedTimeIds = action.kind === 'assign'
      ? (action.attendance_mode === 'selected' ? action.time_ids : undefined)
      : (action.destination_attendance_mode === 'selected' ? action.destination_time_ids : undefined);
    const warnings = await preferenceWarnings(
      { db: req.db, orgId: req.orgId, userId: req.auth.userId, access: req.access },
      { plan_id: planId, team_id: selectedTeamId, person_ids: [personId], plan_time_ids: selectedTimeIds },
    );
    preferenceWarningsByIndex.set(index, warnings);
  }

  const items: StaffingMatrixPreviewItem[] = actions.map((action, index) => {
    const source = action.kind === 'assign' ? null : byAssignment.get(action.kind === 'copy' ? action.source_assignment_id : action.assignment_id)!;
    const personId = action.kind === 'assign' ? action.person_id : source!.person_id;
    const planId = action.kind === 'copy' ? action.destination_plan_id : action.plan_id;
    const notify = (action.kind === 'assign' || action.kind === 'copy' || action.kind === 'release') && action.notify;
    const released = action.kind === 'release' || ((action.kind === 'assign' || action.kind === 'copy') && action.visibility === 'released');
    const warningDetails: StaffingMatrixWarning[] = (preferenceWarningsByIndex.get(index) ?? [])
      .map((warning) => ({ kind: 'preference', warning }));
    if (action.kind === 'copy') warningDetails.push({ kind: 'copy_resets_answers' });
    if (action.kind === 'assign' && !teamName.has(action.team_id)) warningDetails.push({ kind: 'team_unavailable' });
    if ((action.kind === 'assign' || action.kind === 'copy') && unschedulable.has(personId)) warningDetails.push({ kind: 'person_unavailable' });
    const warnings = warningDetails.map(matrixWarningEnglish);
    return { index, action, person_id: personId, person_name: personName.get(personId) ?? 'Person',
      plan_id: planId, plan_title: plans.find((plan) => plan.id === planId)?.title ?? 'Plan',
      delivery_intent: notify && released ? 'assignment_request' : 'none',
      conflicts: conflictsByIndex.get(String(index)) ?? [], warnings, warning_details: warningDetails };
  });
  const base_revisions: StaffingMatrixPlanRevision[] = plans
    .map((plan) => ({ plan_id: plan.id, staffing_revision: plan.staffing_revision })).sort((a, b) => a.plan_id.localeCompare(b.plan_id));
  const operationId = await unwrap(raw(req.db).rpc('staffing_matrix_operation_id', { p_actions: actions, p_base_revisions: base_revisions }));
  if (!operationId) throw new HttpError(500, 'Could not identify the staffing preview');
  return { operation_id: String(operationId), base_revisions, actions: [...actions], items,
    // An archived or inactive Person cannot be committed either, so the review blocks.
    has_blocking_conflicts: items.some((item) => item.conflicts.some((conflict) => conflict.severity === 'blocking')
      || item.warning_details.some((warning) => warning.kind === 'person_unavailable')) };
};

export const sanitizeMatrixFilters = async (req: Request, filters: StaffingMatrixFilters): Promise<StaffingMatrixFilters> => {
  const teams = ((await unwrap(req.db.from('teams').select('id, service_type_id').eq('organization_id', req.orgId))) ?? []) as MatrixTeamRow[];
  const plans = await loadAuthorizedPlans(req, filters, teams);
  const allowedPlanIds = new Set(plans.map((plan) => plan.id));
  const allowedServiceTypes = new Set(plans.map((plan) => plan.service_type_id).filter((id): id is string => Boolean(id)));
  const allowedTeams = new Set(teams.filter((team) => plans.some((plan) => canScheduleTeam(req, plan, team.id))).map((team) => team.id));
  return { ...filters, plan_ids: filters.plan_ids.filter((id) => allowedPlanIds.has(id)),
    service_type_ids: filters.service_type_ids.filter((id) => allowedServiceTypes.has(id)),
    team_ids: filters.team_ids.filter((id) => allowedTeams.has(id)) };
};
