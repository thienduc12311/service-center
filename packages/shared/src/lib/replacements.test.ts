import { describe, expect, it } from 'vitest';
import { replacementRequestExpiry, replacementRequiredTimes } from './replacements.js';

const now = new Date('2026-10-20T12:00:00.000Z');

describe('replacementRequestExpiry', () => {
  it('stays open seven days when the service is further away', () => {
    expect(replacementRequestExpiry(now, [{ starts_at: '2026-12-01T15:00:00.000Z' }])).toBe('2026-10-27T12:00:00.000Z');
  });

  it('closes when the first required time starts', () => {
    expect(replacementRequestExpiry(now, [
      { starts_at: '2026-10-23T09:00:00.000Z' },
      { starts_at: '2026-10-22T18:00:00.000Z' },
    ])).toBe('2026-10-22T18:00:00.000Z');
  });

  it('offers nothing once the first required time has started', () => {
    expect(replacementRequestExpiry(now, [{ starts_at: '2026-10-20T12:00:00.000Z' }])).toBeNull();
  });

  it('uses seven days for an untimed plan', () => {
    expect(replacementRequestExpiry(now, [])).toBe('2026-10-27T12:00:00.000Z');
  });
});

describe('replacementRequiredTimes', () => {
  const times = [
    { id: 'service', starts_at: '2026-11-01T15:00:00.000Z' },
    { id: 'rehearsal', starts_at: '2026-10-31T18:00:00.000Z' },
  ];

  it('covers every plan time when the original was asked for all', () => {
    expect(replacementRequiredTimes({ applicable_time_ids: [] }, times).map((time) => time.id)).toEqual(['rehearsal', 'service']);
  });

  it('covers only the original assignment\'s times', () => {
    expect(replacementRequiredTimes({ applicable_time_ids: ['service'] }, times).map((time) => time.id)).toEqual(['service']);
  });
});
