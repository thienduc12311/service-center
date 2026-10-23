import { useState, type ReactNode } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  ApiError,
  formatDuration,
  formatFileSize,
  isPlayable,
  parseChordPro,
  rehearsalTempoAtRate,
  REHEARSAL_PLAYBACK_RATES,
  type RehearsalManifest,
  type RehearsalManifestItem,
  type RehearsalMaterial,
  type RehearsalTrack,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { REHEARSAL_SKIP_SECONDS } from '../../lib/rehearsal-player';
import {
  useRehearsalPlayer,
  type NativeRehearsalPlayerControls,
  type NativeRehearsalPlayerState,
  type RehearsalLocalSource,
} from '../../lib/useRehearsalPlayer';
import { Button, Card, Chip, Divider, KeyCap, Label, Tag, screenPadding } from '../ui';
import { ChordChart } from '../ChordChart';
import { useFormatters } from '../../i18n';
import type { Theme } from '../../lib/theme';
import { useTheme, useThemedStyles } from '../../lib/useTheme';

/** Why a file could not be opened, as a catalog key. */
type MaterialOpenError = 'mobileRehearse.fileUnavailable' | 'mobileRehearse.fileOpenFailed';

/**
 * Opens a material outside the app: a link in its own app/site, an upload in
 * the device's viewer/player through a fresh short-lived link (access is
 * rechecked by the API). Resolves to the error key, or null when opened.
 */
const openMaterial = async (material: RehearsalMaterial): Promise<MaterialOpenError | null> => {
  try {
    if (material.kind === 'link' && material.external_url) {
      await Linking.openURL(material.external_url);
      return null;
    }
    const result = await api.fileDownload(material.file_id, {
      version_id: material.version_id ?? undefined,
      disposition: 'inline',
    });
    await Linking.openURL(result.url);
    return null;
  } catch (cause) {
    return cause instanceof ApiError && (cause.status === 403 || cause.status === 404)
      ? 'mobileRehearse.fileUnavailable'
      : 'mobileRehearse.fileOpenFailed';
  }
};

/** The link's host, or null when it is not a parseable URL. */
const hostname = (url: string): string | null => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

const clock = (seconds: number): string => formatDuration(Math.max(0, Math.floor(seconds)));

export interface RehearsalViewProps {
  manifest: RehearsalManifest;
  /** MOB-025: verified offline files play without a request. */
  localSource?: RehearsalLocalSource;
  /** MOB-025: whether this exact material version is saved offline (shown as a tag). */
  savedOffline?: (material: RehearsalMaterial) => boolean;
  /** Notices shown under the plan title. */
  children?: ReactNode;
  /** MOB-025: the offline card, shown under the player. */
  afterPlayer?: ReactNode;
}

/**
 * F14 on native (MOB-024): the rehearsal manifest — plan order, the chart in
 * the service key and only the file versions this person may read — with one
 * in-app audio player that follows the plan order. Shared by the rehearse
 * screen and the offline library (MOB-025), so both play the same way.
 */
export const RehearsalView = ({ manifest, localSource, savedOffline, children, afterPlayer }: RehearsalViewProps) => {
  const { t } = useTranslation(['plans', 'common']);
  const styles = useThemedStyles(makeStyles);
  const [state, controls] = useRehearsalPlayer(manifest, localSource);
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>{manifest.plan_title}</Text>
      {children}
      <PlayerCard state={state} controls={controls} items={manifest.items} />
      {afterPlayer}
      {manifest.items
        .filter((item) => item.item_type !== 'header')
        .map((item) => (
          <RehearseItemCard
            key={item.item_id}
            item={item}
            track={state.tracks.find((candidate) => candidate.item_id === item.item_id) ?? null}
            current={state.track?.item_id === item.item_id}
            savedOffline={savedOffline}
            onPlay={() => {
              const at = state.tracks.findIndex((candidate) => candidate.item_id === item.item_id);
              if (at >= 0) controls.select(at);
            }}
            onChoose={(fileId) => controls.choose(item.item_id, fileId)}
          />
        ))}
      {manifest.plan_materials.length ? (
        <Card>
          <Label>{t('rehearse.wholePlan')}</Label>
          {manifest.plan_materials.map((material, index) => (
            <View key={material.file_id}>
              {index > 0 ? <Divider /> : null}
              <MaterialRow material={material} isTrack={false} chartKey={null} savedOffline={savedOffline?.(material) ?? false} />
            </View>
          ))}
        </Card>
      ) : null}
      {manifest.truncated ? <Text style={styles.muted}>{t('rehearse.truncated')}</Text> : null}
    </ScrollView>
  );
};

