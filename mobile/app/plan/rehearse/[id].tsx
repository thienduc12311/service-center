import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  LocalizedError,
  REHEARSAL_MANIFEST_TTL_SECONDS,
  formatDateTime,
} from '@service-center/shared';
import { api } from '../../../src/lib/api';
import { queryKeys } from '../../../src/lib/query-keys';
import { isRehearsalAccessLoss } from '../../../src/lib/rehearsal-player';
import { useOfflinePack } from '../../../src/lib/useOfflinePack';
import { useAuth } from '../../../src/providers/AuthProvider';
import { useLanguage } from '../../../src/i18n';
import { Card, ErrorNotice, Loading, Screen } from '../../../src/components/ui';
import { OfflinePackCard } from '../../../src/components/rehearsal/OfflinePackCard';
import { RehearsalView } from '../../../src/components/rehearsal/RehearsalView';
import type { Theme } from '../../../src/lib/theme';
import { useThemedStyles } from '../../../src/lib/useTheme';

const REHEARSAL_UNAVAILABLE = new LocalizedError({ key: 'plans:mobileRehearse.unavailable' });

/**
 * F14 on native (MOB-024): the same rehearsal manifest the web player uses,
 * with one in-app audio player in plan order. MOB-025: an explicit offline
 * pack for this person and organization — every fresh manifest rechecks it;
 * without a connection a complete, unexpired pack shows its saved order and
 * charts and plays its files from the device. Nothing here writes to the
 * server, online or offline.
 */
export default function RehearseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation(['plans', 'common']);
  const { formatLocale } = useLanguage();
  const { queryScope, generation, isCurrentGeneration } = useAuth();
  const styles = useThemedStyles(makeStyles);
  const manifest = useQuery({
    queryKey: queryKeys.rehearsal(queryScope, id),
    queryFn: () => api.rehearsalManifest(id!),
    enabled: Boolean(queryScope && id),
    staleTime: REHEARSAL_MANIFEST_TTL_SECONDS * 1000,
    refetchInterval: REHEARSAL_MANIFEST_TTL_SECONDS * 1000,
  });
  // Access lost on a refresh: drop what was loaded (the player stops too).
  const accessLost = isRehearsalAccessLoss(manifest.error);
  const data = accessLost ? undefined : manifest.data;
  const isCurrent = useCallback(() => isCurrentGeneration(generation), [isCurrentGeneration, generation]);
  const offline = useOfflinePack({
    planId: id,
    scope: queryScope,
    online: Boolean(queryScope),
    isCurrent,
    manifest: manifest.isSuccess && !manifest.isRefetchError ? manifest.data : undefined,
    manifestUpdatedAt: manifest.dataUpdatedAt,
    manifestError: manifest.error,
  });
  // Without a fresh manifest, only a complete pack inside its recheck window stands in.
  const offlineCopy =
    !data && !accessLost && offline.stored && (offline.summary.phase === 'ready' || offline.summary.phase === 'update_available')
      ? offline.stored
      : null;

  return (
    <Screen>
      <Stack.Screen options={{ title: t('rehearse.title') }} />
      {manifest.isLoading ? (
        <Loading label={t('rehearse.loading')} />
      ) : data ? (
        <RehearsalView
          manifest={data}
          localSource={offline.localUri}
          savedOffline={offline.isSaved}
          afterPlayer={<OfflinePackCard view={offline} manifest={data} />}
        >
          {manifest.error ? <Text style={styles.muted}>{t('mobileRehearse.refreshFailed')}</Text> : null}
        </RehearsalView>
      ) : offlineCopy ? (
        <RehearsalView
          manifest={offlineCopy.manifest}
          localSource={offline.localUri}
          savedOffline={offline.isSaved}
          afterPlayer={<OfflinePackCard view={offline} manifest={null} />}
        >
          <Card>
            <Text style={styles.body} accessibilityRole="alert">
              {t('mobileRehearse.offline.offlineBanner', { checked: formatDateTime(offlineCopy.checked_at, formatLocale) })}
            </Text>
          </Card>
        </RehearsalView>
      ) : (
        <View style={styles.pad}>
          <ErrorNotice error={accessLost ? REHEARSAL_UNAVAILABLE : (manifest.error ?? REHEARSAL_UNAVAILABLE)} />
          {!accessLost && offline.stored ? <OfflinePackCard view={offline} manifest={null} /> : null}
        </View>
      )}
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    pad: { padding: theme.space.xl, gap: theme.space.lg },
    body: { ...theme.type.body, color: theme.color.ink },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
  });
