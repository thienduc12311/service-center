import { createHash } from 'node:crypto';

/** One reviewed (assignment, revision) pair, as a release batch stores it. */
export interface ReleaseItem {
  assignment_id: string;
  request_revision: number;
}

/**
 * The single-plan release's reviewed scope as release-batch items: exactly
 * `assignmentIds`, each on the plan (`onPlan`), pinned to the revision the
 * leader reviewed (`expected`) or, when none was sent, the current one.
 * Returns null when the review no longer matches the plan — a request moved
 * away, disappeared, or the revisions name a different set.
 */
export function planReleaseItems(
  assignmentIds: readonly string[],
  expected: readonly ReleaseItem[],
  onPlan: readonly ReleaseItem[],
): ReleaseItem[] | null {
  const requested = new Set(assignmentIds);
  const current = new Map(onPlan.map((row) => [row.assignment_id, row.request_revision]));
  if (requested.size !== assignmentIds.length || [...requested].some((id) => !current.has(id))) return null;
  if (expected.length === 0) {
    return [...requested].map((id) => ({ assignment_id: id, request_revision: current.get(id) ?? 0 }));
  }
  const reviewed = new Set(expected.map((item) => item.assignment_id));
  if (reviewed.size !== expected.length || reviewed.size !== requested.size
      || expected.some((item) => !requested.has(item.assignment_id))) {
    return null;
  }
  return expected.map((item) => ({ assignment_id: item.assignment_id, request_revision: item.request_revision }));
}

/**
 * Release-batch idempotency key for a single-plan release. Batch keys are
 * unique per organization and actor, so the plan is part of the key; the
 * client's key is hashed to stay within the 200-character limit.
 */
export function planReleaseBatchKey(planId: string, clientKey: string): string {
  return `plan-release:${planId}:${createHash('sha256').update(clientKey).digest('hex')}`;
}
