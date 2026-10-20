import { useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ApiError,
  LocalizedError,
  REHEARSAL_MANIFEST_TTL_SECONDS,
  formatDuration,
  formatFileSize,
  parseChordPro,
  type RehearsalManifestItem,
  type RehearsalMaterial,
} from '@service-center/shared';
import { api } from '../../../src/lib/api';
import { queryKeys } from '../../../src/lib/query-keys';
import { useAuth } from '../../../src/providers/AuthProvider';
import { Button, Card, Divider, ErrorNotice, KeyCap, Label, Loading, Screen, Tag, screenPadding } from '../../../src/components/ui';
import { ChordChart } from '../../../src/components/ChordChart';
import type { Theme } from '../../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../../src/lib/useTheme';

const REHEARSAL_UNAVAILABLE = new LocalizedError({ key: 'plans:mobileRehearse.unavailable' });

/** Why a file could not be opened, as a catalog key. */
type MaterialOpenError = 'mobileRehearse.fileUnavailable' | 'mobileRehearse.fileOpenFailed';

/**
 * F14 on native: the same rehearsal manifest the web player uses — plan
 * order, the chart in the service key and only the file versions this
 * person may read now. This screen is read-only: a recording opens in the
 * device's own player through a fresh short-lived link (access rechecked);
 * in-app playback, background audio and offline packs are MOB-024/025.
 */
export default function RehearseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation(['plans', 'common']);
  const { queryScope } = useAuth();
  const styles = useThemedStyles(makeStyles);
  const manifest = useQuery({
    queryKey: queryKeys.rehearsal(queryScope, id),
    queryFn: () => api.rehearsalManifest(id!),
    enabled: Boolean(queryScope && id),
    staleTime: REHEARSAL_MANIFEST_TTL_SECONDS * 1000,
    refetchInterval: REHEARSAL_MANIFEST_TTL_SECONDS * 1000,
  });

  return (
    <Screen>
      <Stack.Screen options={{ title: t('rehearse.title') }} />
      {manifest.isLoading ? (
        <Loading label={t('rehearse.loading')} />
      ) : !manifest.data ? (
        <View style={styles.pad}>
          <ErrorNotice error={manifest.error ?? REHEARSAL_UNAVAILABLE} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>{manifest.data.plan_title}</Text>
          {manifest.error ? (
            <Text style={styles.muted}>{t('mobileRehearse.refreshFailed')}</Text>
          ) : null}
          {manifest.data.items
            .filter((item) => item.item_type !== 'header')
            .map((item) => (
              <RehearseItemCard key={item.item_id} item={item} />
            ))}
        </ScrollView>
      )}
    </Screen>
  );
}

interface RehearseItemCardProps {
  item: RehearsalManifestItem;
}

