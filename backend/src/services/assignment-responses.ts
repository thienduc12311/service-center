import { selfResponseTransition, type AssignmentRow } from '@service-center/shared';
import { raw, unwrap, type Db } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import type {
  RespondToOwnAssignmentInput,
  SelfResponseOutcome,
} from '../model/assignment-response.model.js';

export const STALE_RESPONSE_CODE = 'assignment_response_stale';
export const FORBIDDEN_RESPONSE_CODE = 'assignment_response_forbidden';

const staleResponse = (current: AssignmentRow['status']): HttpError =>
  new HttpError(409, 'This assignment changed since you opened it. Refresh and review it again.', STALE_RESPONSE_CODE, {
    status: current,
  });

/**
 * Accept, decline or withdraw from one of the caller's own assignments.
 *
 * Runs on the caller's RLS-scoped client. The write is a compare-and-set on
 * the status that was read, so a concurrent change (another device, a
 * scheduler) is reported as stale rather than overwritten. The database
 * trigger enforces the same transition rule for direct table access and
 * writes the response history row, which is where a decline reason is kept.
 * The same transaction records the scheduler update (F00 outbox), which the
 * route delivers once the answer has committed.
 */
export const respondToOwnAssignment = async (
  input: RespondToOwnAssignmentInput,
): Promise<SelfResponseOutcome> => {
  const found = (await unwrap(
    raw(input.db)
      .from('assignments')
      .select('*, plan:plans!inner(organization_id)')
      .eq('id', input.assignmentId)
      .eq('plan.organization_id', input.orgId)
      .maybeSingle(),
  )) as (AssignmentRow & { plan: unknown }) | null;
  if (!found) throw HttpError.notFound('Assignment not found');
  const { plan: _plan, ...current } = found;
  if (current.user_id !== input.userId) {
    throw HttpError.forbidden('You can only respond to your own assignments');
  }

  const transition = selfResponseTransition(current.status, input.status);
  // Checked before staleness: retrying an answer whose first attempt
  // committed (e.g. the response was lost to a timeout) is a success.
  if (transition === 'unchanged') {
    return { assignment: current, previousStatus: current.status, transition };
  }
  if (input.expectedStatus && input.expectedStatus !== current.status) {
    throw staleResponse(current.status);
  }
  if (transition === 'forbidden') {
    throw new HttpError(
      409,
      'You declined this position. Ask a scheduler if you can serve after all.',
      FORBIDDEN_RESPONSE_CODE,
    );
  }

  // Compare-and-set and the history row (with any reason) in one transaction.
  const rows = await unwrap(
    input.db.rpc('respond_to_own_assignment', {
      p_assignment_id: current.id,
      p_status: input.status,
      p_expected_status: current.status,
      p_reason: input.reason,
    }),
  );
  const updated = rows?.[0];
  if (!updated) {
    const latest = await unwrap(
      input.db.from('assignments').select('status').eq('id', current.id).maybeSingle(),
    );
    throw staleResponse(latest?.status ?? current.status);
  }

  return { assignment: updated, previousStatus: current.status, transition };
};

/**
 * The reason recorded with each assignment's latest decline. Reads through
 * the caller's RLS scope, so only their own history (or, for a scheduler,
 * their organization's) is ever visible.
 */
export const latestDeclineReasons = async (
  db: Db,
  assignmentIds: readonly string[],
): Promise<Map<string, string>> => {
  const reasons = new Map<string, string>();
  if (assignmentIds.length === 0) return reasons;
  const rows = await unwrap(
    db
      .from('assignment_responses')
      .select('assignment_id, response_note, created_at')
      .in('assignment_id', [...assignmentIds])
      .eq('status', 'declined')
      .order('created_at', { ascending: false }),
  );
  const seen = new Set<string>();
  for (const row of rows ?? []) {
    // Newest first: only the latest decline counts, even when it had no reason.
    if (seen.has(row.assignment_id)) continue;
    seen.add(row.assignment_id);
    if (row.response_note) reasons.set(row.assignment_id, row.response_note);
  }
  return reasons;
};
