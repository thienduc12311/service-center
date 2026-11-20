import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  adjustUnreadForNotification,
  createUndoableNotificationDelete,
  type NotificationFeedItem,
  type UndoableNotificationDelete,
  type UnreadNotificationCount,
} from '@service-center/shared';
import { useAuth } from '../providers/AuthProvider';
import { keys, useDeleteNotification } from './queries';

export interface UndoableNotificationDeleteState {
  /** The notification waiting out its undo window, hidden from the feed. */
  pending: NotificationFeedItem | null;
  remove: (item: NotificationFeedItem) => void;
  undo: () => void;
  /** The server error from the last real delete, if any. */
  error: unknown;
}

/**
 * Deletes a notification after a short Undo window. The row disappears and
 * the bell's count drops at once; leaving the page commits whatever is still
 * pending.
 */
export const useUndoableNotificationDelete = (): UndoableNotificationDeleteState => {
  const org = useAuth().organizationId;
  const queryClient = useQueryClient();
  const deleteNotification = useDeleteNotification();
  const [pending, setPending] = useState<NotificationFeedItem | null>(null);

  // The queue outlives renders; the latest mutate is read through a ref.
  const mutateRef = useRef(deleteNotification.mutate);
  useLayoutEffect(() => {
    mutateRef.current = deleteNotification.mutate;
  }, [deleteNotification.mutate]);
  const queueRef = useRef<UndoableNotificationDelete | null>(null);
  if (!queueRef.current) {
    queueRef.current = createUndoableNotificationDelete({
      commit: (item) => mutateRef.current(item.id),
      onChange: setPending,
    });
  }

  useEffect(() => {
    const queue = queueRef.current;
    return () => queue?.flush();
  }, []);

  const adjustBell = (item: NotificationFeedItem, direction: 'removed' | 'restored'): void => {
    queryClient.setQueryData<UnreadNotificationCount | undefined>(keys.notificationUnread(org), (counts) =>
      adjustUnreadForNotification(counts, item, direction),
    );
  };

  return {
    pending,
    remove: (item) => {
      adjustBell(item, 'removed');
      queueRef.current?.remove(item);
    },
    undo: () => {
      const restored = queueRef.current?.undo();
      if (restored) adjustBell(restored, 'restored');
    },
    error: deleteNotification.error,
  };
};
