import { useTranslation } from 'react-i18next';
import { Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConversationSummary, DeliveryChannel, ReminderPreferences, UpdateReminderPreferencesInput } from '@service-center/shared';
import { api } from '../src/lib/api';
import { queryKeys } from '../src/lib/query-keys';
import { conversationTitle } from '../src/lib/conversation-labels';
import {
  BADGE_PREFERENCES,
  REMINDER_CHANNELS,
  badgeSync,
  noReminderChannels,
  pushRemindersMissThisDevice,
  reminderPreferencesInput,
  type BadgePreference,
} from '../src/lib/notification-settings';
import { useAuth } from '../src/providers/AuthProvider';
import { useNotifications } from '../src/providers/NotificationsProvider';
import { useFormatters } from '../src/i18n';
import { Button, Card, ErrorNotice, Label, Loading, Meta, Screen, SegmentedControl, screenPadding } from '../src/components/ui';
import type { Theme } from '../src/lib/theme';
import { useThemedStyles } from '../src/lib/useTheme';

/**
 * MOB-020: notification settings. Four separate choices, each read back from
 * where it is enforced: OS permission (the device), the app-icon badge (this
 * device's push registration), reminder channels (F08 `myReminderPreferences`,
 * the website's "My reminders") and chat mute (F09 `muteConversation`, the
 * website's Mute button). Per-event-type and Live subscriptions have no shared
 * contract, so they are described, not offered. Mounted under the
 * session-generation Stack key, so switching organization remounts it.
 */
export default function NotificationSettingsScreen() {
  const { t } = useTranslation(['settings', 'messages', 'common']);
  const styles = useThemedStyles(makeStyles);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.body}>{t('mobileNotifications.description')}</Text>
        <DeviceSection />
        <BadgeSection />
        <ReminderSection />
        <ChatSection />
        <Card>
          <Label>{t('mobileNotifications.other.title')}</Label>
          <Text style={styles.body}>{t('mobileNotifications.other.description')}</Text>
        </Card>
      </ScrollView>
    </Screen>
  );
}

const DeviceSection = () => {
  const { t } = useTranslation('settings');
  const styles = useThemedStyles(makeStyles);
  const { push, pushEnabled, registering, registrationError, enablePush, retryRegistration, openDeviceSettings } = useNotifications();

  const status = (() => {
    if (push.state === 'unavailable') return t('mobileNotifications.device.unavailable');
    if (push.state === 'denied') return t('mobileNotifications.device.denied');
    if (push.state === 'undetermined') return t('mobileNotifications.device.undetermined');
    if (pushEnabled) return t('mobileNotifications.device.on');
    if (registering) return t('mobileNotifications.device.registering');
    return t('mobileNotifications.device.notRegistered');
  })();

  return (
    <Card>
      <Label>{t('mobileNotifications.device.title')}</Label>
      <Text style={styles.body} accessibilityLiveRegion="polite">{status}</Text>
      {push.recovery === 'request' ? (
        <Button title={t('mobileNotifications.device.turnOn')} loading={registering} onPress={() => void enablePush()} />
      ) : null}
      {push.recovery === 'openSettings' ? (
        <Button title={t('mobileNotifications.device.openSettings')} variant="secondary" onPress={() => void openDeviceSettings()} />
      ) : null}
      {push.state === 'granted' && !pushEnabled && !registering ? (
        <Button title={t('mobileNotifications.device.retry')} variant="secondary" onPress={() => void retryRegistration()} />
      ) : null}
      {push.state === 'granted' && !pushEnabled ? <ErrorNotice error={registrationError} /> : null}
      {/* The "unavailable" text already says so. */}
      {!pushEnabled && push.state !== 'unavailable' ? <Meta>{t('mobileNotifications.device.feedStillWorks')}</Meta> : null}
      <Meta>{t('mobileNotifications.device.lockScreen')}</Meta>
      <Meta>{t('mobileNotifications.device.signOut')}</Meta>
    </Card>
  );
};

const BadgeSection = () => {
  const { t } = useTranslation('settings');
  const styles = useThemedStyles(makeStyles);
  const { badgePreference, serverShowBadge, setBadgePreference, accountUnread, push, registering, retryRegistration } = useNotifications();
  const sync = badgeSync(badgePreference, serverShowBadge);
  const options = BADGE_PREFERENCES.map((value: BadgePreference) => ({ value, label: t(`mobileNotifications.badge.${value}`) }));

  return (
    <Card>
      <Label>{t('mobileNotifications.badge.title')}</Label>
      <Text style={styles.body}>{t('mobileNotifications.badge.description')}</Text>
      <SegmentedControl options={options} value={badgePreference} onChange={(value) => void setBadgePreference(value)} />
      {badgePreference === 'unread' ? <Meta>{t('mobileNotifications.badge.currentCount', { count: accountUnread })}</Meta> : null}
      <Meta>{t(`mobileNotifications.badge.${sync}`)}</Meta>
      {sync === 'pending' && !registering ? (
        <Button title={t('mobileNotifications.device.retry')} variant="quiet" onPress={() => void retryRegistration()} />
      ) : null}
      {Platform.OS === 'ios' && (push.state === 'denied' || push.state === 'undetermined') && badgePreference === 'unread' ? (
        <Meta>{t('mobileNotifications.badge.needsPermission')}</Meta>
      ) : null}
    </Card>
  );
};

