import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen } from '../../src/components/ui';
import { MessageList } from '../../src/components/MessageList';

/** `/messages`, kept for links and the composer; the Messages tab shows the same list. */
export default function MessagesScreen() {
  const { t } = useTranslation('messages');
  return (
    <Screen>
      <Stack.Screen options={{ title: t('messagesPage.title') }} />
      <MessageList />
    </Screen>
  );
}
