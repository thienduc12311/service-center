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
  Divider,
  EmptyState,
  ErrorNotice,
  Loading,
  Screen,
  ScreenHeader,
  screenPadding,
} from '../src/components/ui';
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
        contentContainerStyle={screenPadding(theme)}
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
          <View>
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
                <Text style={styles.pushHintText}>{t('settings:mobileNotifications.feedHint')}</Text>
                <Button
                  title={t('settings:mobileNotifications.feedHintAction')}
                  variant="quiet"
                  onPress={() => router.push('/notification-settings')}
                />
              </View>
            ) : null}
            <ErrorNotice error={feed.error ?? markRead.error} />
          </View>
        }
        ListEmptyComponent={
          feed.isLoading ? (
            <Loading label={t('notifications.loading')} />
          ) : (
            <EmptyState
              title={t('notifications.emptyTitle')}
              description={t('notifications.emptyDescription')}
            />
          )
        }
        renderItem={({ item, index }) => (
          <Reveal index={index}>
            <NotificationRow item={item} onPress={() => open(item)} />
          </Reveal>
        )}
        ItemSeparatorComponent={() => <Divider />}
      />
    </Screen>
  );
}

interface NotificationRowProps {
  item: NotificationFeedItem;
  onPress: () => void;
}

const NotificationRow = ({ item, onPress }: NotificationRowProps) => {
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
      style={styles.row}
    >
      {/* The only marker of unread state: a dot in the left margin. */}
      <View style={[styles.dot, unread ? styles.dotUnread : null]} />
      <View style={styles.body}>
        <Text style={[styles.title, unread ? styles.titleUnread : null]}>{item.title}</Text>
        {item.body ? <Text style={styles.detail}>{item.body}</Text> : null}
        <Text style={styles.time}>{f.dateTime(item.created_at)}</Text>
      </View>
    </PressableScale>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    pushHint: { gap: theme.space.xs, marginTop: theme.space.md },
    pushHintText: { color: theme.color.inkMuted, fontSize: 13, lineHeight: 18 },
    row: {
      flexDirection: 'row',
      gap: theme.space.md,
      paddingVertical: theme.space.lg,
    },
    dot: {
      width: 7,
      height: 7,
      borderRadius: theme.radius.pill,
      marginTop: 6,
      backgroundColor: 'transparent',
    },
    dotUnread: { backgroundColor: theme.accent.blue.fg },
    body: { flex: 1, gap: theme.space.xs },
    title: { ...theme.type.body, color: theme.color.inkMuted },
    titleUnread: { color: theme.color.ink },
    detail: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    time: { ...theme.type.label, color: theme.color.inkFaint },
  });
