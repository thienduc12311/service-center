import { ApiError, nextOccurrence, type PlanRecurrence } from '@service-center/shared';

/** Steps beyond this many occurrences stop looking for a future date. */
const MAX_STEPS = 1000;

/**
 * The copy's default date: the source's next date in its service type's
 * rhythm, stepped forward until it is in the future (copying an old plan
 * should not default to another past date).
 */
export const defaultCopyDate = (sourceDate: string, recurrence: PlanRecurrence, now: Date = new Date()): Date => {
  let next = nextOccurrence(sourceDate, recurrence);
  for (let step = 0; next <= now && step < MAX_STEPS; step += 1) next = nextOccurrence(next, recurrence);
  return next;
};

/** A `datetime-local` input value (browser-local wall time) for an instant. */
export const toDateTimeLocal = (value: Date): string => {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
};

/** A `datetime-local` value as an ISO instant, or null when it is empty or not a date. */
export const fromDateTimeLocal = (value: string): string | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/** How the copy dialog explains a failed copy. */
export type CopyPlanFailure = 'permission' | 'reused' | 'conflict' | 'other';

/**
 * Sorts an error from `POST /plans/:id/duplicate`. RLS hides a plan the caller
 * may not edit, so 404 reads as "no permission" here just like 403.
 */
export const classifyCopyPlanError = (error: unknown): CopyPlanFailure => {
  if (!(error instanceof ApiError)) return 'other';
  if (error.code === 'scheduling_conflict') return 'conflict';
  if (error.code === 'idempotency_key_reused') return 'reused';
  if (error.status === 403 || error.status === 404) return 'permission';
  return 'other';
};
