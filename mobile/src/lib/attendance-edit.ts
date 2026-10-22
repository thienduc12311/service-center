import { ApiError } from '@service-center/shared';

/**
 * MOB-017: native attendance on the F16 contracts (`attendanceSheet`,
 * `recordAttendance`, `attendanceHistory`). Draft and batch rules live in
 * `@service-center/shared` (`attendance-marking`), used by the website too;
 * this only reads the server's answer to a batch.
 */

/** How a refused or failed attendance batch should be presented. */
export type AttendanceWriteOutcome =
  /** A record changed since the sheet was read (409 `attendance_revision_stale`): nothing was saved. */
  | 'stale'
  /** No answer (or a server failure): the batch may or may not have been saved. Retry with the same key. */
  | 'uncertain'
  /** The key was already used for other marks; a fresh key is needed before saving. */
  | 'keyReused'
  /** Refused for another reason (lost authority, removed time, validation); shown as is. Nothing was saved. */
  | 'refused';

export const attendanceWriteOutcome = (error: unknown): AttendanceWriteOutcome => {
  if (error instanceof ApiError) {
    // A gateway timeout or server failure says nothing about whether the batch committed.
    if (error.status >= 500) return 'uncertain';
    if (error.code === 'attendance_revision_stale') return 'stale';
    if (error.code === 'idempotency_key_reused') return 'keyReused';
    return 'refused';
  }
  return 'uncertain';
};
