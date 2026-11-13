import { useMemo, useState, type ReactElement } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  chatStartableTeams,
  CONVERSATION_LIST_POLL_MS,
} from '@service-center/shared';
import { api } from '../lib/api';
import { queryKeys } from '../lib/query-keys';
import { useAuth } from '../providers/AuthProvider';
import { Card, Chip, EmptyState, ErrorNotice, IconWell, ListRow, Loading, SectionHeader, Tag, screenPadding } from './ui';
import { useFormatters } from '../i18n';
import { conversationTitle } from '../lib/conversation-labels';
import { type Theme } from '../lib/theme';
import { useTheme, useThemedStyles } from '../lib/useTheme';

export interface ChatListProps {
  /** Shown above the list's own header, e.g. the Messages tab's title and switch. */
  header?: ReactElement;
}

/**
 * MOB-019: the website's Chat list — team and plan conversations the server
 * says this person currently belongs to (`conversations`, polled like the
 * website), with unread counts, mute and open reports. Opening a team chat
 * uses `openConversation`; the server decides who may.
 */
export function ChatList({ header }: ChatListProps) {
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
    <FlatList
      data={conversations.data ?? []}
      keyExtractor={(conversation) => conversation.id}
      contentContainerStyle={[screenPadding(theme), styles.list]}
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
          {header}
          <Text style={styles.muted}>{t('chatPage.subtitle')}</Text>
          <Card compact style={styles.entryCard}>
            <ListRow
              onPress={() => setChoosing((value) => !value)}
              showChevron
              leading={<IconWell name="plus" accent={theme.accent.blue} size={36} />}
            >
              <Text style={styles.entryTitle}>{t('mobileChat.openTeamChat')}</Text>
            </ListRow>
            {choosing ? (
              <View style={styles.choices}>
                {teams.isLoading ? (
                  <Loading />
                ) : startable.length === 0 ? (
                  <Text style={styles.muted}>{t('mobileChat.noTeams')}</Text>
                ) : (
                  <View style={styles.chips}>
                    {startable.map((team) => (
                      <Chip key={team.id} label={team.name} active={false} onPress={() => open.mutate(team.id)} />
                    ))}
                  </View>
                )}
              </View>
            ) : null}
          </Card>
          <ErrorNotice error={open.error ?? conversations.error} />
          {conversations.data?.length ? (
            <SectionHeader title={t('common:nav.chat')} count={conversations.data.length} />
          ) : null}
        </View>
      }
      ListEmptyComponent={
        conversations.isLoading ? (
          <Loading />
        ) : conversations.error ? null : (
          <EmptyState icon="chat" title={t('chatPage.noConversations')} />
        )
      }
      renderItem={({ item, index }) => {
        const unread = item.unread_count > 0;
        const last = index === (conversations.data?.length ?? 0) - 1;
        return (
          <View style={[styles.groupRow, index === 0 && styles.groupFirst, last && styles.groupLast]}>
            <ListRow
              divided={index > 0}
              showChevron
              onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.id } })}
              leading={
                <IconWell
                  name={item.kind === 'plan' ? 'plans' : 'people'}
                  accent={unread ? theme.accent.blue : theme.accent.neutral}
                  size={40}
                />
              }
            >
              <View style={styles.row}>
                <Text style={[styles.title, unread && styles.unread]} numberOfLines={2}>
                  {conversationTitle(item, t, format)}
                </Text>
                {unread ? (
                  <View
                    style={styles.badge}
                    accessible
                    accessibilityLabel={t('chatPage.unread', { count: item.unread_count })}
                  >
                    <Text style={styles.badgeText} maxFontSizeMultiplier={1.4}>{item.unread_count}</Text>
                  </View>
                ) : null}
              </View>
              {item.last_message_at ? (
                <Text style={[styles.time, unread && styles.timeUnread]}>{format.dateTime(item.last_message_at)}</Text>
              ) : null}
              <View style={styles.tags}>
                <Tag label={t(`conversation.kinds.${item.kind}`)} accent={theme.accent.neutral} />
                {item.muted ? <Tag label={t('chatPage.muted')} accent={theme.accent.neutral} /> : null}
                {item.open_reports > 0 ? <Tag label={t('chatPage.reports', { count: item.open_reports })} accent={theme.accent.yellow} /> : null}
              </View>
            </ListRow>
          </View>
        );
      }}
    />
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    list: { gap: 0 },
    header: { gap: theme.space.lg, marginBottom: theme.space.md },
    entryCard: { paddingVertical: theme.space.xs },
    entryTitle: { ...theme.type.heading, color: theme.color.ink },
    choices: { paddingBottom: theme.space.md, gap: theme.space.sm },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
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
    row: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
    tags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space.xs, marginTop: theme.space.sm },
    title: { ...theme.type.heading, fontWeight: '500', color: theme.color.ink, flex: 1 },
    unread: { fontWeight: '700' },
    time: { ...theme.type.numeric, fontSize: 12.5, color: theme.color.inkFaint, marginTop: 2 },
    timeUnread: { color: theme.color.brandText, fontWeight: '600' },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    badge: {
      minWidth: 22,
      height: 22,
      paddingHorizontal: 6,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.color.brand,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: { ...theme.type.label, fontSize: 12, lineHeight: 16, color: theme.color.onBrand, fontWeight: '700' },
  });
