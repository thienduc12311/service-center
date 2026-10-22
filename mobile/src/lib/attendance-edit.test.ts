import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@service-center/shared';
import { attendanceWriteOutcome } from './attendance-edit';

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
