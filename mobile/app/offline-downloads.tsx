import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { OfflineLibrary } from '../src/components/rehearsal/OfflineLibrary';
import { useAuth } from '../src/providers/AuthProvider';
import { Screen } from '../src/components/ui';

/** MOB-025: offline rehearsal packs on this phone for the signed-in person (MOB-021's cache controls). */
export default function OfflineDownloadsScreen() {
  const { t } = useTranslation('settings');
  const { session, organizationId } = useAuth();
  return (
    <Screen>
      <Stack.Screen options={{ title: t('offlineDownloads.screenTitle') }} />
      {session ? <OfflineLibrary userId={session.user.id} organizationId={organizationId} mode="online" /> : null}
    </Screen>
  );
}
