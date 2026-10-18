import { randomUUID } from 'node:crypto';
import type {
  AssignmentRow,
  CreateReleaseBatchInput,
  ListPreparedRequestsQuery,
  ListReleaseBatchesQuery,
  PlanTimeRow,
  PreparedRequestListItem,
  ReleaseBatchPreview,
  ReleaseBatchResult,
  ReleaseBatchRow,
  ReleaseBatchSummary,
} from '@service-center/shared';
import { HttpError } from '../lib/errors.js';
import { raw, unwrap, type Db } from '../lib/supabase.js';
import { isUntimed, timesForAttendance } from '../model/attendance.model.js';
import { planReleaseBatchKey, planReleaseItems, type ReleaseItem } from '../model/release.model.js';
import {
  groupReleaseRecipients,
  personDisplayName,
  type PersonReadiness,
  type ReleaseCandidateRow,
  type ReleaseCandidateTimes,
} from '../model/reminder.model.js';
import { attendanceFor } from './attendance.js';
import { deliverEffectNow } from './delivery-worker.js';

const CANDIDATE_SELECT = `
  id, plan_id, person_id, request_revision,
  team:teams(name), position:team_positions(name),
  plan:plans!inner(title, service_date, organization_id)
`;

const personNames = async (db: Db, personIds: readonly string[]): Promise<Map<string, string>> => {
  if (personIds.length === 0) return new Map();
  const people = await unwrap(db.from('people_directory').select('id, first_name, last_name').in('id', [...personIds]));
  return new Map((people ?? []).map((person) => [person.id, personDisplayName(person)]));
};

/**
 * Prepared requests on upcoming plans. RLS shows a prepared row only to
 * someone who schedules its team, so this is exactly what the caller may
 * release.
 */
export const listPreparedRequests = async (
  db: Db,
  orgId: string,
  query: ListPreparedRequestsQuery,
): Promise<PreparedRequestListItem[]> => {
  const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const to = new Date(Date.now() + query.days * 24 * 3600 * 1000).toISOString();
  const rows = (await unwrap(
    raw(db).from('assignments').select(CANDIDATE_SELECT)
      .eq('visibility', 'prepared')
      .eq('plan.organization_id', orgId)
      .gte('plan.service_date', from)
      .lte('plan.service_date', to)
      .limit(500),
  )) as unknown as ReleaseCandidateRow[];
  const names = await personNames(db, [...new Set(rows.map((row) => row.person_id))]);
  return rows
    .map((row) => ({
      assignment_id: row.id,
      request_revision: row.request_revision,
      plan_id: row.plan_id,
      plan_title: row.plan?.title ?? 'Plan',
      service_date: row.plan?.service_date ?? '',
      person_id: row.person_id,
      person_name: names.get(row.person_id) ?? 'Person',
      team_name: row.team?.name ?? 'Team',
      position_name: row.position?.name ?? null,
    }))
    .sort((a, b) => a.service_date.localeCompare(b.service_date) || a.person_name.localeCompare(b.person_name));
};

/**
 * Exactly what a release will send: one message per Person, a section per
 * plan, every request with its applicable times and current revision, and
 * the channels that will be skipped. Refuses if any reviewed id is not a
 * prepared request the caller can see.
 */
export const previewReleaseBatch = async (
  db: Db,
  orgId: string,
  assignmentIds: readonly string[],
): Promise<ReleaseBatchPreview> => {
  const rows = (await unwrap(
    raw(db).from('assignments').select(CANDIDATE_SELECT)
      .in('id', [...assignmentIds])
      .eq('visibility', 'prepared')
      .eq('plan.organization_id', orgId),
  )) as unknown as ReleaseCandidateRow[];
  if (rows.length !== new Set(assignmentIds).size) {
    throw new HttpError(409, 'Prepared requests changed. Refresh the release review.', 'assignment_release_stale');
  }
  const personIds = [...new Set(rows.map((row) => row.person_id))];
  const planIds = [...new Set(rows.map((row) => row.plan_id))];
  const [names, readiness, attendance, planTimes] = await Promise.all([
    personNames(db, personIds),
    unwrap(db.rpc('person_delivery_readiness', { p_org: orgId, p_person_ids: personIds })),
    attendanceFor(db, rows.map((row) => row.id)),
    unwrap(db.from('plan_times').select('*').in('plan_id', planIds).order('sort_order')),
  ]);
  const timesByPlan = new Map<string, PlanTimeRow[]>();
  for (const time of (planTimes ?? []) as PlanTimeRow[]) {
    timesByPlan.set(time.plan_id, [...(timesByPlan.get(time.plan_id) ?? []), time]);
  }
  const times = new Map<string, ReleaseCandidateTimes>(rows.map((row) => {
    const covered = attendance.get(row.id) ?? [];
    return [row.id, { times: timesForAttendance(covered, timesByPlan.get(row.plan_id) ?? []), untimed: isUntimed(covered) }];
  }));
  const readinessMap = new Map(((readiness ?? []) as PersonReadiness[]).map((entry) => [entry.person_id, entry]));
  return {
    recipients: groupReleaseRecipients(rows, names, readinessMap, times),
    plan_count: planIds.length,
    assignment_count: rows.length,
  };
};

/**
 * Releases the reviewed set now (in one transaction with its consolidated
 * outbox effect) or records it for the worker at `scheduled_for`. A stale
 * review is refused whole by the database (PT409 → 409).
 */
