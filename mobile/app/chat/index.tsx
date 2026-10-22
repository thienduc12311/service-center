import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  chatStartableTeams,
  CONVERSATION_LIST_POLL_MS,
} from '@service-center/shared';
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
import { useAuth } from '../../src/providers/AuthProvider';
import { Chip, EmptyState, ErrorNotice, Label, ListRow, Loading, Screen, Tag, screenPadding } from '../../src/components/ui';
import { useFormatters } from '../../src/i18n';
import { conversationTitle } from '../../src/lib/conversation-labels';
import { type Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';

/**
 * MOB-019: the website's Chat list — team and plan conversations the server
 * says this person currently belongs to (`conversations`, polled like the
 * website), with unread counts, mute and open reports. Opening a team chat
 * uses `openConversation`; the server decides who may.
 */
export default function ChatListScreen() {
  const { t } = useTranslation(['messages', 'common']);
  const format = useFormatters();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { queryScope, user, can, generation, isCurrentGeneration } = useAuth();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [choosing, setChoosing] = useState(false);
  // Only a pull shows the spinner; background polls refresh silently.
  const [pulling, setPulling] = useState(false);

  const conversations = useQuery({
    queryKey: queryKeys.conversationList(queryScope),
    queryFn: () => api.conversations(),
    enabled: Boolean(queryScope),
    refetchInterval: CONVERSATION_LIST_POLL_MS,
  });
  const teams = useQuery({
    queryKey: queryKeys.teams(queryScope),
    queryFn: () => api.listTeams(),
    enabled: Boolean(queryScope),
  });
  const startable = useMemo(
    () =>
      chatStartableTeams(teams.data ?? [], user?.profile.id, (team) =>
        can('scheduling.manage', { teamId: team.id, serviceTypeId: team.service_type_id })
        || can('teams.manage', { teamId: team.id, serviceTypeId: team.service_type_id })),
    [can, teams.data, user?.profile.id],
  );

  const open = useMutation({
    mutationFn: (teamId: string) => api.openConversation({ kind: 'team', target_id: teamId }),
    onSuccess: async (conversation) => {
      if (!isCurrentGeneration(generation)) return;
      setChoosing(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.conversationsAll(queryScope) });
      router.push({ pathname: '/chat/[id]', params: { id: conversation.id } });
    },
  });

  return (
    <Screen>
      <Stack.Screen options={{ title: t('chatPage.title') }} />
      <FlatList
        data={conversations.data ?? []}
        keyExtractor={(conversation) => conversation.id}
        contentContainerStyle={screenPadding(theme)}
        refreshControl={
          <RefreshControl
            refreshing={pulling}
            onRefresh={async () => {
              setPulling(true);
              await conversations.refetch();
              if (isCurrentGeneration(generation)) setPulling(false);
            }}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.muted}>{t('chatPage.subtitle')}</Text>
            <ListRow onPress={() => setChoosing((value) => !value)} showChevron>
              <Label>{t('mobileChat.openTeamChat')}</Label>
            </ListRow>
            {choosing ? (
              teams.isLoading ? (
                <Loading />
              ) : startable.length === 0 ? (
                <Text style={styles.muted}>{t('mobileChat.noTeams')}</Text>
              ) : (
                <View style={styles.chips}>
                  {startable.map((team) => (
                    <Chip key={team.id} label={team.name} active={false} onPress={() => open.mutate(team.id)} />
                  ))}
                </View>
              )
            ) : null}
            <ErrorNotice error={open.error ?? conversations.error} />
          </View>
        }
        ListEmptyComponent={
          conversations.isLoading ? (
            <Loading />
          ) : conversations.error ? null : (
            <EmptyState title={t('chatPage.noConversations')} />
          )
        }
        renderItem={({ item, index }) => (
          <ListRow divided={index > 0} showChevron onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.id } })}>
            <View style={styles.row}>
              <Text style={[styles.title, item.unread_count > 0 && styles.unread]} numberOfLines={2}>
                {conversationTitle(item, t, format)}
              </Text>
              {item.unread_count > 0 ? (
                <View
                  style={styles.badge}
                  accessible
                  accessibilityLabel={t('chatPage.unread', { count: item.unread_count })}
                >
                  <Text style={styles.badgeText}>{item.unread_count}</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.tags}>
              <Tag label={t(`conversation.kinds.${item.kind}`)} accent={theme.accent.neutral} />
              {item.muted ? <Tag label={t('chatPage.muted')} accent={theme.accent.neutral} /> : null}
              {item.open_reports > 0 ? <Tag label={t('chatPage.reports', { count: item.open_reports })} accent={theme.accent.yellow} /> : null}
              {item.last_message_at ? <Text style={styles.muted}>{format.dateTime(item.last_message_at)}</Text> : null}
            </View>
          </ListRow>
        )}
      />
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    header: { gap: theme.space.md, marginBottom: theme.space.md },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    row: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
    tags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space.sm, marginTop: theme.space.xs },
    title: { ...theme.type.body, color: theme.color.ink, flex: 1 },
    unread: { fontWeight: '700' },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    badge: {
      minWidth: 24,
      paddingHorizontal: theme.space.xs,
      borderRadius: 12,
      backgroundColor: theme.color.brand,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: { ...theme.type.bodySmall, color: theme.color.onBrand, fontWeight: '700' },
  });
