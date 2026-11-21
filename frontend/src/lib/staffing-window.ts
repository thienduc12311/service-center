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