export const createReleaseBatch = async (
  db: Db,
  orgId: string,
  input: CreateReleaseBatchInput,
): Promise<ReleaseBatchResult> => {
  const batch = (await unwrap(db.rpc('create_release_batch', {
    p_org: orgId,
    p_items: input.items,
    p_notify: input.notify,
    p_scheduled_for: input.scheduled_for ?? null,
    p_idempotency_key: input.idempotency_key,
  }))) as ReleaseBatchRow;
  if (batch.status === 'released' && batch.effect_id) await deliverEffectNow(batch.effect_id);
  return {
    batch,
    released_assignment_ids: batch.status === 'released' ? input.items.map((item) => item.assignment_id) : [],
  };
};

/** The single-plan release request (`POST /plans/:planId/release`). */
export interface PlanReleaseInput {
  assignment_ids: string[];
  expected_revisions: ReleaseItem[];
  notify: boolean;
  idempotency_key?: string;
}

/** A release-batch item row as read back for an idempotent repeat. */
interface ReleaseBatchItemRef {
  assignment_id: string;
}

/**
 * Releases exactly the reviewed prepared requests on one plan as a one-plan
 * release batch, so it sends the same consolidated message as Release review.
 * Returns the released rows. A repeat with the same key returns the first
 * call's rows (the released requests' revisions have moved on, so the scope
 * is not re-derived); the same key for a different set is refused.
 */
export const releasePlanAssignments = async (
  db: Db,
  orgId: string,
  actorId: string,
  planId: string,
  input: PlanReleaseInput,
): Promise<AssignmentRow[]> => {
  const idempotencyKey = planReleaseBatchKey(planId, input.idempotency_key ?? randomUUID());
  const existing = await unwrap(
    db.from('release_batches').select('*').eq('organization_id', orgId)
      .eq('created_by', actorId).eq('idempotency_key', idempotencyKey).maybeSingle(),
  );
  let releasedIds: string[];
  if (existing) {
    const items = (await unwrap(
      raw(db).from('release_batch_items').select('assignment_id').eq('batch_id', existing.id),
    )) as ReleaseBatchItemRef[];
    const batchIds = new Set(items.map((item) => item.assignment_id));
    if (batchIds.size !== new Set(input.assignment_ids).size || input.assignment_ids.some((id) => !batchIds.has(id))) {
      throw new HttpError(409, 'That idempotency key was used for a different release', 'conflict');
    }
    releasedIds = existing.status === 'released' ? [...batchIds] : [];
  } else {
    const onPlan = ((await unwrap(
      db.from('assignments').select('id, request_revision').eq('plan_id', planId).in('id', input.assignment_ids),
    )) ?? []).map((row) => ({ assignment_id: row.id, request_revision: row.request_revision }));
    const items = planReleaseItems(input.assignment_ids, input.expected_revisions, onPlan);
    if (!items) {
      throw new HttpError(409, 'Prepared requests changed since the release review', 'assignment_release_stale');
    }
    ({ released_assignment_ids: releasedIds } = await createReleaseBatch(db, orgId, {
      items,
      notify: input.notify,
      scheduled_for: null,
      idempotency_key: idempotencyKey,
    }));
  }
  if (releasedIds.length === 0) return [];
  return (await unwrap(db.from('assignments').select('*').in('id', releasedIds))) ?? [];
};

const withPlanTitles = async (db: Db, batches: readonly ReleaseBatchRow[]): Promise<ReleaseBatchSummary[]> => {
  if (batches.length === 0) return [];
  const items = (await unwrap(
    raw(db).from('release_batch_items').select('batch_id, plan:plans(title)').in('batch_id', batches.map((batch) => batch.id)),
  )) as unknown as Array<{ batch_id: string; plan: { title: string } | null }>;
  const titles = new Map<string, Set<string>>();
  for (const item of items) {
    const set = titles.get(item.batch_id) ?? new Set<string>();
    if (item.plan?.title) set.add(item.plan.title);
    titles.set(item.batch_id, set);
  }
  return batches.map((batch) => ({ ...batch, plan_titles: [...(titles.get(batch.id) ?? [])] }));
};

/** The caller's batches (administrators see everyone's), newest first. */
export const listReleaseBatches = async (
  db: Db,
  orgId: string,
  query: ListReleaseBatchesQuery,
): Promise<ReleaseBatchSummary[]> => {
  let request = db.from('release_batches').select('*').eq('organization_id', orgId);
  if (query.status) request = request.eq('status', query.status);
  const rows = await unwrap(request.order('created_at', { ascending: false }).limit(query.limit));
  return withPlanTitles(db, rows ?? []);
};

export const cancelReleaseBatch = async (db: Db, orgId: string, batchId: string): Promise<ReleaseBatchSummary> => {
  const existing = await unwrap(
    db.from('release_batches').select('id').eq('id', batchId).eq('organization_id', orgId).maybeSingle(),
  );
  if (!existing) throw HttpError.notFound('Release not found');
  const batch = (await unwrap(db.rpc('cancel_release_batch', { p_batch: batchId }))) as ReleaseBatchRow;
  const [summary] = await withPlanTitles(db, [batch]);
  if (!summary) throw HttpError.notFound('Release not found');
  return summary;
};