const ReminderSection = () => {
  const { t } = useTranslation('settings');
  const styles = useThemedStyles(makeStyles);
  const queryClient = useQueryClient();
  const { queryScope, generation, isCurrentGeneration, user, organizationId } = useAuth();
  const { pushEnabled } = useNotifications();
  const organization = user?.memberships.find((membership) => membership.organization.id === organizationId)?.organization;

  const preferences = useQuery({
    queryKey: queryKeys.myReminderPreferences(queryScope),
    queryFn: () => api.myReminderPreferences(),
    enabled: Boolean(queryScope),
  });
  const save = useMutation({
    mutationFn: (input: UpdateReminderPreferencesInput) => api.updateMyReminderPreferences(input),
    onSuccess: (saved: ReminderPreferences) => {
      if (!isCurrentGeneration(generation)) return;
      queryClient.setQueryData(queryKeys.myReminderPreferences(queryScope), saved);
    },
  });

  // While a save is in flight the switch shows the requested value; afterwards
  // only what the server returned (a failure falls back to the saved state).
  const shown: ReminderPreferences | undefined = save.isPending && save.variables && preferences.data
    ? { ...preferences.data, ...save.variables }
    : preferences.data;

  return (
    <Card>
      <Label>{t('myReminders.title')}</Label>
      <Text style={styles.body}>{t('myReminders.description')}</Text>
      {organization ? <Meta>{t('mobileNotifications.reminders.organization', { organization: organization.name })}</Meta> : null}
      {preferences.isLoading ? <Loading /> : null}
      {shown ? (
        <View accessibilityLabel={t('myReminders.channels')}>
          {REMINDER_CHANNELS.map((channel: DeliveryChannel) => (
            <View key={channel} style={styles.switchRow}>
              <Text style={styles.body}>{t(`delivery.channel.${channel}`)}</Text>
              <Switch
                accessibilityLabel={t('mobileNotifications.reminders.toggle', { channel: t(`delivery.channel.${channel}`) })}
                value={shown[channel]}
                disabled={save.isPending}
                onValueChange={(on) => save.mutate(reminderPreferencesInput(shown, channel, on))}
              />
            </View>
          ))}
          {save.isPending ? <Meta>{t('mobileNotifications.reminders.saving')}</Meta> : null}
          {save.isSuccess ? <Meta>{t('settingsPage.saved')}</Meta> : null}
          {noReminderChannels(shown) ? <Text style={styles.warning}>{t('myReminders.none')}</Text> : null}
          {pushRemindersMissThisDevice(shown, pushEnabled) ? <Meta>{t('mobileNotifications.reminders.pushMissesDevice')}</Meta> : null}
        </View>
      ) : null}
      <ErrorNotice error={preferences.error ?? save.error} />
    </Card>
  );
};

const ChatSection = () => {
  const { t } = useTranslation(['settings', 'messages']);
  const { t: tMessages } = useTranslation('messages');
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const format = useFormatters();
  const queryClient = useQueryClient();
  const { queryScope, generation, isCurrentGeneration } = useAuth();

  // The chat list's own query: a mute here reads back in Chat and vice versa.
  const conversations = useQuery({
    queryKey: queryKeys.conversationList(queryScope),
    queryFn: () => api.conversations(),
    enabled: Boolean(queryScope),
  });
  const mute = useMutation({
    mutationFn: ({ id, muted }: MuteRequest) => api.muteConversation(id, muted),
    onSettled: async () => {
      if (!isCurrentGeneration(generation)) return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.conversationsAll(queryScope) });
    },
  });

  const shownMuted = (conversation: ConversationSummary): boolean =>
    mute.isPending && mute.variables?.id === conversation.id ? mute.variables.muted : conversation.muted;

  return (
    <Card>
      <Label>{t('mobileNotifications.chat.title')}</Label>
      <Text style={styles.body}>{t('mobileNotifications.chat.description')}</Text>
      {conversations.isLoading ? <Loading /> : null}
      {conversations.data && conversations.data.length === 0 ? (
        <Meta>{t('mobileNotifications.chat.empty')}</Meta>
      ) : null}
      {(conversations.data ?? []).map((conversation) => {
        const title = conversationTitle(conversation, tMessages, format);
        return (
          <View key={conversation.id} style={styles.switchRow}>
            <View style={styles.switchLabel}>
              <Text style={styles.body}>{title}</Text>
              {shownMuted(conversation) ? <Meta>{t('messages:chatPage.muted')}</Meta> : null}
            </View>
            <Switch
              accessibilityLabel={t('mobileNotifications.chat.toggle', { name: title })}
              value={shownMuted(conversation)}
              disabled={mute.isPending}
              onValueChange={(muted) => mute.mutate({ id: conversation.id, muted })}
            />
          </View>
        );
      })}
      <ErrorNotice error={conversations.error ?? mute.error} />
      <Button title={t('mobileNotifications.chat.open')} variant="quiet" onPress={() => router.push('/chat')} />
    </Card>
  );
};

interface MuteRequest {
  id: string;
  muted: boolean;
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    content: { ...screenPadding(theme), gap: theme.space.lg, paddingBottom: theme.space.xxl },
    body: { ...theme.type.body, color: theme.color.ink, flexShrink: 1 },
    warning: { ...theme.type.body, color: theme.accent.yellow.fg },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.space.md,
      minHeight: 44,
    },
    switchLabel: { flex: 1 },
  });
