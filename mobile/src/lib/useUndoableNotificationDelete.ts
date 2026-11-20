import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  adjustUnreadForNotification,
  createUndoableNotificationDelete,
  type NotificationFeedItem,
  type UndoableNotificationDelete,
  type UnreadNotificationCount,
} from '@service-center/shared';
import { api } from './api';
import { notificationKeys } from './notification-keys';
import { useAuth } from '../providers/AuthProvider';

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
 * the badge drops at once; leaving the screen commits whatever is pending.
 */
export const useUndoableNotificationDelete = (): UndoableNotificationDeleteState => {
  const { queryScope, generation, isCurrentGeneration } = useAuth();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<NotificationFeedItem | null>(null);

  const deleteNotification = useMutation({
    mutationFn: (id: string) => api.deleteNotification(id),
    onSettled: async () => {
      if (!isCurrentGeneration(generation)) return;
      await queryClient.invalidateQueries({ queryKey: notificationKeys.all(queryScope) });
    },
  });

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

  const adjustBadge = (item: NotificationFeedItem, direction: 'removed' | 'restored'): void => {
    queryClient.setQueryData<UnreadNotificationCount | undefined>(notificationKeys.unread(queryScope), (counts) =>
      adjustUnreadForNotification(counts, item, direction),
    );
  };

  return {
    pending,
    remove: (item) => {
      adjustBadge(item, 'removed');
      queueRef.current?.remove(item);
    },
    undo: () => {
      const restored = queueRef.current?.undo();
      if (restored) adjustBadge(restored, 'restored');
    },
    error: deleteNotification.error,
  };
};
