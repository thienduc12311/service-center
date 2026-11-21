import { ApiError, type StaffingMatrixFilters } from '@service-center/shared';

/** The server builds the matrix for at most this many plans (`loadAuthorizedPlans`). */
export const STAFFING_MATRIX_PLAN_LIMIT = 12;

/**
 * Days in the default window. Four weeks keeps a church with up to three
 * services a week under the plan limit; busier churches get the one-click
 * narrowing below instead of a dead end.
 */
export const DEFAULT_MATRIX_DAYS = 28;

const DAY_MS = 86_400_000;

/** The default matrix filters: from now, `DEFAULT_MATRIX_DAYS` ahead. */
export const defaultMatrixFilters = (now: number = Date.now()): StaffingMatrixFilters => ({
  from: new Date(now).toISOString(),
  to: new Date(now + DEFAULT_MATRIX_DAYS * DAY_MS).toISOString(),
  service_type_ids: [],
  team_ids: [],
  plan_ids: [],
  search: null,
});

/**
 * True when the server refused the matrix because the range holds more plans
 * than it builds at once. It answers a plain 400 for this today, so the
 * message is matched too; a dedicated code is accepted when it gains one.
 */
export const isPlanLimitError = (error: unknown): boolean =>
  error instanceof ApiError
  && error.status === 400
  && (error.code === 'matrix_plan_limit' || /\b12 plans\b/i.test(error.message));

/** The fields of a plan the window fitting reads. */
export interface PlanWindowEntry {
  id: string;
  service_date: string;
}

/**
 * Narrows `filters` so the matrix covers only the first
 * `STAFFING_MATRIX_PLAN_LIMIT` plans of `plans` (the range's plans, oldest
 * first, with at least one extra past the limit when there are more).
 *
 * The range ends at the last plan that fits. When the first plan past the
 * limit shares that instant, the end steps back to the plan before it, so the
 * result never holds more than the limit. If even that is impossible (all the
 * plans share one instant, or the end would not be after the start), the
 * window pins the first plans by id instead.
 */
export const fitPlanLimit = (
  filters: StaffingMatrixFilters,
  plans: readonly PlanWindowEntry[],
  limit: number = STAFFING_MATRIX_PLAN_LIMIT,
): StaffingMatrixFilters => {
  if (plans.length <= limit) return filters;
  const boundary = plans[limit]!.service_date;
  const lastFitting = plans.slice(0, limit).filter((plan) => Date.parse(plan.service_date) < Date.parse(boundary)).at(-1);
  if (lastFitting && Date.parse(lastFitting.service_date) > Date.parse(filters.from)) {
    return { ...filters, to: new Date(lastFitting.service_date).toISOString() };
  }
  return { ...filters, plan_ids: plans.slice(0, limit).map((plan) => plan.id) };
};

/**
 * The window after the plans on screen: it starts just after the last one and
 * runs to the end the user asked for (or another default window, if that end
 * is already behind). Plan pins from an earlier window are dropped.
 */
export const nextPlanWindow = (
  filters: StaffingMatrixFilters,
  lastPlanDate: string,
  requestedEnd: string,
): StaffingMatrixFilters => {
  const from = Date.parse(lastPlanDate) + 1;
  const end = Date.parse(requestedEnd);
  return {
    ...filters,
    plan_ids: [],
    from: new Date(from).toISOString(),
    to: new Date(end > from ? end : from + DEFAULT_MATRIX_DAYS * DAY_MS).toISOString(),
  };
};
