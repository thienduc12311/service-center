import { describe, expect, it } from 'vitest';
import { escapeIcsText, formatIcsUtc, renderIcs } from './ics.js';

describe('ics', () => {
  it('formats UTC values, escapes text, and keeps stable UIDs and sequences', () => {
    const first = renderIcs([
      {
        uid: 'plan-time-123@example.test',
        summary: 'Service, Main; Room\\A',
        startsAt: '2026-09-06T14:00:00-04:00',
        endsAt: '2026-09-06T15:30:00-04:00',
        sequence: 3,
        description: 'Line one\nLine two',
      },
    ], { dtstamp: '2026-09-01T00:00:00Z' });
    const second = renderIcs([
      {
        uid: 'plan-time-123@example.test',
        summary: 'Service, Main; Room\\A',
        startsAt: '2026-09-06T14:00:00-04:00',
        endsAt: '2026-09-06T15:30:00-04:00',
        sequence: 4,
      },
    ], { dtstamp: '2026-09-01T00:00:00Z' });
    expect(first).toContain('METHOD:PUBLISH\r\n');
    expect(first).toContain('DTSTART:20260906T180000Z\r\n');
    expect(first).toContain('SUMMARY:Service\\, Main\\; Room\\\\A\r\n');
    expect(first).toContain('DESCRIPTION:Line one\\nLine two\r\n');
    expect(first).toContain('UID:plan-time-123@example.test\r\n');
    expect(first).toContain('SEQUENCE:3\r\n');
    expect(second).toContain('UID:plan-time-123@example.test\r\n');
    expect(second).toContain('SEQUENCE:4\r\n');
  });

  it('folds long UTF-8 lines at 75 octets', () => {
    const calendar = renderIcs([{ uid: 'u', summary: 'é'.repeat(80), startsAt: '2026-01-01T00:00:00Z', endsAt: '2026-01-01T01:00:00Z', sequence: 0 }]);
    for (const line of calendar.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(escapeIcsText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
  });

  it('rejects invalid dates', () => {
    expect(() => formatIcsUtc('not a date')).toThrow('Invalid calendar date');
  });
});
