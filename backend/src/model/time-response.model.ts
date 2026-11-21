import type { AssignmentTimeResponseNote, AssignmentTimeResponseRow } from '@service-center/shared';

/**
 * Columns of `assignment_time_responses` every assignment reader may select.
 * `response_note` is a private decline reason (W9-JRN-D1): Postgres refuses it
 * (and `*`) to signed-in callers; it comes from `assignment_time_response_notes`.
 */
export const TIME_RESPONSE_COLUMNS = 'assignment_id, plan_time_id, status, actor_id, responded_at';

/** A per-time answer as any roster reader sees it: the status, never the reason. */
export type PublicTimeResponseRow = Omit<AssignmentTimeResponseRow, 'response_note'>;

/** Private notes keyed by `timeResponseKey`. */
export type TimeResponseNotes = ReadonlyMap<string, string>;

export const timeResponseKey = (assignmentId: string, planTimeId: string): string => `${assignmentId}:${planTimeId}`;

export const toTimeResponseNotes = (rows: readonly AssignmentTimeResponseNote[]): TimeResponseNotes =>
  new Map(rows.map((row) => [timeResponseKey(row.assignment_id, row.plan_time_id), row.response_note]));

/** The API row shape: the note only where the caller may read it, otherwise null. */
export const withResponseNote = (
  row: PublicTimeResponseRow,
  notes: TimeResponseNotes,
): AssignmentTimeResponseRow => ({
  assignment_id: row.assignment_id,
  plan_time_id: row.plan_time_id,
  status: row.status,
  actor_id: row.actor_id,
  responded_at: row.responded_at,
  response_note: notes.get(timeResponseKey(row.assignment_id, row.plan_time_id)) ?? null,
});
