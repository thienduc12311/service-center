import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDateTime, type NotificationFeedItem } from '@service-center/shared';
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
import { Reveal } from '../src/components/motion';
import type { Theme } from '../src/lib/theme';
import { useTheme, useThemedStyles } from '../src/lib/useTheme';

const PAGE_SIZE = 30;

/** Everything the bell has collected, newest first. */
export default function NotificationsScreen() {
  const { organizationId } = useAuth();
  const { unread, refresh } = useNotifications();
  const router = useRouter();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const feed = useInfiniteQuery({
    queryKey: notificationKeys.feed(organizationId),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      api.listNotifications({ limit: PAGE_SIZE, before: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: Boolean(organizationId),
  });

  const invalidate = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: notificationKeys.all });
  }, [queryClient]);

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
    setRefreshing(false);
  }, [feed, refresh]);

  const open = (item: NotificationFeedItem): void => {
    if (!item.read_at) markRead.mutate([item.id]);
    if (item.plan_id) router.push(`/plan/${item.plan_id}`);
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
              eyebrow={unread ? `${unread} unread` : 'All caught up'}
              title="Notifications"
              description="Every time you're scheduled, reminded, or someone answers a request you sent."
              action={
                unread ? (
                  <Button
                    title="Mark all read"
                    variant="secondary"
                    onPress={() => markRead.mutate(undefined)}
                    loading={markRead.isPending}
                  />
                ) : undefined
              }
            />
            <ErrorNotice error={feed.error ?? markRead.error} />
          </View>
        }
        ListEmptyComponent={
          feed.isLoading ? (
            <Loading label="Loading notifications" />
          ) : (
            <EmptyState
              title="Nothing yet"
              description="When you're scheduled onto a plan it lands here, and on your phone if you've allowed notifications."
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

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      {/* The only marker of unread state: a dot in the left margin. */}
      <View style={[styles.dot, unread ? styles.dotUnread : null]} />
      <View style={styles.body}>
        <Text style={[styles.title, unread ? styles.titleUnread : null]}>{item.title}</Text>
        {item.body ? <Text style={styles.detail}>{item.body}</Text> : null}
        <Text style={styles.time}>{formatDateTime(item.created_at)}</Text>
      </View>
    </Pressable>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      gap: theme.space.md,
      paddingVertical: theme.space.lg,
    },
    rowPressed: { opacity: 0.6 },
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
