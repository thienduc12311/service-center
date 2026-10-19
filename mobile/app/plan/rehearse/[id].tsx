import { useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  ApiError,
  REHEARSAL_MANIFEST_TTL_SECONDS,
  REHEARSAL_PLAYBACK_LABELS,
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

/**
 * F14 on native: the same rehearsal manifest the web player uses — plan
 * order, the chart in the service key and only the file versions this
 * person may read now. This screen is read-only: a recording opens in the
 * device's own player through a fresh short-lived link (access rechecked);
 * in-app playback, background audio and offline packs are MOB-024/025.
 */
export default function RehearseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
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
      <Stack.Screen options={{ title: 'Rehearse' }} />
      {manifest.isLoading ? (
        <Loading label="Loading rehearsal…" />
      ) : !manifest.data ? (
        <View style={styles.pad}>
          <ErrorNotice error={manifest.error ?? new Error('Rehearsal not available')} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>{manifest.data.plan_title}</Text>
          {manifest.error ? (
            <Text style={styles.muted}>Could not refresh — showing the list loaded earlier. Access is rechecked when you open a file.</Text>
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

const RehearseItemCard = ({ item }: { item: RehearsalManifestItem }) => {
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
            {[item.arrangement?.name, item.tempo_bpm ? `${item.tempo_bpm} bpm` : null, formatDuration(item.length_seconds)]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        {chart ? <KeyCap>{chart.key ?? '—'}</KeyCap> : null}
      </View>
      {item.media ? <Tag label={`Media: ${item.media.title}${item.media.archived ? ' (archived)' : ''}`} accent={theme.accent.blue} /> : null}
      {chart && chart.sequence.length ? (
        <Text style={styles.muted}>
          Sequence{chart.sequence_from_plan ? ' for this plan' : ''}: {chart.sequence.join(' · ')}
        </Text>
      ) : null}
      {chart ? (
        chart.status === 'ready' && chart.chordpro ? (
          <>
            <Button variant="quiet" title={showChart ? 'Hide chart' : `Show chart in ${chart.key ?? 'its key'}`} onPress={() => setShowChart((v) => !v)} />
            {showChart ? <ChordChart chart={parseChordPro(chart.chordpro)} /> : null}
          </>
        ) : (
          <Text style={styles.muted}>
            {chart.status === 'arrangement_missing'
              ? 'The arrangement chosen for this item is no longer available.'
              : chart.status === 'no_chart'
                ? 'No chord chart on this arrangement yet.'
                : "This chart's key is missing, so it can't be shown in the service key."}
          </Text>
        )
      ) : null}
      {item.materials.length ? (
        <View>
          <Label>Materials</Label>
          {item.materials.map((material, index) => (
            <View key={material.file_id}>
              {index > 0 ? <Divider /> : null}
              <MaterialRow material={material} isTrack={material.file_id === item.track_file_id} chartKey={chart?.key ?? null} />
            </View>
          ))}
        </View>
      ) : item.item_type === 'song' || item.media ? (
        <Text style={styles.muted}>No recordings or files you can open.</Text>
      ) : null}
    </Card>
  );
};

const MaterialRow = ({ material, isTrack, chartKey }: { material: RehearsalMaterial; isTrack: boolean; chartKey: string | null }) => {
  const styles = useThemedStyles(makeStyles);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
          ? 'This file is no longer available to you.'
          : 'The file could not be opened. Try again.',
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
            {material.title}
            {isTrack ? ' · rehearsal track' : ''}
          </Text>
          <Text style={styles.muted}>
            {REHEARSAL_PLAYBACK_LABELS[material.playback]}
            {material.version_number ? ` · v${material.version_number}` : ''}
            {material.size_bytes ? ` · ${formatFileSize(material.size_bytes)}` : ''}
            {material.pinned ? ' · pinned' : ''}
            {!external && !material.rights.download ? ' · play only' : ''}
          </Text>
        </View>
        {material.kind === 'document' ? (
          <Text style={styles.muted}>On the web</Text>
        ) : (
          <Button variant="secondary" title={external ? 'Open link' : 'Open'} loading={busy} onPress={() => void open()} />
        )}
      </View>
      {external ? (
        <Text style={styles.muted}>Opens in another app or site; Service Center does not host or license it.</Text>
      ) : material.playback === 'audio' && chartKey ? (
        <Text style={styles.muted}>Plays as recorded — its key is not changed to {chartKey}.</Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
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
