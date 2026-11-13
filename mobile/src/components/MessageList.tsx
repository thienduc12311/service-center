import { useState, type ReactElement } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { OperationalMessageSummary } from '@service-center/shared';
import { api } from '../lib/api';
import { queryKeys } from '../lib/query-keys';
import { useAuth } from '../providers/AuthProvider';
import { Button, EmptyState, ErrorNotice, IconWell, ListRow, Loading, SectionHeader, SegmentedControl, screenPadding } from './ui';
import { useFormatters } from '../i18n';
import { type Theme } from '../lib/theme';
import { useTheme, useThemedStyles } from '../lib/useTheme';

type MessageBox = 'sent' | 'received';

export interface MessageListProps {
  /** Shown above the list's own header, e.g. the Messages tab's title and switch. */
  header?: ReactElement;
}

/**
 * MOB-018: the website's Messages page — messages sent to me, and for
 * senders the messages they sent (administrators: everyone's), newest first.
 */
export function MessageList({ header }: MessageListProps) {
  const { t } = useTranslation(['messages', 'common']);
  const format = useFormatters();
  const { canAnywhere, queryScope } = useAuth();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const isSender = canAnywhere('scheduling.manage') || canAnywhere('teams.manage');
  const [box, setBox] = useState<MessageBox>(isSender ? 'sent' : 'received');

  const messages = useQuery({
    queryKey: queryKeys.messageList(queryScope, box),
    queryFn: () => api.listMessages({ box }),
    enabled: Boolean(queryScope),
  });

  const meta = (message: OperationalMessageSummary): string =>
    t('messagesPage.listMeta', {
      summary: message.sent_by_me
        ? t('messagesPage.recipients', { count: message.recipient_count })
        : message.sender_name
          ? t('messagesPage.from', { name: message.sender_name })
          : t('messagesPage.fromUnknown'),
      date: format.dateTime(message.created_at),
    });

  return (
    <FlatList
      data={messages.data ?? []}
      keyExtractor={(message) => message.id}
      contentContainerStyle={[screenPadding(theme), styles.list]}
      refreshControl={<RefreshControl refreshing={messages.isRefetching} onRefresh={() => void messages.refetch()} />}
      ListHeaderComponent={
        <View style={styles.header}>
          {header}
          <Text style={styles.muted}>{t('messagesPage.subtitle')}</Text>
          {isSender ? (
            <>
              <Button title={t('messagesPage.compose')} icon="plus" onPress={() => router.push('/messages/compose')} />
              <SegmentedControl
                options={[
                  { value: 'sent', label: t('messagesPage.tabs.sent') },
                  { value: 'received', label: t('messagesPage.tabs.received') },
                ]}
                value={box}
                onChange={setBox}
              />
            </>
          ) : null}
          {messages.error ? <ErrorNotice error={messages.error} /> : null}
          {messages.data?.length ? (
            <SectionHeader
              title={isSender ? t(`messagesPage.tabs.${box}`) : t('common:nav.messages')}
              count={messages.data.length}
            />
          ) : null}
        </View>
      }
      ListEmptyComponent={
        messages.isLoading ? (
          <Loading />
        ) : messages.error ? null : (
          <EmptyState
            icon="mail"
            title={box === 'sent' ? t('messagesPage.empty.sentTitle') : t('messagesPage.empty.receivedTitle')}
            description={box === 'sent' ? t('messagesPage.empty.sentDescription') : undefined}
          />
        )
      }
      renderItem={({ item, index }) => (
        <View
          style={[
            styles.groupRow,
            index === 0 && styles.groupFirst,
            index === (messages.data?.length ?? 0) - 1 && styles.groupLast,
          ]}
        >
          <ListRow
            divided={index > 0}
            showChevron
            onPress={() => router.push({ pathname: '/messages/[id]', params: { id: item.id } })}
            leading={<IconWell name="mail" accent={item.sent_by_me ? theme.accent.neutral : theme.accent.blue} size={40} />}
          >
            <Text style={styles.subject} numberOfLines={2}>{item.subject}</Text>
            <Text style={styles.muted}>{meta(item)}</Text>
          </ListRow>
        </View>
      )}
    />
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    list: { gap: 0 },
    header: { gap: theme.space.lg, marginBottom: theme.space.md },
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
    subject: { ...theme.type.heading, color: theme.color.ink, marginBottom: 2 },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
  });
