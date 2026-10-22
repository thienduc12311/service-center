import { describe, expect, it } from 'vitest';
import { recordAttendanceSchema } from '../schemas/reports.js';
import type { AttendanceSheetRow, AttendanceStatus } from '../types/reports.js';
import {
  attendanceBatchFingerprint,
  attendanceChanges,
  markEveryoneAttendance,
  rebaseAttendanceDraft,
  recordAttendanceBody,
  setAttendanceMark,
  type AttendanceDraft,
} from './attendance-marking.js';
import { buildAttendanceSheetRows } from './reports.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TIME = id(1);
const BAND = id(2);
const PRODUCTION = id(3);
const KEY = id(99);

const row = (
  n: number,
  record: { status: AttendanceStatus; revision: number; by?: string } | null = null,
  markTeam: string | null = BAND,
): AttendanceSheetRow => ({
  person_id: id(100 + n),
  person_name: `Person ${n}`,
  archived: false,
  roles: [{ assignment_id: id(200 + n), team_id: BAND, team_name: 'Band', position_name: 'Keys', response: 'confirmed', can_mark: markTeam !== null }],
  record: record
    ? {
        id: id(300 + n),
        status: record.status,
        revision: record.revision,
        marked_by_name: record.by ?? 'Jordan',
        marked_at: '2026-10-18T15:00:00Z',
        marked_team_id: BAND,
      }
    : null,
  mark_team_id: markTeam,
});

describe('attendance marking', () => {
  it('sends one mark per Person even with several positions, through the markable team', () => {
    const { rows } = buildAttendanceSheetRows(
      [
        { assignment_id: id(1), person_id: id(101), person_name: 'Riley', archived: false, team_id: PRODUCTION, team_name: 'Production', position_name: null, response: 'unconfirmed', can_mark: false },
        { assignment_id: id(2), person_id: id(101), person_name: 'Riley', archived: false, team_id: BAND, team_name: 'Band', position_name: 'Keys', response: 'confirmed', can_mark: true },
      ],
      [],
    );
    expect(rows).toHaveLength(1);
    const draft = setAttendanceMark({}, rows[0]!, 'present');
    const body = recordAttendanceBody(TIME, attendanceChanges({ rows }, draft), '', KEY);
    expect(body.marks).toEqual([{ person_id: id(101), team_id: BAND, status: 'present', expected_revision: 0 }]);
    expect(recordAttendanceSchema.safeParse(body).success).toBe(true);
  });

  it('leaves declined requests off the sheet, so absent and declined stay different things', () => {
    const { rows, counts } = buildAttendanceSheetRows(
      [{ assignment_id: id(1), person_id: id(101), person_name: 'Sam', archived: false, team_id: BAND, team_name: 'Band', position_name: null, response: 'declined', can_mark: true }],
      [],
    );
    expect(rows).toEqual([]);
    expect(counts.scheduled_people).toBe(0);
    expect(markEveryoneAttendance({ rows }, {}, 'absent')).toEqual({});
  });

  it('drops a choice that matches the saved status, and corrects a saved one at its revision', () => {
    const marked = row(1, { status: 'present', revision: 2 });
    expect(setAttendanceMark({}, marked, 'present')).toEqual({});
    const draft = setAttendanceMark({}, marked, 'absent');
    expect(attendanceChanges({ rows: [marked] }, draft)).toEqual([{ row: marked, status: 'absent', expectedRevision: 2 }]);
    expect(setAttendanceMark(draft, marked, 'present')).toEqual({});
  });

  it('keeps the revision first seen when the sheet is re-read under a choice', () => {
    const draft = setAttendanceMark({}, row(1, null), 'present');
    // Someone else marked this person absent in the meantime; the re-read shows it.
    const reread = row(1, { status: 'absent', revision: 1 });
    expect(attendanceChanges({ rows: [reread] }, draft)).toEqual([{ row: reread, status: 'present', expectedRevision: 0 }]);
    // Touching the row again does not move the base either.
    expect(setAttendanceMark(draft, reread, 'unknown')[reread.person_id]?.baseRevision).toBe(0);
  });

  it('marks everyone the caller can mark and nobody else', () => {
    const rows = [row(1), row(2, { status: 'present', revision: 1 }), row(3, null, null)];
    const draft = markEveryoneAttendance({ rows }, {}, 'present');
    expect(Object.keys(draft)).toEqual([rows[0]!.person_id]);
    expect(attendanceChanges({ rows }, draft).map((change) => change.row.person_id)).toEqual([rows[0]!.person_id]);
  });

  it('never sends rows the caller cannot mark', () => {
    const locked = row(3, null, null);
    const draft: AttendanceDraft = { [locked.person_id]: { status: 'present', baseRevision: 0, personName: locked.person_name } };
    expect(attendanceChanges({ rows: [locked] }, draft)).toEqual([]);
  });

  it('fingerprints a batch by its content, in sheet order', () => {
    const rows = [row(1), row(2)];
    const draft = markEveryoneAttendance({ rows }, {}, 'present');
    const changes = attendanceChanges({ rows }, draft);
    expect(attendanceBatchFingerprint(TIME, changes, ' late ')).toBe(attendanceBatchFingerprint(TIME, changes, 'late'));
    expect(attendanceBatchFingerprint(TIME, changes, '')).not.toBe(attendanceBatchFingerprint(TIME, changes.slice(1), ''));
    const corrected = attendanceChanges({ rows }, setAttendanceMark(draft, rows[0]!, 'absent'));
    expect(attendanceBatchFingerprint(TIME, corrected, '')).not.toBe(attendanceBatchFingerprint(TIME, changes, ''));
    expect(recordAttendanceBody(TIME, changes, '  ', KEY).reason).toBeNull();
  });

  it('after a stale refusal keeps unchanged choices and lists the ones someone else changed', () => {
    const before = [row(1), row(2), row(3), row(4), row(5)];
    let draft: AttendanceDraft = {};
    draft = setAttendanceMark(draft, before[0]!, 'present');
    draft = setAttendanceMark(draft, before[1]!, 'present');
    draft = setAttendanceMark(draft, before[2]!, 'absent');
    draft = setAttendanceMark(draft, before[3]!, 'present');
    draft = setAttendanceMark(draft, before[4]!, 'present');
    const after = [
      row(1), // unchanged
      row(2, { status: 'absent', revision: 1, by: 'Sam' }), // someone else chose otherwise
      row(3, { status: 'absent', revision: 1 }), // already says what was chosen (e.g. own batch landed)
      row(4, null, null), // no longer markable
      // Person 5 left the sheet entirely.
    ];
    const { draft: kept, superseded } = rebaseAttendanceDraft({ rows: after }, draft);
    expect(Object.keys(kept)).toEqual([before[0]!.person_id]);
    expect(superseded).toEqual([
      { personId: before[1]!.person_id, personName: 'Person 2', mine: 'present', saved: 'absent', savedBy: 'Sam', removed: false },
      { personId: before[3]!.person_id, personName: 'Person 4', mine: 'present', saved: null, savedBy: null, removed: true },
      { personId: before[4]!.person_id, personName: 'Person 5', mine: 'present', saved: null, savedBy: null, removed: true },
    ]);
  });
});
