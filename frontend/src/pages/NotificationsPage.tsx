import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { conversationNotificationTarget, type NotificationFeedItem } from '@service-center/shared';
import {
  useClearReadNotifications,
  useMarkNotificationsRead,
  useNotificationFeed,
  useUnreadNotificationCount,
} from '../hooks/queries';
import { useUndoableNotificationDelete } from '../hooks/useUndoableNotificationDelete';
import { useFormatters } from '../i18n';
import { Button, EmptyState, ErrorNotice, IconButton, Modal, Notice, PageHeader, Segmented, SkeletonList } from '../components/ui';
import { Icon, type IconName } from '../components/icons';
import { dayLabelKind, groupByDay } from '../lib/day-groups';

/** Where tapping a notification leads on web; null when it points nowhere. */
const notificationHref = (item: NotificationFeedItem): string | null => {
  if (item.operational_message_id) return `/messages/${item.operational_message_id}`;
  const conversationId = conversationNotificationTarget(item);
  if (conversationId) return `/chat/${conversationId}`;
  if (item.plan_id) return `/plans/${item.plan_id}`;
  return null;
};

const notificationIcon = (item: NotificationFeedItem): IconName => {
  if (item.operational_message_id) return 'mail';
  if (conversationNotificationTarget(item)) return 'chat';
  if (item.plan_id) return 'calendar';
  return 'bell';
};

/**
 * Where keyboard focus goes after a delete or Undo, so it never falls back to
 * the page body: a row's delete button, or the toast's Undo button.
 */
type FocusTarget = { kind: 'delete'; id: string } | { kind: 'undo' };

const focusSelector = (target: FocusTarget): string =>
  target.kind === 'undo' ? '[data-notification-undo]' : `[data-notification-delete="${target.id}"]`;

/** Which notifications the feed shows; the server filters unread ones. */
type FeedView = 'all' | 'unread';

