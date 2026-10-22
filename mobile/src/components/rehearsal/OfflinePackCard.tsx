import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatDateTime, formatFileSize, type RehearsalManifest } from '@service-center/shared';
import { offlinePackBudget, offlinePackEstimate } from '../../lib/offline-packs';
import type { OfflinePackView } from '../../lib/useOfflinePack';
import { useLanguage } from '../../i18n';
import { Button, Card, Label, Tag } from '../ui';
import type { Theme } from '../../lib/theme';
import { useTheme, useThemedStyles } from '../../lib/useTheme';

interface OfflinePackCardProps {
  view: OfflinePackView;
  /** The fresh manifest (online); null when offline, where nothing new can start. */
  manifest: RehearsalManifest | null;
}

/**
 * MOB-025: the explicit offline download for one plan — what would be kept
 * (and what is left out, with the reason), progress, and whether the copy is
 * ready, incomplete, out of date or expired. Only a complete pack is called
 * ready; storage use and the recall limit are stated.
 */
export const OfflinePackCard = ({ view, manifest }: OfflinePackCardProps) => {
  const { t } = useTranslation(['plans', 'common']);
  const { formatLocale } = useLanguage();
  const styles = useThemedStyles(makeStyles);
  const theme = useTheme();
  const { summary, stored, storage, notice } = view;
  const when = (value: string): string => formatDateTime(value, formatLocale);

  const estimate = useMemo(() => {
    if (!manifest || !storage) return null;
    const budget = offlinePackBudget({
      availableDiskBytes: storage.availableBytes,
      otherPacksBytes: storage.usedBytes - summary.downloadedBytes,
      thisPackBytes: summary.downloadedBytes,
    });
    return budget === null ? null : offlinePackEstimate(manifest, budget);
  }, [manifest, storage, summary.downloadedBytes]);

  const excluded = stored?.excluded ?? estimate?.excluded ?? [];
  const canStart = Boolean(manifest) && !view.active;

  return (
    <Card>
      <View style={styles.row}>
        <Label>{t('mobileRehearse.offline.title')}</Label>
        {summary.phase === 'ready' ? <Tag label={t('mobileRehearse.offline.readyTag')} accent={theme.accent.green} /> : null}
      </View>

      {summary.phase === 'none' ? (
        <>
          <Text style={styles.body}>{t('mobileRehearse.offline.intro')}</Text>
          {!manifest ? null : estimate === null ? (
            <Text style={styles.error}>{t('mobileRehearse.offline.noSpace')}</Text>
          ) : estimate.entries.length ? (
            <Button
              title={t('mobileRehearse.offline.download', {
                count: estimate.entries.length,
                size: formatFileSize(estimate.total_bytes),
              })}
              onPress={view.download}
              disabled={!canStart}
            />
          ) : (
            <Text style={styles.muted}>{t('mobileRehearse.offline.nothingToDownload')}</Text>
          )}
        </>
      ) : null}

      {summary.phase === 'downloading' ? (
        <View accessibilityLiveRegion="polite" style={styles.gap}>
          <Text style={styles.body}>
            {t('mobileRehearse.offline.downloading', {
              done: summary.completeFiles,
              count: summary.files,
              downloaded: formatFileSize(summary.downloadedBytes),
              total: formatFileSize(summary.totalBytes),
            })}
          </Text>
          <Progress fraction={summary.totalBytes ? summary.downloadedBytes / summary.totalBytes : 0} />
          <Button variant="secondary" title={t('mobileRehearse.offline.pause')} onPress={view.pause} />
        </View>
      ) : null}

      {summary.phase === 'incomplete' ? (
        <View style={styles.gap}>
          <Text style={styles.body}>
            {t('mobileRehearse.offline.incomplete', { done: summary.completeFiles, count: summary.files })}
          </Text>
          {stored?.stopped ? <Text style={styles.muted}>{t(`mobileRehearse.offline.stopped.${stored.stopped}`)}</Text> : null}
          <Progress fraction={summary.totalBytes ? summary.downloadedBytes / summary.totalBytes : 0} />
          {manifest ? <Button title={t('mobileRehearse.offline.resume')} onPress={view.download} disabled={!canStart} /> : null}
        </View>
      ) : null}

      {summary.phase === 'ready' || summary.phase === 'update_available' ? (
        <Text style={styles.body}>
          {t('mobileRehearse.offline.ready', { count: summary.files, size: formatFileSize(summary.totalBytes) })}
        </Text>
      ) : null}
      {summary.phase === 'update_available' ? (
        <View style={styles.gap}>
          <Text style={styles.body}>{t('mobileRehearse.offline.updateAvailable')}</Text>
          {manifest ? <Button title={t('mobileRehearse.offline.update')} onPress={view.download} disabled={!canStart} /> : null}
        </View>
      ) : null}
      {summary.phase === 'expired' && stored ? (
        <View style={styles.gap}>
          <Text style={styles.error}>{t('mobileRehearse.offline.expired', { recheckBy: when(stored.record.recheck_by) })}</Text>
          {manifest ? <Button title={t('mobileRehearse.offline.update')} onPress={view.download} disabled={!canStart} /> : null}
        </View>
      ) : null}
      {stored && summary.phase !== 'expired' ? (
        <Text style={styles.muted}>
          {t('mobileRehearse.offline.checked', { checked: when(stored.checked_at), recheckBy: when(stored.record.recheck_by) })}
        </Text>
      ) : null}

      {excluded.length ? (
        <View>
          <Label>{t('mobileRehearse.offline.excludedTitle')}</Label>
          {excluded.map((entry) => (
            <Text key={`${entry.file_id}:${entry.reason}`} style={styles.muted}>
              {t('mobileRehearse.offline.excludedRow', { title: entry.title, reason: t(`mobileRehearse.offline.excluded.${entry.reason}`) })}
            </Text>
          ))}
        </View>
      ) : null}

      {notice ? (
        <View accessibilityRole="alert">
          {notice.kind === 'removed' ? (
            <>
              {notice.revoked ? <Text style={styles.body}>{t('mobileRehearse.offline.removedRevoked', { count: notice.revoked })}</Text> : null}
              {notice.stale ? <Text style={styles.body}>{t('mobileRehearse.offline.removedStale', { count: notice.stale })}</Text> : null}
            </>
          ) : (
            <Text style={styles.error}>{t(`mobileRehearse.offline.notice.${notice.kind}`)}</Text>
          )}
        </View>
      ) : null}

      {stored ? <Button variant="quiet" title={t('mobileRehearse.offline.remove')} onPress={() => void view.remove()} /> : null}
      {storage ? (
        <Text style={styles.muted}>
          {t('mobileRehearse.offline.storage', {
            used: formatFileSize(storage.usedBytes),
            limit: formatFileSize(storage.limitBytes),
            free: formatFileSize(storage.availableBytes),
          })}
        </Text>
      ) : null}
      <Text style={styles.muted}>{t('mobileRehearse.offline.limits')}</Text>
    </Card>
  );
};

interface ProgressProps {
  /** 0–1 of the pack's bytes on the device. */
  fraction: number;
}

const Progress = ({ fraction }: ProgressProps) => {
  const styles = useThemedStyles(makeStyles);
  const clamped = Math.min(1, Math.max(0, fraction));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={styles.track}
    >
      <View style={[styles.fill, { width: `${clamped * 100}%` }]} />
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space.md },
    gap: { gap: theme.space.sm },
    track: { height: 8, borderRadius: 4, backgroundColor: theme.color.surfaceInset, overflow: 'hidden' },
    fill: { height: 8, backgroundColor: theme.color.brand },
    body: { ...theme.type.body, color: theme.color.ink },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    error: { ...theme.type.bodySmall, color: theme.color.danger },
  });
