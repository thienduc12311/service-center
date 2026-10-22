import type { RecordAttendanceRequest } from '../schemas/reports.js';
import type { AttendanceSheet, AttendanceSheetRow, AttendanceStatus } from '../types/reports.js';

/**
 * F16 / MOB-017: unsaved attendance choices on one plan time, shared by the
 * website Attendance tab and the native attendance screen. The server
 * (`record_attendance`) decides authority, revisions and idempotency; these
 * helpers only build one truthful batch from what the person saw.
 */

export const ATTENDANCE_STATUSES: readonly AttendanceStatus[] = ['present', 'absent', 'unknown'];

/** One unsaved choice, with the record revision it was made against. */
export interface AttendanceDraftMark {
  status: AttendanceStatus;
  /** The record revision on screen when the choice was made; 0 = nothing recorded yet. */
  baseRevision: number;
  /** Kept so a dropped choice can still be named after the row leaves the sheet. */
  personName: string;
}

/** Unsaved choices, by Person id. */
export type AttendanceDraft = Readonly<Record<string, AttendanceDraftMark>>;

/** One change to send: a markable row whose choice differs from its saved status. */
export interface AttendanceChange {
  row: AttendanceSheetRow;
  status: AttendanceStatus;
  expectedRevision: number;
}

/** The revision a mark is checked against; 0 when nothing was recorded yet. */
export const attendanceRevision = (row: Pick<AttendanceSheetRow, 'record'>): number => row.record?.revision ?? 0;

/**
 * Choose a status for one row. The revision is the one on screen when the
 * row was first touched, so a background re-read never silently moves a
 * choice onto someone else's newer record. Choosing the saved status again
 * drops the choice.
 */
export const setAttendanceMark = (
  draft: AttendanceDraft,
  row: AttendanceSheetRow,
  status: AttendanceStatus,
): AttendanceDraft => {
  const baseRevision = draft[row.person_id]?.baseRevision ?? attendanceRevision(row);
  const rest = Object.fromEntries(Object.entries(draft).filter(([personId]) => personId !== row.person_id));
  if (row.record?.status === status && baseRevision === attendanceRevision(row)) return rest;
  return { ...rest, [row.person_id]: { status, baseRevision, personName: row.person_name } };
};

/** "Mark everyone I can": every row the caller may mark gets `status`. */
export const markEveryoneAttendance = (
  sheet: Pick<AttendanceSheet, 'rows'>,
  draft: AttendanceDraft,
  status: AttendanceStatus,
): AttendanceDraft =>
  sheet.rows.filter((row) => row.mark_team_id).reduce((next, row) => setAttendanceMark(next, row, status), draft);

/** The changes to send, in sheet order (the order is part of the batch's identity). */
export const attendanceChanges = (sheet: Pick<AttendanceSheet, 'rows'>, draft: AttendanceDraft): AttendanceChange[] =>
  sheet.rows.flatMap((row) => {
    const mark = draft[row.person_id];
    if (!mark || !row.mark_team_id) return [];
    if (row.record?.status === mark.status && mark.baseRevision === attendanceRevision(row)) return [];
    return [{ row, status: mark.status, expectedRevision: mark.baseRevision }];
  });

/** The `recordAttendance` body for one reviewed batch (all marks apply, or none). */
export const recordAttendanceBody = (
  planTimeId: string,
  changes: readonly AttendanceChange[],
  reason: string,
  idempotencyKey: string,
): RecordAttendanceRequest => ({
  plan_time_id: planTimeId,
  marks: changes.map(({ row, status, expectedRevision }) => ({
    person_id: row.person_id,
    team_id: row.mark_team_id!,
    status,
    expected_revision: expectedRevision,
  })),
  reason: reason.trim() || null,
  idempotency_key: idempotencyKey,
});

/**
 * Identifies a batch's content. Keep one idempotency key while this stays the
 * same (a retry after no answer replays the first result); a different batch
 * needs a new key, or the server refuses it as `idempotency_key_reused`.
 */
export const attendanceBatchFingerprint = (
  planTimeId: string,
  changes: readonly AttendanceChange[],
  reason: string,
): string =>
  JSON.stringify([
    planTimeId,
    reason.trim(),
    changes.map(({ row, status, expectedRevision }) => [row.person_id, row.mark_team_id, status, expectedRevision]),
  ]);

/** A choice dropped because the record changed (or the row went) after it was made. */
export interface SupersededAttendanceMark {
  personId: string;
  personName: string;
  /** What this person chose. */
  mine: AttendanceStatus;
  /** What is saved now; null when the row is no longer on the sheet or never recorded. */
  saved: AttendanceStatus | null;
  savedBy: string | null;
  /** True when the person is no longer someone the caller can mark at this time. */
  removed: boolean;
}

export interface AttendanceRebase {
  draft: AttendanceDraft;
  superseded: SupersededAttendanceMark[];
}

/**
 * After a stale refusal and a fresh read: keep every choice whose record is
 * unchanged, drop the rest. A record that now already says what was chosen
 * is dropped quietly (including a batch of one's own that did land); any
 * other is listed so the person sees the newer mark before choosing again.
 */
export const rebaseAttendanceDraft = (sheet: Pick<AttendanceSheet, 'rows'>, draft: AttendanceDraft): AttendanceRebase => {
  const rows = new Map(sheet.rows.map((row) => [row.person_id, row]));
  const kept: Record<string, AttendanceDraftMark> = {};
  const superseded: SupersededAttendanceMark[] = [];
  for (const [personId, mark] of Object.entries(draft)) {
    const row = rows.get(personId);
    if (row?.mark_team_id && attendanceRevision(row) === mark.baseRevision) {
      kept[personId] = mark;
      continue;
    }
    if (row?.record?.status === mark.status) continue;
    superseded.push({
      personId,
      personName: row?.person_name ?? mark.personName,
      mine: mark.status,
      saved: row?.record?.status ?? null,
      savedBy: row?.record?.marked_by_name ?? null,
      removed: !row?.mark_team_id,
    });
  }
  return { draft: kept, superseded };
};
