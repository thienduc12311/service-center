import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Linking, ScrollView, Share, StyleSheet, Text } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { personalFeedState, type CalendarFeedTokenResponse } from '@service-center/shared';
import { api } from '../src/lib/api';
import { queryKeys } from '../src/lib/query-keys';
import { shareOutcome, type ShareOutcome } from '../src/lib/calendar-sharing';
import { useScreenVisible } from '../src/lib/useScreenVisible';
import { useAuth } from '../src/providers/AuthProvider';
import { Button, Card, ErrorNotice, Label, Loading, Meta, Screen, screenPadding } from '../src/components/ui';
import type { Theme } from '../src/lib/theme';
import { useTheme, useThemedStyles } from '../src/lib/useTheme';

/**
 * MOB-022: subscribe to my schedule in a calendar app, through the same
 * personal link as the website's Settings → Calendar sync
 * (`getCalendarFeed` / `rotateCalendarFeed`). The link is a bearer URL: the
 * server returns it only when it is created, so it lives only in this
 * screen's memory (never a query key, cache, log or storage) and is dropped
 * when the screen is left or the app goes to the background. Team and
 * service-type feeds are managed on the website.
 */
export default function CalendarSubscriptionScreen() {
  const { queryScope } = useAuth();
  const { t } = useTranslation(['scheduling', 'settings', 'common']);
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const queryClient = useQueryClient();
  const visible = useScreenVisible();
  const [revealed, setRevealed] = useState<CalendarFeedTokenResponse | null>(null);
  const [handoff, setHandoff] = useState<ShareOutcome | 'openFailed' | null>(null);

  // Status only (`active`), re-read whenever the screen is shown: another device may have replaced the link.
  const status = useQuery({
    queryKey: queryKeys.personalCalendarFeed(queryScope),
    queryFn: () => api.getCalendarFeed(),
    enabled: Boolean(queryScope) && visible,
    staleTime: 0,
  });

  const rotate = useMutation({
    mutationFn: () => api.rotateCalendarFeed(),
    // Keep the response out of the mutation cache once handed to screen state.
    gcTime: 0,
    onSuccess: async (result) => {
      setRevealed(result);
      setHandoff(null);
      rotate.reset();
      await queryClient.invalidateQueries({ queryKey: queryKeys.personalCalendarFeed(queryScope) });
    },
  });

  useEffect(() => {
    if (!visible) {
      setRevealed(null);
      setHandoff(null);
    }
  }, [visible]);

  const state = personalFeedState(status.data, revealed);

  const confirmRotate = () =>
    Alert.alert(t('mobileSubscription.rotateTitle'), t('mobileSubscription.rotateBody'), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('settings:settingsPage.calendar.rotate'), style: 'destructive', onPress: () => rotate.mutate() },
    ]);

  const openInCalendar = async () => {
    if (!revealed?.webcal_url) return;
    try {
      await Linking.openURL(revealed.webcal_url);
      setHandoff(null);
    } catch {
      // No app handles webcal:// on this device; sharing the link still works.
      setHandoff('openFailed');
    }
  };

  const shareLink = async () => {
    if (!revealed?.url) return;
    const result = await Share.share({ message: revealed.url, title: t('settings:settingsPage.calendar.title') });
    setHandoff(shareOutcome(result));
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={[screenPadding(theme), styles.content]}>
        <Text style={styles.body}>{t('settings:settingsPage.calendar.description')}</Text>

        <Card>
          <Label>{t('mobileSubscription.personalTitle')}</Label>
          {state === 'loading' ? (
            status.error ? null : <Loading />
          ) : state === 'none' ? (
            <>
              <Text style={styles.body}>{t('mobileSubscription.none')}</Text>
              <Button
                title={t('settings:settingsPage.calendar.create')}
                icon="calendar"
                loading={rotate.isPending}
                onPress={() => rotate.mutate()}
              />
            </>
          ) : state === 'active' ? (
            <>
              <Text style={styles.body}>{t('settings:settingsPage.calendar.activeHidden')}</Text>
              <Button
                title={t('settings:settingsPage.calendar.rotate')}
                variant="secondary"
                loading={rotate.isPending}
                onPress={confirmRotate}
              />
            </>
          ) : (
            <>
              <Text style={styles.body} accessibilityLiveRegion="polite">{t('mobileSubscription.revealed')}</Text>
              <Button title={t('settings:settingsPage.calendar.openInApp')} icon="calendar" onPress={() => void openInCalendar()} />
              <Button title={t('mobileSubscription.share')} variant="secondary" onPress={() => void shareLink()} />
              {handoff === 'openFailed' ? <Meta>{t('mobileSubscription.openFailed')}</Meta> : null}
              {handoff === 'cancelled' ? <Meta>{t('mobileSubscription.shareCancelled')}</Meta> : null}
              <Meta>{t('mobileSubscription.hiddenOnLeave')}</Meta>
            </>
          )}
          <ErrorNotice error={status.error ?? rotate.error} />
          {status.error ? <Button title={t('common:actions.retry')} variant="secondary" onPress={() => void status.refetch()} /> : null}
        </Card>

        <Card>
          <Label>{t('mobileSubscription.refreshTitle')}</Label>
          <Text style={styles.body}>{t('feeds.help')}</Text>
        </Card>

        <Card>
          <Label>{t('feeds.heading')}</Label>
          <Text style={styles.body}>{t('mobileSubscription.sharedFeedsOnWeb')}</Text>
        </Card>
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    content: { gap: theme.space.lg },
    body: { ...theme.type.body, color: theme.color.inkMuted },
  });
