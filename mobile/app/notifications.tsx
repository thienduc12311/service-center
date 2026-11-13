import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { conversationNotificationTarget, type NotificationFeedItem } from '@service-center/shared';
import { api } from '../src/lib/api';
import { notificationKeys } from '../src/lib/notification-keys';
import { useAuth } from '../src/providers/AuthProvider';
import { useNotifications } from '../src/providers/NotificationsProvider';
import {
  Button,
  EmptyState,
  IconWell,
  ErrorNotice,
  Loading,
  Screen,
  ScreenHeader,
  SectionHeader,
  screenPadding,
} from '../src/components/ui';
import { Icon, type IconName } from '../src/components/icons';
import { PressableScale, Reveal } from '../src/components/motion';
import type { Theme } from '../src/lib/theme';
import { useTheme, useThemedStyles } from '../src/lib/useTheme';
import { useFormatters } from '../src/i18n';

const PAGE_SIZE = 30;

/** Everything the bell has collected, newest first. */
export default function NotificationsScreen() {
  const { queryScope, generation, isCurrentGeneration } = useAuth();
  const { unread, refresh, push } = useNotifications();
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const { t } = useTranslation(['scheduling', 'settings', 'common']);

  const feed = useInfiniteQuery({
    queryKey: notificationKeys.feed(queryScope),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      api.listNotifications({ limit: PAGE_SIZE, before: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: Boolean(queryScope),
  });

  const invalidate = useCallback(async () => {
    if (!isCurrentGeneration(generation)) return;
    await queryClient.invalidateQueries({ queryKey: notificationKeys.all(queryScope) });
  }, [generation, isCurrentGeneration, queryClient, queryScope]);

  const markRead = useMutation({
    mutationFn: (ids?: string[]) => api.markNotificationsRead(ids ? { ids } : {}),
    onSuccess: invalidate,
  });

  const items = useMemo<NotificationFeedItem[]>(
    () => (feed.data?.pages ?? []).flatMap((page) => page.items),
    [feed.data],
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([feed.refetch(), refresh()]);
    if (isCurrentGeneration(generation)) setRefreshing(false);
  }, [feed, generation, isCurrentGeneration, refresh]);

  const open = (item: NotificationFeedItem): void => {
    if (!item.read_at) markRead.mutate([item.id]);
    // MOB-018: a targeted message opens its own copy; the server rechecks access.
    const conversationId = conversationNotificationTarget(item);
    if (item.operational_message_id) router.push({ pathname: '/messages/[id]', params: { id: item.operational_message_id } });
    // MOB-019: a chat notification opens its conversation; the server rechecks participation.
    else if (conversationId) router.push({ pathname: '/chat/[id]', params: { id: conversationId } });
    else if (item.plan_id) router.push(`/plan/${item.plan_id}`);
  };

  return (
    <Screen>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[screenPadding(theme), styles.list]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.color.inkFaint}
          />
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
        }}
        ListHeaderComponent={
          <View style={styles.header}>
            <ScreenHeader
              eyebrow={unread ? t('notifications.unreadCount', { count: unread }) : t('notifications.allCaughtUp')}
              title={t('common:nav.notifications')}
              description={t('notifications.description')}
              action={
                unread ? (
                  <Button
                    title={t('notifications.markAllRead')}
                    variant="secondary"
                    onPress={() => markRead.mutate(undefined)}
                    loading={markRead.isPending}
                  />
                ) : undefined
              }
            />
            {/* MOB-020: the feed is the fallback when push is off; say so and offer the way back. */}
            {push.recovery !== 'none' ? (
              <View style={styles.pushHint}>
                <View style={styles.pushHintRow}>
                  <Icon name="info" size={17} color={theme.accent.yellow.fg} />
                  <Text style={styles.pushHintText}>{t('settings:mobileNotifications.feedHint')}</Text>
                </View>
                <Button
                  title={t('settings:mobileNotifications.feedHintAction')}
                  variant="secondary"
                  icon="settings"
                  onPress={() => router.push('/notification-settings')}
                />
              </View>
            ) : null}
            <ErrorNotice error={feed.error ?? markRead.error} />
            {items.length ? <SectionHeader title={t('common:nav.notifications')} /> : null}
          </View>
        }
        ListEmptyComponent={
          feed.isLoading ? (
            <Loading label={t('notifications.loading')} />
          ) : (
            <EmptyState
              icon="bell"
              title={t('notifications.emptyTitle')}
              description={t('notifications.emptyDescription')}
            />
          )
        }
        renderItem={({ item, index }) => (
          <Reveal index={index}>
            <NotificationRow
              item={item}
              first={index === 0}
              last={index === items.length - 1}
              onPress={() => open(item)}
            />
          </Reveal>
        )}
      />
    </Screen>
  );
}