const RehearseItemCard = ({ item }: RehearseItemCardProps) => {
  const { t } = useTranslation(['plans', 'common']);
  const styles = useThemedStyles(makeStyles);
  const theme = useTheme();
  const [showChart, setShowChart] = useState(false);
  const chart = item.chart;
  return (
    <Card>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Text style={styles.itemTitle}>{item.title}</Text>
          <Text style={styles.muted}>
            {[item.arrangement?.name, item.tempo_bpm ? t('rehearse.bpm', { bpm: item.tempo_bpm }) : null, formatDuration(item.length_seconds)]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        {chart ? <KeyCap>{chart.key ?? '—'}</KeyCap> : null}
      </View>
      {item.media ? <Tag label={t(item.media.archived ? 'rehearse.mediaArchived' : 'rehearse.media', { title: item.media.title })} accent={theme.accent.blue} /> : null}
      {chart && chart.sequence.length ? (
        <Text style={styles.muted}>
          {t(chart.sequence_from_plan ? 'rehearse.sequenceForPlan' : 'rehearse.sequence', { sequence: chart.sequence.join(' · ') })}
        </Text>
      ) : null}
      {chart ? (
        chart.status === 'ready' && chart.chordpro ? (
          <>
            <Button variant="quiet" title={showChart ? t('mobileRehearse.hideChart') : chart.key ? t('mobileRehearse.showChartIn', { key: chart.key }) : t('mobileRehearse.showChartOwnKey')} onPress={() => setShowChart((v) => !v)} />
            {showChart ? <ChordChart chart={parseChordPro(chart.chordpro)} /> : null}
          </>
        ) : (
          <Text style={styles.muted}>
            {chart.status === 'arrangement_missing'
              ? t('mobileRehearse.arrangementMissing')
              : chart.status === 'no_chart'
                ? t('rehearse.noChart')
                : t('mobileRehearse.keyMissing')}
          </Text>
        )
      ) : null}
      {item.materials.length ? (
        <View>
          <Label>{t('mobileRehearse.materials')}</Label>
          {item.materials.map((material, index) => (
            <View key={material.file_id}>
              {index > 0 ? <Divider /> : null}
              <MaterialRow material={material} isTrack={material.file_id === item.track_file_id} chartKey={chart?.key ?? null} />
            </View>
          ))}
        </View>
      ) : item.item_type === 'song' || item.media ? (
        <Text style={styles.muted}>{t('mobileRehearse.noMaterials')}</Text>
      ) : null}
    </Card>
  );
};

interface MaterialRowProps {
  material: RehearsalMaterial;
  isTrack: boolean;
  chartKey: string | null;
}

const MaterialRow = ({ material, isTrack, chartKey }: MaterialRowProps) => {
  const { t } = useTranslation(['plans', 'common']);
  const styles = useThemedStyles(makeStyles);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MaterialOpenError | null>(null);
  const open = async () => {
    setError(null);
    if (material.kind === 'link' && material.external_url) {
      await Linking.openURL(material.external_url);
      return;
    }
    setBusy(true);
    try {
      const result = await api.fileDownload(material.file_id, {
        version_id: material.version_id ?? undefined,
        disposition: 'inline',
      });
      await Linking.openURL(result.url);
    } catch (cause) {
      setError(
        cause instanceof ApiError && (cause.status === 403 || cause.status === 404)
          ? 'mobileRehearse.fileUnavailable'
          : 'mobileRehearse.fileOpenFailed',
      );
    } finally {
      setBusy(false);
    }
  };
  const external = material.kind === 'link';
  return (
    <View style={styles.material}>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Text style={styles.materialTitle}>
            {isTrack ? `${material.title} · ${t('mobileRehearse.rehearsalTrack')}` : material.title}
          </Text>
          <Text style={styles.muted}>
            {[
              t(`playback.${material.playback}`),
              ...(material.version_number ? [t('rehearse.version', { number: material.version_number })] : []),
              ...(material.size_bytes ? [formatFileSize(material.size_bytes)] : []),
              ...(material.pinned ? [t('rehearse.pinned')] : []),
              ...(!external && !material.rights.download ? [t('mobileRehearse.playOnly')] : []),
            ].join(' · ')}
          </Text>
        </View>
        {material.kind === 'document' ? (
          <Text style={styles.muted}>{t('mobileRehearse.onTheWeb')}</Text>
        ) : (
          <Button variant="secondary" title={external ? t('mobileRehearse.openLink') : t('common:actions.open')} loading={busy} onPress={() => void open()} />
        )}
      </View>
      {external ? (
        <Text style={styles.muted}>{t('mobileRehearse.externalNote')}</Text>
      ) : material.playback === 'audio' && chartKey ? (
        <Text style={styles.muted}>{t('mobileRehearse.recordedKeyNote', { key: chartKey })}</Text>
      ) : null}
      {error ? <Text style={styles.error}>{t(error)}</Text> : null}
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    pad: { padding: theme.space.xl },
    content: { ...screenPadding(theme), gap: theme.space.lg, paddingBottom: theme.space.section },
    title: { ...theme.type.title, color: theme.color.ink },
    flex: { flex: 1 },
    row: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
    itemTitle: { ...theme.type.heading, color: theme.color.ink },
    material: { gap: theme.space.xs, paddingVertical: theme.space.sm },
    materialTitle: { ...theme.type.body, color: theme.color.ink },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    error: { ...theme.type.bodySmall, color: theme.color.danger },
  });
