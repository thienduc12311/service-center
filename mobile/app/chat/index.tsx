import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen } from '../../src/components/ui';
import { ChatList } from '../../src/components/ChatList';

/** `/chat`, kept for links and notification taps; the Messages tab shows the same list. */
export default function ChatListScreen() {
  const { t } = useTranslation('messages');
  return (
    <Screen>
      <Stack.Screen options={{ title: t('chatPage.title') }} />
      <ChatList />
    </Screen>
  );
}
