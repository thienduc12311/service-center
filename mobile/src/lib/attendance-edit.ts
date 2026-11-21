import { ApiError, type AttendanceSheetRow } from '@service-center/shared';
import { matchesSearch } from './list-search';

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

/** One team's people on the sheet, ready for a `SectionList`. */
export interface AttendanceSection {
  /** The team id, or `other` for people with no role listed. */
  key: string;
  title: string;
  data: AttendanceSheetRow[];
}

/**
 * The sheet grouped by team, filtered by name (accent-insensitive). Each
 * Person appears once, under the team they are marked through (else their
 * first role's team), so counts and choices are never duplicated; their other
 * roles still show on the row. Teams keep the server's order.
 */
export const attendanceSections = (rows: readonly AttendanceSheetRow[], query: string, otherTitle: string): AttendanceSection[] => {
  const sections = new Map<string, AttendanceSection>();
  for (const row of rows) {
    if (!matchesSearch(query, [row.person_name])) continue;
    const role = row.roles.find((candidate) => candidate.team_id === row.mark_team_id) ?? row.roles[0];
    const key = role?.team_id ?? 'other';
    let section = sections.get(key);
    if (!section) {
      section = { key, title: role?.team_name ?? otherTitle, data: [] };
      sections.set(key, section);
    }
    section.data.push(row);
  }
  return [...sections.values()];
};
