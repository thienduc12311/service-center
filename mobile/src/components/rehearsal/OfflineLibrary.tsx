import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { formatCivilDate, formatFileSize, type RehearsalTrack } from '@service-center/shared';
import { offlineEntryForTrack, summarizeOfflinePack, type StoredOfflinePack } from '../../lib/offline-packs';
import { listOfflinePacks, offlineEntryUri, subscribeOfflinePacks } from '../../lib/offline-pack-store';
import { deleteOfflinePacks, settled } from '../../lib/useOfflinePack';
import { useLanguage } from '../../i18n';
import { Button, Card, Divider, Label, Loading, screenPadding } from '../ui';
import { RehearsalView } from './RehearsalView';
import type { Theme } from '../../lib/theme';
import { useThemedStyles } from '../../lib/useTheme';

export interface OfflineLibraryProps {
  userId: string;
  /** The organization whose packs are listed (the active one, or the last one when offline). */
  organizationId: string | null;
  /**
   * `online`: rows open the plan's Rehearse screen (which rechecks the pack).
   * `offline`: the server can't be reached; a ready pack opens here from its saved manifest.
   */
  mode: 'online' | 'offline';
}

/**
 * MOB-025: offline packs on this phone for the signed-in person — size,
 * whether each is ready (complete and checked recently), and removal. Packs of
 * the person's other organizations are counted, not shown; another account's
 * packs are never listed (they are deleted at sign-in).
 */
export const OfflineLibrary = ({ userId, organizationId, mode }: OfflineLibraryProps) => {
  const { t } = useTranslation(['settings', 'common']);
  const { formatLocale } = useLanguage();
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const [packs, setPacks] = useState<StoredOfflinePack[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<StoredOfflinePack | null>(null);

  const load = useCallback(async () => {
    try {
      const all = await listOfflinePacks();
      setPacks(all.filter((pack) => pack.record.user_id === userId).map((pack) => settled(pack, pack.record.key) ?? pack));
      setFailed(false);
    } catch (cause) {
      console.warn('[offline] could not list offline packs', cause instanceof Error ? cause.message : 'unknown');
      setFailed(true);
    }
  }, [userId]);

  useEffect(() => {
    void load();
    return subscribeOfflinePacks(() => void load());
  }, [load]);

  const localSource = useCallback(
    (track: RehearsalTrack): string | null => {
      if (!open) return null;
      const entry = offlineEntryForTrack(open, track);
      return entry ? offlineEntryUri(open.record.key, entry) : null;
    },
    [open],
  );

  if (open) {
    return (
      <RehearsalView manifest={open.manifest} localSource={localSource} savedOffline={(material) => offlineEntryForTrack(open, { material }) !== null}>
        <Button variant="secondary" title={t('offlineDownloads.back')} onPress={() => setOpen(null)} />
      </RehearsalView>
    );
  }
  if (failed) return <Text style={[styles.muted, styles.pad]}>{t('offlineDownloads.loadFailed')}</Text>;
  if (!packs) return <Loading />;

  const mine = packs.filter((pack) => pack.record.organization_id === organizationId);
  const elsewhere = packs.length - mine.length;
  const confirmRemoveAll = () => {
    Alert.alert(t('offlineDownloads.removeAllTitle'), t('offlineDownloads.removeAllBody'), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      {
        text: t('offlineDownloads.removeAll'),
        style: 'destructive',
        onPress: () => void deleteOfflinePacks(packs.map((pack) => pack.record.key)),
      },
    ]);
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.body}>{t(mode === 'offline' ? 'offlineDownloads.offlineIntro' : 'offlineDownloads.intro')}</Text>
      {mine.length ? (
        <Card>
          {mine.map((pack, index) => {
            const summary = summarizeOfflinePack(pack, { newFileIds: [] });
            const playable = summary.phase === 'ready' || summary.phase === 'update_available';
            return (
              <View key={pack.record.key} style={styles.row}>
                {index > 0 ? <Divider /> : null}
                <Label>{pack.manifest.plan_title}</Label>
                <Text style={styles.muted}>
                  {[
                    pack.manifest.service_date ? formatCivilDate(pack.manifest.service_date, formatLocale) : null,
                    t('offlineDownloads.packRow', { count: summary.files, size: formatFileSize(summary.totalBytes) }),
                    t(`offlineDownloads.status.${summary.phase}`),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                <View style={styles.actions}>
                  {mode === 'online' ? (
                    <Button
                      variant="secondary"
                      title={t('offlineDownloads.open')}
                      onPress={() => router.push({ pathname: '/plan/rehearse/[id]', params: { id: pack.record.plan_id } })}
                    />
                  ) : playable ? (
                    <Button variant="secondary" title={t('offlineDownloads.open')} onPress={() => setOpen(pack)} />
                  ) : null}
                  <Button variant="quiet" title={t('offlineDownloads.remove')} onPress={() => void deleteOfflinePacks([pack.record.key])} />
                </View>
              </View>
            );
          })}
        </Card>
      ) : (
        <Text style={styles.muted}>{t('offlineDownloads.empty')}</Text>
      )}
      {elsewhere ? <Text style={styles.muted}>{t('offlineDownloads.otherOrganizations', { count: elsewhere })}</Text> : null}
      {packs.length ? <Button variant="secondary" title={t('offlineDownloads.removeAll')} onPress={confirmRemoveAll} /> : null}
    </ScrollView>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    content: { ...screenPadding(theme), gap: theme.space.lg, paddingBottom: theme.space.section },
    pad: { padding: theme.space.xl },
    row: { gap: theme.space.xs, paddingVertical: theme.space.sm },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    body: { ...theme.type.body, color: theme.color.ink },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
  });
