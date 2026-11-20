import { beforeEach, describe, expect, it } from 'vitest';
import type { NotificationFeedItem } from '../types/domain.js';
import {
  adjustUnreadForNotification,
  createUndoableNotificationDelete,
  type UndoTimers,
  type UndoableNotificationDelete,
} from './notification-cleanup.js';

/** Manual clock: `advance` fires every timer due by then. */
interface FakeClock extends UndoTimers {
  advance: (ms: number) => void;
}

const fakeClock = (): FakeClock => {
  let now = 0;
  let nextId = 1;
  const due = new Map<number, { at: number; callback: () => void }>();
  return {
    set: (callback, ms) => {
      const id = nextId++;
      due.set(id, { at: now + ms, callback });
      return id;
    },
    clear: (handle) => {
      due.delete(handle as number);
    },
    advance: (ms) => {
      now += ms;
      for (const [id, timer] of [...due]) {
        if (timer.at <= now) {
          due.delete(id);
          timer.callback();
        }
      }
    },
  };
};

const item = (id: string, readAt: string | null = null): NotificationFeedItem =>
  ({ id, read_at: readAt, title: id, plan: null }) as unknown as NotificationFeedItem;

describe('createUndoableNotificationDelete', () => {
  let clock: FakeClock;
  let committed: string[];
  let changes: (string | null)[];
  let queue: UndoableNotificationDelete;

  beforeEach(() => {
    clock = fakeClock();
    committed = [];
    changes = [];
    queue = createUndoableNotificationDelete({
      commit: (n) => committed.push(n.id),
      onChange: (n) => changes.push(n?.id ?? null),
      delayMs: 5_000,
      timers: clock,
    });
  });

  it('deletes on the server only after the undo window', () => {
    queue.remove(item('a'));
    clock.advance(4_999);
    expect(committed).toEqual([]);
    clock.advance(1);
    expect(committed).toEqual(['a']);
    expect(changes).toEqual(['a', null]);
  });

  it('undo restores the notification and never deletes it', () => {
    queue.remove(item('a'));
    expect(queue.undo()?.id).toBe('a');
    clock.advance(10_000);
    expect(committed).toEqual([]);
    expect(changes).toEqual(['a', null]);
  });

  it('deleting a second notification commits the first straight away', () => {
    queue.remove(item('a'));
    queue.remove(item('b'));
    expect(committed).toEqual(['a']);
    clock.advance(5_000);
    expect(committed).toEqual(['a', 'b']);
  });

  it('ignores deleting the same notification twice', () => {
    queue.remove(item('a'));
    queue.remove(item('a'));
    clock.advance(5_000);
    expect(committed).toEqual(['a']);
  });

  it('flush commits the pending notification immediately, once', () => {
    queue.remove(item('a'));
    queue.flush();
    clock.advance(5_000);
    expect(committed).toEqual(['a']);
  });

  it('undo and flush with nothing pending do nothing', () => {
    expect(queue.undo()).toBeNull();
    queue.flush();
    expect(committed).toEqual([]);
    expect(changes).toEqual([]);
  });
});

describe('adjustUnreadForNotification', () => {
  const counts = { unread: 2, account_unread: 4 };

  it('moves both counts for an unread notification', () => {
    expect(adjustUnreadForNotification(counts, { read_at: null }, 'removed')).toEqual({ unread: 1, account_unread: 3 });
    expect(adjustUnreadForNotification(counts, { read_at: null }, 'restored')).toEqual({ unread: 3, account_unread: 5 });
  });

  it('leaves counts alone for a read notification', () => {
    expect(adjustUnreadForNotification(counts, { read_at: '2026-01-01T00:00:00Z' }, 'removed')).toBe(counts);
  });

  it('never goes below zero and tolerates missing counts', () => {
    expect(adjustUnreadForNotification({ unread: 0, account_unread: 0 }, { read_at: null }, 'removed')).toEqual({ unread: 0, account_unread: 0 });
    expect(adjustUnreadForNotification(undefined, { read_at: null }, 'removed')).toBeUndefined();
  });
});
