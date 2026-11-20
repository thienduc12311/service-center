import { describe, expect, it } from 'vitest';
import { displayedUnreadCount } from './notification-unread';

const unreadRow = { read_at: null };
const readRow = { read_at: '2026-11-20T00:00:00Z' };

describe('displayedUnreadCount', () => {
  it('never says caught up while unread rows are listed and the bell count is stale', () => {
    expect(displayedUnreadCount(0, [unreadRow, readRow, unreadRow])).toBe(2);
  });

  it('keeps the bell count when more unread exist than the loaded pages show', () => {
    expect(displayedUnreadCount(7, [unreadRow])).toBe(7);
  });

  it('is zero when everything is read', () => {
    expect(displayedUnreadCount(0, [readRow])).toBe(0);
    expect(displayedUnreadCount(0, [])).toBe(0);
  });
});
