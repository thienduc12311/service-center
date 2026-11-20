import type { NotificationFeedItem, UnreadNotificationCount } from '../types/domain.js';

/** How long a deleted notification can be restored with Undo before it is really deleted. */
export const NOTIFICATION_UNDO_MS = 5_000;

/** Where a timer is scheduled; injectable so tests can drive time. */
export interface UndoTimers {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

export interface UndoableNotificationDeleteOptions {
  /** Actually deletes the notification on the server. */
  commit: (item: NotificationFeedItem) => void;
  /** Told whenever the pending notification changes (null once committed or undone). */
  onChange: (pending: NotificationFeedItem | null) => void;
  delayMs?: number;
  timers?: UndoTimers;
}

/**
 * Holds at most one deleted notification for `delayMs` so it can be undone.
 * Deleting a second one commits the first straight away; `flush` commits the
 * pending one immediately (leaving the screen), `undo` puts it back.
 */
export interface UndoableNotificationDelete {
  remove: (item: NotificationFeedItem) => void;
  undo: () => NotificationFeedItem | null;
  flush: () => void;
}

const defaultTimers: UndoTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export const createUndoableNotificationDelete = ({
  commit,
  onChange,
  delayMs = NOTIFICATION_UNDO_MS,
  timers = defaultTimers,
}: UndoableNotificationDeleteOptions): UndoableNotificationDelete => {
  let pending: NotificationFeedItem | null = null;
  let handle: unknown = null;

  const take = (): NotificationFeedItem | null => {
    const item = pending;
    if (handle !== null) timers.clear(handle);
    pending = null;
    handle = null;
    return item;
  };

  const flush = (): void => {
    const item = take();
    if (!item) return;
    commit(item);
    onChange(null);
  };

  return {
    remove: (item) => {
      if (pending?.id === item.id) return;
      const previous = take();
      if (previous) commit(previous);
      pending = item;
      handle = timers.set(flush, delayMs);
      onChange(item);
    },
    undo: () => {
      const item = take();
      if (item) onChange(null);
      return item;
    },
    flush,
  };
};

/**
 * The bell's counts with one notification added or taken away, so the badge
 * moves the moment a user deletes (or restores) an unread notification
 * instead of waiting for the next poll.
 */
export const adjustUnreadForNotification = (
  counts: UnreadNotificationCount | undefined,
  item: Pick<NotificationFeedItem, 'read_at'>,
  direction: 'removed' | 'restored',
): UnreadNotificationCount | undefined => {
  if (!counts || item.read_at) return counts;
  const delta = direction === 'removed' ? -1 : 1;
  return {
    unread: Math.max(0, counts.unread + delta),
    account_unread: Math.max(0, counts.account_unread + delta),
  };
};
