import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ChatList } from '../../src/components/ChatList';
import { MessageList } from '../../src/components/MessageList';
import { NotificationBell } from '../../src/components/NotificationBell';
import { Screen, ScreenHeader, SegmentedControl, type SegmentOption } from '../../src/components/ui';
import type { Theme } from '../../src/lib/theme';
import { useThemedStyles } from '../../src/lib/useTheme';

export type InboxView = 'chat' | 'messages';

/**
 * The Messages tab: team/plan Chat (MOB-019) and leader Messages (MOB-018)
 * behind one switch. Both lists are the same components the `/chat` and
 * `/messages` routes show, so links and notification taps keep working.
 */
export default function InboxScreen() {
  const { t } = useTranslation(['common', 'messages']);
  const styles = useThemedStyles(makeStyles);
  const [view, setView] = useState<InboxView>('chat');
  const views = useMemo<readonly SegmentOption<InboxView>[]>(
    () => [
      { value: 'chat', label: t('nav.chat') },
      { value: 'messages', label: t('nav.messages') },
    ],
    [t],
  );

  const header = (
    <View style={styles.header}>
      <ScreenHeader title={t('nav.messages')} description={t('messages:mobileInbox.description')} />
      <SegmentedControl options={views} value={view} onChange={setView} />
    </View>
  );

  return (
    <Screen safeTop>
      <NotificationBell />
      {view === 'chat' ? <ChatList header={header} /> : <MessageList header={header} />}
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    header: { gap: theme.space.md },
  });