interface PlayerCardProps {
  state: NativeRehearsalPlayerState;
  controls: NativeRehearsalPlayerControls;
  items: RehearsalManifestItem[];
}

/** The one player for the plan: transport, position, and what the current stop can do here. */
const PlayerCard = ({ state, controls, items }: PlayerCardProps) => {
  const { t } = useTranslation(['plans', 'common', 'media']);
  const format = useFormatters();
  const styles = useThemedStyles(makeStyles);
  const { track, status, mode } = state;
  const [openError, setOpenError] = useState<MaterialOpenError | null>(null);
  const [opening, setOpening] = useState(false);
  if (!state.tracks.length) {
    return (
      <Card>
        <Label>{t('rehearse.player')}</Label>
        <Text style={styles.muted}>{t('rehearse.noTracks')}</Text>
      </Card>
    );
  }
  const item = track ? items.find((candidate) => candidate.item_id === track.item_id) : null;
  const chartKey = item?.chart?.key;
  const audio = mode === 'audio';
  const tempoAtRate = state.rate === 1 ? null : rehearsalTempoAtRate(item?.tempo_bpm ?? null, state.rate);
  const playing = status === 'playing';
  const openHere = async (material: RehearsalMaterial) => {
    setOpenError(null);
    setOpening(true);
    setOpenError(await openMaterial(material));
    setOpening(false);
  };
  const externalHost = track?.material.external_url ? hostname(track.material.external_url) : null;

  return (
    <Card>
      <View style={styles.row}>
        <Label>{t('rehearse.player')}</Label>
        <Text style={[styles.muted, styles.end]}>{t('rehearse.tracks', { count: state.tracks.length })}</Text>
      </View>
      <View accessibilityLiveRegion="polite">
        <Text style={styles.itemTitle}>
          {track ? t('rehearse.trackTitle', { number: state.index + 1, title: track.title }) : t('rehearse.chooseTrack')}
        </Text>
        {track ? (
          <Text style={styles.muted}>
            {[
              track.material.title,
              ...(track.material.version_number ? [t('rehearse.version', { number: track.material.version_number })] : []),
              ...(track.material.pinned ? [t('rehearse.pinnedForPlan')] : []),
              ...(chartKey && track.material.playback === 'audio' ? [t('rehearse.chartKeyNote', { key: chartKey })] : []),
            ].join(' · ')}
          </Text>
        ) : null}
      </View>

      {audio ? (
        <ProgressBar
          position={state.position}
          duration={state.duration}
          onSeek={controls.seek}
          onSkip={controls.skip}
        />
      ) : null}

      <View style={styles.transport}>
        <Button variant="secondary" title="⏮" accessibilityLabel={t('rehearse.previousTrack')} onPress={controls.previous} />
        {audio ? (
          <Button
            variant="secondary"
            title={t('mobileRehearse.player.back', { seconds: REHEARSAL_SKIP_SECONDS })}
            accessibilityLabel={t('mobileRehearse.player.backLabel', { seconds: REHEARSAL_SKIP_SECONDS })}
            onPress={() => controls.skip(-1)}
            disabled={!state.duration}
          />
        ) : null}
        <Button
          title={playing ? t('rehearse.pause') : t('rehearse.play')}
          onPress={controls.togglePlay}
          loading={status === 'loading'}
          disabled={!audio || status === 'loading'}
        />
        {audio ? (
          <Button
            variant="secondary"
            title={t('mobileRehearse.player.forward', { seconds: REHEARSAL_SKIP_SECONDS })}
            accessibilityLabel={t('mobileRehearse.player.forwardLabel', { seconds: REHEARSAL_SKIP_SECONDS })}
            onPress={() => controls.skip(1)}
            disabled={!state.duration}
          />
        ) : null}
        <Button variant="secondary" title="⏭" accessibilityLabel={t('rehearse.nextTrack')} onPress={controls.next} />
      </View>
      <View style={styles.chips}>
        <Chip label={t(`rehearse.repeat.${state.repeat}`)} active={state.repeat !== 'off'} toggle onPress={controls.cycleRepeat} />
      </View>
      {audio ? (
        <View style={styles.speed}>
          <Text style={styles.muted}>{t('rehearse.speed')}</Text>
          <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t('rehearse.speedLabel')}>
            {REHEARSAL_PLAYBACK_RATES.map((rate) => (
              <Chip
                key={rate}
                label={t('rehearse.speedOption', { rate: format.number(rate) })}
                active={state.rate === rate}
                onPress={() => controls.setRate(rate)}
              />
            ))}
          </View>
          {state.rate !== 1 ? (
            <Text style={styles.muted}>
              {[...(tempoAtRate ? [t('rehearse.speedTempo', { bpm: tempoAtRate })] : []), t('rehearse.speedNote')].join(' · ')}
            </Text>
          ) : null}
        </View>
      ) : null}

      {track && mode === 'external' && track.material.external_url ? (
        <View style={styles.notice}>
          <Text style={styles.body}>
            {t('mobileRehearse.player.externalTrack', { host: externalHost ?? t('rehearse.anotherSite') })}
          </Text>
          <Button variant="secondary" title={t('rehearse.openExternal')} loading={opening} onPress={() => void openHere(track.material)} />
        </View>
      ) : null}
      {track && mode === 'device_player' ? (
        <View style={styles.notice}>
          <Text style={styles.body}>{t('mobileRehearse.player.videoTrack')}</Text>
          <Button variant="secondary" title={t('mobileRehearse.player.openVideo')} loading={opening} onPress={() => void openHere(track.material)} />
        </View>
      ) : null}
      {track && mode === 'unsupported' ? (
        <View style={styles.notice}>
          <Text style={styles.body}>
            {t('mobileRehearse.player.unsupported', { type: track.material.mime_type ?? t('mobileRehearse.player.unknownType') })}
          </Text>
          <Button variant="secondary" title={t('mobileRehearse.player.openInDevice')} loading={opening} onPress={() => void openHere(track.material)} />
        </View>
      ) : null}
      {openError ? <Text style={styles.error}>{t(openError)}</Text> : null}
      {state.failure ? (
        <View style={styles.notice} accessibilityRole="alert">
          <Text style={styles.error}>{t(state.failure)}</Text>
          <Button variant="secondary" title={t('common:actions.retry')} onPress={controls.retry} />
        </View>
      ) : null}
      <Text style={styles.muted}>{t('mobileRehearse.player.backgroundNote', { seconds: REHEARSAL_SKIP_SECONDS })}</Text>
    </Card>
  );
};