interface NotificationRowProps {
  item: NotificationFeedItem;
  /** First and last rows round the grouped list's surface. */
  first: boolean;
  last: boolean;
  onPress: () => void;
}

/** The glyph for where a notification leads. */
const notificationIcon = (item: NotificationFeedItem): IconName => {
  if (item.operational_message_id) return 'mail';
  if (conversationNotificationTarget(item)) return 'chat';
  if (item.plan_id) return 'calendar';
  return 'bell';
};

const NotificationRow = ({ item, first, last, onPress }: NotificationRowProps) => {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const unread = !item.read_at;
  const { t } = useTranslation('scheduling');
  const f = useFormatters();

  return (
    <PressableScale
      // Title and body are stored server-side in the recipient's language; shown as-is.
      accessibilityLabel={unread ? t('notifications.unreadItem', { title: item.title }) : item.title}
      onPress={onPress}
      pressedOpacity={0.6}
      style={[styles.groupRow, first && styles.groupFirst, last && styles.groupLast]}
    >
      <View style={[styles.row, !first && styles.rowDivided]}>
        <IconWell name={notificationIcon(item)} accent={unread ? theme.accent.blue : theme.accent.neutral} size={36} />
        <View style={styles.body}>
          <Text style={[styles.title, unread ? styles.titleUnread : null]}>{item.title}</Text>
          {item.body ? <Text style={styles.detail}>{item.body}</Text> : null}
          <Text style={[styles.time, unread ? styles.timeUnread : null]}>{f.dateTime(item.created_at)}</Text>
        </View>
        {/* Unread marker: a brand dot at the trailing edge. */}
        <View style={[styles.dot, unread ? styles.dotUnread : null]} />
      </View>
    </PressableScale>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    list: { gap: 0 },
    header: { gap: theme.space.lg, marginBottom: theme.space.md },
    pushHint: {
      gap: theme.space.md,
      padding: theme.space.md,
      borderRadius: theme.radius.md,
      backgroundColor: theme.accent.yellow.bg,
    },
    pushHintRow: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.sm },
    pushHintText: { ...theme.type.bodySmall, color: theme.accent.yellow.fg, flex: 1 },
    groupRow: {
      backgroundColor: theme.color.surface,
      borderLeftWidth: 1,
      borderRightWidth: 1,
      borderColor: theme.color.border,
      paddingHorizontal: theme.space.md,
    },
    groupFirst: {
      borderTopWidth: 1,
      borderTopLeftRadius: theme.radius.lg + 2,
      borderTopRightRadius: theme.radius.lg + 2,
    },
    groupLast: {
      borderBottomWidth: 1,
      borderBottomLeftRadius: theme.radius.lg + 2,
      borderBottomRightRadius: theme.radius.lg + 2,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.space.md,
      paddingVertical: theme.space.md,
    },
    rowDivided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.color.border },
    dot: {
      width: 8,
      height: 8,
      borderRadius: theme.radius.pill,
      marginTop: 6,
      backgroundColor: 'transparent',
    },
    dotUnread: { backgroundColor: theme.color.brand },
    body: { flex: 1, gap: 2 },
    title: { ...theme.type.body, color: theme.color.inkMuted },
    titleUnread: { color: theme.color.ink, fontWeight: '600' },
    detail: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    time: { ...theme.type.label, fontSize: 12, color: theme.color.inkFaint, marginTop: 2 },
    timeUnread: { color: theme.color.brandText },
  });
