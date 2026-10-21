import { ApiError, planTimesFingerprint, type AttendanceConflict, type PlanTimeImpact, type PlanTimeRequest } from '@service-center/shared';

/**
 * MOB-015: native plan time editing on the F04 contracts (`previewPlanTimes`,
 * then `updatePlan` with the preview's revision and impact hash). The draft
 * and request rules live in `@service-center/shared` (`plan-time-draft`) so
 * the website and the app send the same list; these helpers only read the
 * server's answers and keep a review tied to what it previewed.
 */

/** How a refused or failed time save should be presented. */
export type TimesWriteOutcome =
  /** Who the change affects moved since the review: review again. */
  | 'impact_stale'
  /** The plan changed (another edit landed first, or ours did without an answer): reload and review again. */
  | 'plan_stale'
  /** Keeping an orphaned request for all times would overlap something: show the conflicts. */
  | 'conflict'
  /** A selected-time request lost every time and still needs a choice. */
  | 'orphans_required'
  /** The plan is gone or no longer readable. */
  | 'gone'
  /** No answer: the save may or may not have happened. */
  | 'uncertain'
  /** Refused for another reason (validation, permission); shown as is. */
  | 'refused';

export const timesWriteOutcome = (error: unknown): TimesWriteOutcome => {
  if (!(error instanceof ApiError)) return 'uncertain';
  switch (error.code) {
    case 'time_impact_stale':
    case 'time_impact_required':
      return 'impact_stale';
    case 'plan_revision_stale':
      return 'plan_stale';
    case 'scheduling_conflict':
      return 'conflict';
    case 'orphan_resolution_required':
      return 'orphans_required';
    default:
      return error.status === 404 ? 'gone' : 'refused';
  }
};

/** The typed conflicts a `scheduling_conflict` refusal carries. */
export const conflictsFrom = (error: unknown): AttendanceConflict[] =>
  error instanceof ApiError && error.code === 'scheduling_conflict' && Array.isArray(error.details)
    ? (error.details as AttendanceConflict[])
    : [];

/** A preview and the exact list it was made from. */
export interface TimesReview {
  impact: PlanTimeImpact;
  times: PlanTimeRequest[];
  fingerprint: string;
}

export const timesReview = (impact: PlanTimeImpact, times: PlanTimeRequest[]): TimesReview => ({
  impact,
  times,
  fingerprint: planTimesFingerprint(times),
});

/**
 * A review only commits the list it previewed, against the revision it saw.
 * Any edit after the preview, or a plan that has since changed, needs a new
 * preview (the server would refuse the stale hash anyway).
 */
export const reviewStillApplies = (
  review: TimesReview,
  current: readonly PlanTimeRequest[] | null,
  planRevision: number,
): boolean =>
  current !== null
  && review.fingerprint === planTimesFingerprint(current)
  && review.impact.content_revision === planRevision;

/** How a refused reminder policy save or reset should be presented. */
export type PolicyWriteOutcome = 'stale' | 'uncertain' | 'refused';

export const policyWriteOutcome = (error: unknown): PolicyWriteOutcome => {
  if (!(error instanceof ApiError)) return 'uncertain';
  return error.code === 'reminder_policy_stale' || error.status === 404 ? 'stale' : 'refused';
};
