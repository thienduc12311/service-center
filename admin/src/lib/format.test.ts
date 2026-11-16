import { describe, expect, it } from 'vitest';
import { formatRelativeTime, pluralize } from './format';

const NOW = Date.parse('2026-11-15T12:00:00Z');

describe('formatRelativeTime', () => {
  it('describes past and future instants', () => {
    expect(formatRelativeTime('2026-11-12T12:00:00Z', NOW)).toBe('3 days ago');
    expect(formatRelativeTime('2026-11-15T17:00:00Z', NOW)).toBe('in 5 hours');
    expect(formatRelativeTime('2026-11-14T12:00:00Z', NOW)).toBe('yesterday');
  });

  it('says just now under a minute', () => {
    expect(formatRelativeTime('2026-11-15T11:59:30Z', NOW)).toBe('just now');
  });
});

describe('pluralize', () => {
  it('picks the right form', () => {
    expect(pluralize(1, 'account')).toBe('1 account');
    expect(pluralize(1200, 'account')).toBe('1,200 accounts');
    expect(pluralize(2, 'person', 'people')).toBe('2 people');
  });
});
