import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  isDeliveryErrorCode,
  messageSendOutcome,
  type DeliveryStatus,
  type MessageChannelOutcome,
  type MessageRecipientOutcome,
} from '@service-center/shared';
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
import { useAuth } from '../../src/providers/AuthProvider';
import { Button, Card, Divider, EmptyState, ErrorNotice, Label, Loading, Screen, Tag, screenPadding } from '../../src/components/ui';
import { useFormatters } from '../../src/i18n';
import { type Accent, type Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';

/** Website badge tones (`MessagesPage`): only provider acceptance/delivery reads as good. */
const channelAccent = (theme: Theme, status: DeliveryStatus): Accent =>
  status === 'failed' ? theme.accent.red
    : status === 'ambiguous' ? theme.accent.yellow
      : status === 'provider_accepted' || status === 'delivered' ? theme.accent.green
        : theme.accent.neutral;

/**
 * MOB-018: one targeted message — the website's message detail. Senders and
 * administrators see each recipient's per-channel outcome and may retry the
 * failed or uncertain ones; a recipient sees their own rendered copy.
 */
export default function MessageDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation(['messages', 'common']);
  const format = useFormatters();
  const { queryScope, generation, isCurrentGeneration } = useAuth();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);

  const message = useQuery({
    queryKey: queryKeys.message(queryScope, id),
    queryFn: () => api.getMessage(id!),
    enabled: Boolean(id && queryScope),
    // Outcomes settle as each channel finishes; poll while any is still queued or sending.
    refetchInterval: (query) =>
      query.state.data?.outcomes?.some((o) => o.channels.some((c) => c.status === 'queued' || c.status === 'sending'))
        ? 5000
        : false,
  });

  // Retrying re-queues only failed or uncertain deliveries, so repeating it never resends a delivered one.
  const retry = useMutation({
    mutationFn: () => api.retryMessage(id!),
    onSettled: () =>
      isCurrentGeneration(generation)
        ? queryClient.invalidateQueries({ queryKey: queryKeys.messagesAll(queryScope) })
        : undefined,
  });

  const title = t('mobileMessages.detailTitle');
  if (!id) return null;
  if (message.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <Loading />
      </Screen>
    );
  }
  if (!message.data) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <EmptyState
          title={t('messageDetail.notAvailableTitle')}
          description={t('messageDetail.notAvailableDescription')}
          action={<Button title={t('common:actions.retry')} variant="secondary" onPress={() => void message.refetch()} />}
        />
      </Screen>
    );
  }

  const { message: row, sender_name, outcomes, can_retry, rendered_for_me } = message.data;
  const failed = (outcomes ?? []).filter((outcome) => outcome.retryable).length;
  const retryUncertain = retry.isError && messageSendOutcome(retry.error) === 'uncertain';

  return (
    <Screen>
      <Stack.Screen options={{ title }} />
      <ScrollView
        contentContainerStyle={screenPadding(theme)}
        refreshControl={<RefreshControl refreshing={message.isRefetching} onRefresh={() => void message.refetch()} />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>{rendered_for_me?.subject ?? row.subject}</Text>
          <Text style={styles.muted}>
            {sender_name
              ? t('messageDetail.fromLine', { name: sender_name, date: format.dateTime(row.created_at) })
              : t('messageDetail.fromLineUnknown', { date: format.dateTime(row.created_at) })}
          </Text>
        </View>
        <Card>
          <Text style={styles.body} selectable>{rendered_for_me?.body ?? row.body}</Text>
        </Card>
        {!rendered_for_me && /\{\{/.test(`${row.subject}${row.body}`) ? (
          <Text style={styles.muted}>{t('messageDetail.variablesNote')}</Text>
        ) : null}
        {message.error ? <ErrorNotice error={message.error} /> : null}

        {outcomes ? (
          <Card>
            <Label>
              {row.excluded_count
                ? t('messageDetail.recipientsHeadingWithExcluded', { included: row.recipient_count, excluded: row.excluded_count })
                : t('messageDetail.recipientsHeading', { included: row.recipient_count })}
            </Label>
            {can_retry ? (
              <Button
                title={t('messageDetail.retry', { count: failed })}
                variant="secondary"
                loading={retry.isPending}
                onPress={() => retry.mutate()}
              />
            ) : null}
            {retry.isSuccess ? (
              <Text accessibilityRole="alert" style={styles.body}>{t('messageDetail.requeued', { count: retry.data.requeued })}</Text>
            ) : null}
            {retryUncertain ? (
              <Text accessibilityRole="alert" style={styles.warning}>{t('mobileMessages.retryUncertain')}</Text>
            ) : retry.isError ? (
              <ErrorNotice error={retry.error} />
            ) : null}
            <Text style={styles.muted}>{t('messageDetail.simulatedNote')}</Text>
            <View>
              {outcomes.map((outcome, index) => (
                <View key={outcome.person_id}>
                  {index > 0 ? <Divider /> : null}
                  <OutcomeRow outcome={outcome} />
                </View>
              ))}
            </View>
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

interface OutcomeRowProps {
  outcome: MessageRecipientOutcome;
}

function OutcomeRow({ outcome }: OutcomeRowProps) {
  const { t } = useTranslation('messages');
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const errorText = (channel: MessageChannelOutcome): string | null =>
    channel.error_code
      ? isDeliveryErrorCode(channel.error_code) ? t(`delivery.errors.${channel.error_code}`) : channel.error_code
      : null;
  return (
    <View style={styles.outcome}>
      <Text style={[styles.body, styles.strong]}>{[outcome.first_name, outcome.last_name].filter(Boolean).join(' ')}</Text>
      <Text style={styles.muted}>{outcome.reasons.map((reason) => t(`audienceReasons.${reason}`)).join(' · ')}</Text>
      <View style={styles.tags}>
        {outcome.status === 'excluded_no_address' ? <Tag label={t('messageDetail.notSentNoAddress')} accent={theme.accent.neutral} /> : null}
        {outcome.status === 'excluded_by_sender' ? <Tag label={t('messageDetail.removedBeforeSending')} accent={theme.accent.neutral} /> : null}
        {outcome.channels.map((channel) => (
          <Tag
            key={channel.delivery_id}
            label={t('messageDetail.channelStatus', { channel: t(`delivery.channels.${channel.channel}`), status: t(`delivery.status.${channel.status}`) })}
            accent={channelAccent(theme, channel.status)}
          />
        ))}
      </View>
      {outcome.channels.map((channel) => {
        const text = errorText(channel);
        return text ? (
          <Text key={`${channel.delivery_id}-error`} style={styles.muted}>
            {t('messageDetail.channelStatus', { channel: t(`delivery.channels.${channel.channel}`), status: text })}
          </Text>
        ) : null;
      })}
    </View>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    header: { gap: theme.space.xs },
    title: { ...theme.type.title, color: theme.color.ink },
    body: { ...theme.type.body, color: theme.color.ink },
    strong: { fontWeight: '600' },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    warning: {
      ...theme.type.bodySmall,
      color: theme.accent.yellow.fg,
      backgroundColor: theme.accent.yellow.bg,
      padding: theme.space.sm,
      borderRadius: theme.radius.sm,
    },
    outcome: { gap: theme.space.xs, paddingVertical: theme.space.sm },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.xs },
  });
