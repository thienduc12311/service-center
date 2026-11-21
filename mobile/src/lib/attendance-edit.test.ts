import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApiError, type AttendanceSheetRow } from '@service-center/shared';
import { attendanceSections, attendanceWriteOutcome } from './attendance-edit';

describe('attendanceWriteOutcome', () => {
  it('separates stale, lost, key-reuse and other refusals', () => {
    expect(attendanceWriteOutcome(new ApiError(409, 'x', 'attendance_revision_stale'))).toBe('stale');
    expect(attendanceWriteOutcome(new ApiError(409, 'x', 'idempotency_key_reused'))).toBe('keyReused');
    expect(attendanceWriteOutcome(new TypeError('Network request failed'))).toBe('uncertain');
    // A gateway timeout says nothing about whether the batch committed.
    expect(attendanceWriteOutcome(new ApiError(504, 'x'))).toBe('uncertain');
    expect(attendanceWriteOutcome(new ApiError(403, 'x', 'forbidden'))).toBe('refused');
    expect(attendanceWriteOutcome(new ApiError(404, 'x'))).toBe('refused');
    expect(attendanceWriteOutcome(new ApiError(422, 'x', 'validation_error'))).toBe('refused');
  });
});

describe('attendanceSections', () => {
  const role = (team_id: string, team_name: string) => ({
    assignment_id: team_id + '-a',
    team_id,
    team_name,
    position_name: null,
    response: 'confirmed' as const,
    can_mark: true,
  });
  const row = (person_id: string, person_name: string, roles: AttendanceSheetRow['roles'], mark_team_id: string | null = null): AttendanceSheetRow => ({
    person_id,
    person_name,
    archived: false,
    roles,
    record: null,
    mark_team_id,
  });
  const rows = [
    row('a', 'Ân Đặng', [role('band', 'Band'), role('tech', 'Tech')], 'tech'),
    row('b', 'Ben', [role('band', 'Band')]),
    row('c', 'Cam', []),
  ];

  it('lists each person once, under the team they are marked through', () => {
    expect(attendanceSections(rows, '', 'Other').map((s) => [s.key, s.title, s.data.map((r) => r.person_id)])).toEqual([
      ['tech', 'Tech', ['a']],
      ['band', 'Band', ['b']],
      ['other', 'Other', ['c']],
    ]);
  });

  it('filters by name without accents', () => {
    expect(attendanceSections(rows, 'an dang', 'Other').flatMap((s) => s.data.map((r) => r.person_id))).toEqual(['a']);
  });
});

describe('native attendance screen source', () => {
  const source = readFileSync(join(__dirname, '..', '..', 'app', 'plan', 'attendance', '[id].tsx'), 'utf8');

  it('saves through one shared batch body, never a loop of calls', () => {
    expect(source.match(/api\.recordAttendance\(/g)).toHaveLength(1);
    expect(source).toContain('recordAttendanceBody(');
    expect(source).not.toMatch(/\.(map|forEach)\([^)]*recordAttendance/s);
  });

  it('never reads or writes assignment answers (attendance is separate from confirmation)', () => {
    expect(source).not.toMatch(/api\.(respond|answer|updateAssignment|setAssignment)\w*\(/);
  });

  it('keeps one idempotency key per batch content', () => {
    expect(source).toContain('attendanceBatchFingerprint(');
    expect(source).toContain('newIdempotencyKey()');
  });
});
