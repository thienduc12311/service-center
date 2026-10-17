import type {
  AssignmentRequestSnapshotRow,
  AssignmentResponseReview,
  PlanTimeRow,
} from '@service-center/shared';
import { adminDb, raw, unwrap } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import type { SnapshotAssignmentJoin } from '../model/assignment-snapshot.model.js';

const ITEM_SELECT = `
  *,
  assignment:assignments!inner(
    id, plan_id, status, request_revision,
    team:teams(name),
    position:team_positions(name),
    plan:plans(title),
    time_responses:assignment_time_responses(*)
  )
`;

/** Loads the immutable review shape shared by signed-in and public clients. */
export const loadAssignmentResponseReview = async (
  snapshot: AssignmentRequestSnapshotRow,
): Promise<AssignmentResponseReview> => {
  const items = (await unwrap(
    raw(adminDb)
      .from('assignment_request_snapshot_items')
      .select(ITEM_SELECT)
      .eq('snapshot_id', snapshot.id)
      .order('assignment_id'),
  )) as unknown as SnapshotAssignmentJoin[];
  if (items.length === 0) throw HttpError.notFound('Response snapshot not found');

  const timeIds = [...new Set(items.flatMap((item) => item.plan_time_ids))];
  const times = timeIds.length
    ? ((await unwrap(adminDb.from('plan_times').select('*').in('id', timeIds))) ?? [])
    : [];
  const byTime = new Map((times as PlanTimeRow[]).map((time) => [time.id, time]));

  return {
    snapshot_id: snapshot.id,
    version: snapshot.version,
    person_id: snapshot.person_id,
    plan_id: snapshot.plan_id,
    expires_at: snapshot.expires_at,
    assignments: items.map((item) => ({
      assignment_id: item.assignment.id,
      plan_id: item.assignment.plan_id,
      plan_title: item.assignment.plan?.title ?? 'Plan',
      team_name: item.assignment.team?.name ?? 'Team',
      position_name: item.assignment.position?.name ?? null,
      status: item.assignment.status,
      request_revision: item.expected_request_revision,
      times: item.plan_time_ids
        .map((id) => byTime.get(id))
        .filter((time): time is PlanTimeRow => Boolean(time))
        .sort((a, b) => a.sort_order - b.sort_order || a.starts_at.localeCompare(b.starts_at)),
      time_responses: item.assignment.time_responses.filter((response) =>
        item.plan_time_ids.includes(response.plan_time_id),
      ),
    })),
  };
};