/** Everything the bell has collected in the active church, newest first. */
export const NotificationsPage = () => {
  const { t } = useTranslation(['scheduling', 'common']);
  const f = useFormatters();
  const navigate = useNavigate();
  const [view, setView] = useState<FeedView>('all');
  const feed = useNotificationFeed(view === 'unread');
  const unread = useUnreadNotificationCount().data?.unread ?? feed.data?.pages[0]?.unread ?? 0;
  const markRead = useMarkNotificationsRead();
  const clearRead = useClearReadNotifications();
  const removal = useUndoableNotificationDelete();
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  const [cleared, setCleared] = useState<number | null>(null);

  const items = useMemo<NotificationFeedItem[]>(
    () => (feed.data?.pages ?? []).flatMap((page) => page.items).filter((item) => item.id !== removal.pending?.id),
    [feed.data, removal.pending],
  );
  const days = useMemo(() => groupByDay(items, (item) => item.created_at), [items]);
  // Read rows may sit on pages not loaded yet, or be filtered out of the Unread
  // view: offer the clean-up unless the whole feed is known to be empty, and let
  // the server find what is read.
  const feedKnownEmpty = view === 'all' && !feed.isLoading && !feed.hasNextPage && items.length === 0 && !removal.pending;
  const dayLabel = (day: string): string => {
    const kind = dayLabelKind(day);
    return kind === 'date' ? f.calendarDate(day, 'long') : t(`common:states.${kind}`);
  };

  // Runs after the row has gone (or come back), so the target exists in the DOM.
  useEffect(() => {
    if (!focusTarget) return;
    document.querySelector<HTMLElement>(focusSelector(focusTarget))?.focus();
    setFocusTarget(null);
  }, [focusTarget, items]);

  const remove = (item: NotificationFeedItem): void => {
    const index = items.findIndex((candidate) => candidate.id === item.id);
    const neighbour = items[index + 1] ?? items[index - 1];
    removal.remove(item);
    setFocusTarget(neighbour ? { kind: 'delete', id: neighbour.id } : { kind: 'undo' });
  };

  const undo = (): void => {
    const restored = removal.pending;
    removal.undo();
    if (restored) setFocusTarget({ kind: 'delete', id: restored.id });
  };

  const open = (item: NotificationFeedItem): void => {
    if (!item.read_at) markRead.mutate([item.id]);
    const href = notificationHref(item);
    if (href) navigate(href);
  };

  const closeClear = (): void => {
    setConfirmingClear(false);
    clearRead.reset();
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow={unread ? t('notifications.unreadCount', { count: unread }) : t('notifications.allCaughtUp')}
        title={t('common:nav.notifications')}
        subtitle={t('notifications.description')}
        actions={
          <>
            {unread > 0 && (
              <Button variant="secondary" icon="check" loading={markRead.isPending} onClick={() => markRead.mutate(undefined)}>
                {t('notifications.markAllRead')}
              </Button>
            )}
            {!feedKnownEmpty && (
              <Button variant="secondary" icon="trash" onClick={() => setConfirmingClear(true)}>
                {t('notifications.clearRead')}
              </Button>
            )}
          </>
        }
      />

      <div className="space-y-4">
        <Segmented<FeedView>
          label={t('notifications.viewLabel')}
          value={view}
          onChange={(next) => { setView(next); setCleared(null); }}
          items={[
            { value: 'all', label: t('notifications.views.all') },
            { value: 'unread', label: t('notifications.views.unread'), count: unread || undefined },
          ]}
        />
        <ErrorNotice error={feed.error ?? markRead.error ?? removal.error} />
        {cleared !== null && (
          <Notice tone="success">
            {cleared > 0 ? t('notifications.clearedRead', { count: cleared }) : t('notifications.clearedNone')}
          </Notice>
        )}

        {feed.isLoading ? (
          <SkeletonList rows={4} />
        ) : items.length === 0 ? (
          view === 'unread'
            ? <EmptyState icon="check" title={t('notifications.emptyUnreadTitle')} description={t('notifications.emptyUnreadDescription')} />
            : <EmptyState icon="bell" title={t('notifications.emptyTitle')} description={t('notifications.emptyDescription')} />
        ) : (
          days.map((group) => (
            <section key={group.day} aria-label={dayLabel(group.day)}>
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {dayLabel(group.day)}
              </h2>
              <ul className="card divide-y divide-app-border overflow-hidden">
                {group.items.map((item) => (
                  <NotificationListItem key={item.id} item={item} onOpen={() => open(item)} onDelete={() => remove(item)} />
                ))}
              </ul>
            </section>
          ))
        )}

        {feed.hasNextPage && (
          <div className="flex justify-center">
            <Button variant="secondary" loading={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>
              {t('notifications.loadMore')}
            </Button>
          </div>
        )}
      </div>

      {removal.pending && <UndoToast message={t('notifications.deleted')} actionLabel={t('notifications.undo')} onUndo={undo} />}

      <Modal open={confirmingClear} title={t('notifications.clearReadTitle')} onClose={closeClear}>
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">{t('notifications.clearReadBody')}</p>
          <ErrorNotice error={clearRead.error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" autoFocus disabled={clearRead.isPending} onClick={closeClear}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={clearRead.isPending}
              onClick={() => clearRead.mutate(undefined, {
                onSuccess: ({ deleted }) => {
                  setConfirmingClear(false);
                  setCleared(deleted);
                },
              })}
            >
              {t('notifications.clearReadConfirm')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

interface NotificationListItemProps {
  item: NotificationFeedItem;
  onOpen: () => void;
  onDelete: () => void;
}

const NotificationListItem = ({ item, onOpen, onDelete }: NotificationListItemProps) => {
  const { t } = useTranslation('scheduling');
  const f = useFormatters();
  const unread = !item.read_at;

  return (
    <li className="group flex items-start gap-3 px-4 py-3 transition hover:bg-slate-50 dark:hover:bg-slate-800/50">
      <button
        type="button"
        onClick={onOpen}
        // Title and body are stored server-side in the recipient's language; shown as-is.
        aria-label={unread ? t('notifications.unreadItem', { title: item.title }) : item.title}
        className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left outline-offset-4 focus-visible:outline-2 focus-visible:outline-brand-500"
      >
        <span
          className={`grid size-9 shrink-0 place-items-center rounded-xl ${
            unread ? 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-200' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
          }`}
        >
          <Icon name={notificationIcon(item)} className="size-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-sm ${unread ? 'font-semibold text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300'}`}>
            {item.title}
          </span>
          {item.body && <span className="mt-0.5 block text-sm text-slate-500 dark:text-slate-400">{item.body}</span>}
          <span className={`mt-1 block text-xs ${unread ? 'text-brand-700 dark:text-brand-200' : 'text-slate-400 dark:text-slate-500'}`}>
            {f.dateTime(item.created_at)}
          </span>
        </span>
        {unread && <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-500" />}
      </button>
      <IconButton
        icon="trash"
        label={t('notifications.deleteItem', { title: item.title })}
        onClick={onDelete}
        data-notification-delete={item.id}
        // 36px visual button with an invisible 44px hit area.
        className="relative -my-0.5 before:absolute before:-inset-1 before:content-['']"
      />
    </li>
  );
};

interface UndoToastProps {
  message: string;
  actionLabel: string;
  onUndo: () => void;
}

const UndoToast = ({ message, actionLabel, onUndo }: UndoToastProps) => (
  <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
    <div
      role="status"
      className="animate-pop-in pointer-events-auto flex items-center gap-4 rounded-xl bg-slate-900 px-4 py-2.5 text-sm text-white shadow-lg shadow-slate-900/20 dark:bg-slate-100 dark:text-slate-900"
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onUndo}
        data-notification-undo
        className="relative font-semibold before:absolute before:-inset-x-2 before:-inset-y-3 before:content-[''] text-brand-300 hover:text-brand-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400 dark:text-brand-700 dark:hover:text-brand-800"
      >
        {actionLabel}
      </button>
    </div>
  </div>
);
