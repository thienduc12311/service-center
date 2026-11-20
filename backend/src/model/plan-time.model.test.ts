import { describe, expect, it } from 'vitest';
import { earliestServiceStart } from './plan-time.model.js';

describe('earliestServiceStart', () => {
  it('picks the earliest service time and ignores rehearsals', () => {
    expect(
      earliestServiceStart([
        { kind: 'rehearsal', starts_at: '2026-11-29T08:00:00Z' },
        { kind: 'service', starts_at: '2026-11-29T17:31:00Z' },
        { starts_at: '2026-11-29T19:00:00-00:00' },
      ]),
    ).toBe('2026-11-29T17:31:00.000Z');
  });

  it('is null without a service time', () => {
    expect(earliestServiceStart([])).toBeNull();
    expect(earliestServiceStart([{ kind: 'rehearsal', starts_at: '2026-11-29T08:00:00Z' }])).toBeNull();
  });
});