interface ProgressBarProps {
  position: number;
  duration: number;
  onSeek: (seconds: number) => void;
  onSkip: (direction: 1 | -1) => void;
}

/** Position within the track: tap to seek; screen readers adjust it in skip steps. */
const ProgressBar = ({ position, duration, onSeek, onSkip }: ProgressBarProps) => {
  const { t } = useTranslation('plans');
  const styles = useThemedStyles(makeStyles);
  const [width, setWidth] = useState(0);
  const fraction = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
  const valueText = t('rehearse.seekValue', { position: clock(position), duration: clock(duration) });
  return (
    <View style={styles.progress}>
      <Pressable
        accessibilityRole="adjustable"
        accessibilityLabel={t('rehearse.seek')}
        accessibilityValue={{ text: valueText }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => onSkip(event.nativeEvent.actionName === 'increment' ? 1 : -1)}
        disabled={!duration}
        onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
        onPress={(event) => {
          if (width > 0 && duration > 0) onSeek((event.nativeEvent.locationX / width) * duration);
        }}
        hitSlop={{ top: 12, bottom: 12 }}
        style={styles.track}
      >
        <View style={[styles.fill, { width: `${fraction * 100}%` }]} />
      </Pressable>
      <View style={styles.row}>
        <Text style={styles.muted}>{clock(position)}</Text>
        <Text style={[styles.muted, styles.end]}>{clock(duration)}</Text>
      </View>
    </View>
  );
};

interface RehearseItemCardProps {
  item: RehearsalManifestItem;
  /** This item's stop in the player, if it has a playable material. */
  track: RehearsalTrack | null;
  current: boolean;
  savedOffline?: (material: RehearsalMaterial) => boolean;
  onPlay: () => void;
  onChoose: (fileId: string) => void;
}

const RehearseItemCard = ({ item, track, current, savedOffline, onPlay, onChoose }: RehearseItemCardProps) => {
  const { t } = useTranslation(['plans', 'common']);
  const styles = useThemedStyles(makeStyles);
  const theme = useTheme();
  const [showChart, setShowChart] = useState(false);
  const chart = item.chart;
  const playable = item.materials.filter(isPlayable);
  return (
    <Card style={current ? styles.current : undefined}>
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
      {current ? <Tag label={t('mobileRehearse.player.nowPlaying')} accent={theme.accent.green} /> : null}
      {item.media ? <Tag label={t(item.media.archived ? 'rehearse.mediaArchived' : 'rehearse.media', { title: item.media.title })} accent={theme.accent.blue} /> : null}
      {track ? (
        <Button
          variant={current ? 'primary' : 'secondary'}
          title={current ? t('rehearse.restart') : t('rehearse.play')}
          accessibilityLabel={t('rehearse.playItem', { title: item.title })}
          onPress={onPlay}
        />
      ) : item.item_type === 'song' || item.media ? (
        <Text style={styles.muted}>{t('rehearse.noRecording')}</Text>
      ) : null}
      {playable.length > 1 ? (
        <View>
          <Label>{t('rehearse.recording')}</Label>
          <View style={styles.chips}>
            {playable.map((material) => (
              <Chip
                key={material.file_id}
                label={t('rehearse.recordingOption', { title: material.title, playback: t(`playback.${material.playback}`) })}
                active={track?.material.file_id === material.file_id}
                onPress={() => onChoose(material.file_id)}
              />
            ))}
          </View>
        </View>
      ) : null}
      {chart && chart.sequence.length ? (
        <Text style={styles.muted}>
          {t(chart.sequence_from_plan ? 'rehearse.sequenceForPlan' : 'rehearse.sequence', { sequence: chart.sequence.join(' · ') })}
        </Text>
      ) : null}
      {chart ? (
        chart.status === 'ready' && chart.chordpro ? (
          <>
            <Button variant="quiet" title={showChart ? t('mobileRehearse.hideChart') : chart.key ? t('mobileRehearse.showChartIn', { key: chart.key }) : t('mobileRehearse.showChartOwnKey')} onPress={() => setShowChart((v) => !v)} />
            {/* Already in the service key: rendered as given, never transposed again. */}
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
              <MaterialRow
                material={material}
                isTrack={material.file_id === item.track_file_id}
                chartKey={chart?.key ?? null}
                savedOffline={savedOffline?.(material) ?? false}
              />
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
  /** MOB-025: this exact version is in a complete offline pack. */
  savedOffline: boolean;
}

const MaterialRow = ({ material, isTrack, chartKey, savedOffline }: MaterialRowProps) => {
  const { t } = useTranslation(['plans', 'common']);
  const styles = useThemedStyles(makeStyles);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MaterialOpenError | null>(null);
  const open = async () => {
    setError(null);
    setBusy(true);
    setError(await openMaterial(material));
    setBusy(false);
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
              ...(material.newer_version_available ? [t('rehearse.newerVersion')] : []),
              ...(!external && !material.rights.download ? [t('mobileRehearse.playOnly')] : []),
              ...(savedOffline ? [t('mobileRehearse.offline.savedTag')] : []),
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
    content: { ...screenPadding(theme), gap: theme.space.lg, paddingBottom: theme.space.section },
    title: { ...theme.type.title, color: theme.color.ink },
    flex: { flex: 1 },
    end: { marginLeft: 'auto' },
    row: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    speed: { gap: theme.space.xs },
    transport: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space.sm },
    notice: { gap: theme.space.sm, padding: theme.space.md, borderRadius: theme.radius.md, backgroundColor: theme.color.surfaceInset },
    current: { borderColor: theme.color.brand, borderWidth: 2 },
    progress: { gap: theme.space.xs },
    track: { height: 8, borderRadius: 4, backgroundColor: theme.color.surfaceInset, overflow: 'hidden', justifyContent: 'center' },
    fill: { height: 8, backgroundColor: theme.color.brand },
    itemTitle: { ...theme.type.heading, color: theme.color.ink },
    body: { ...theme.type.body, color: theme.color.ink },
    material: { gap: theme.space.xs, paddingVertical: theme.space.sm },
    materialTitle: { ...theme.type.body, color: theme.color.ink },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    error: { ...theme.type.bodySmall, color: theme.color.danger },
  });
