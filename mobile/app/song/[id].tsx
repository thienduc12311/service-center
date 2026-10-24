import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  canTransposeChartContext,
  parseChordPro,
  renderChartContext,
  resolveChartContext,
  uuid,
  type ChartContextUnavailableReason,
  type ChartNotation,
  type ChartRenderUnavailableReason,
  type PlanDetail,
  type PlanItemDetail,
  type SongWithArrangements,
  type TranslationKey,
} from '@service-center/shared';
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
import { arrangementSelections, canAuthorSong, draftTargets } from '../../src/lib/song-library';
import { useAuth } from '../../src/providers/AuthProvider';
import {
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  IconButton,
  KeyCap,
  Label,
  Loading,
  Screen,
  SegmentedControl,
  screenPadding,
  type SegmentOption,
} from '../../src/components/ui';
import { ArrangementPicker } from '../../src/components/ArrangementPicker';
import { ChordChart } from '../../src/components/ChordChart';
import { SongFiles } from '../../src/components/files/SongFiles';
import { SongDetails, SongManage, SongStatusNotices } from '../../src/components/song/SongManagement';
import { Reveal } from '../../src/components/motion';
import type { Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';

const NOTATION_ORDER: readonly ChartNotation[] = ['chords', 'numbers', 'numerals', 'lyrics'];

/** Catalog keys for the notation names, by value (replaces CHART_NOTATION_LABELS for display). */
const NOTATION_LABEL_KEYS: Readonly<Record<ChartNotation, TranslationKey<'songs'>>> = {
  chords: 'notation.chords',
  numbers: 'notation.numbers',
  numerals: 'notation.numerals',
  lyrics: 'notation.lyrics',
};

/** Route params as they arrive: untrusted, and possibly repeated. */
interface SongRouteParams {
  id?: string | string[];
  planId?: string | string[];
  itemId?: string | string[];
}

/** Where the chart was opened from, once the route params have been checked. */
type ChartRoute =
  | { kind: 'library'; songId: string }
  | { kind: 'plan'; songId: string; planId: string; itemId: string }
  | { kind: 'invalid' };

type ChartUnavailableReason = ChartContextUnavailableReason | 'invalid_link' | 'item_missing';

/** The catalog keys of an empty state's title and description. */
interface EmptyCopyKeys {
  title: TranslationKey<'songs'>;
  description: TranslationKey<'songs'>;
}

const UNAVAILABLE_COPY: Record<ChartUnavailableReason, EmptyCopyKeys> = {
  invalid_link: { title: 'mobileChart.unavailable.invalidLink.title', description: 'mobileChart.unavailable.invalidLink.description' },
  item_missing: { title: 'mobileChart.unavailable.itemMissing.title', description: 'mobileChart.unavailable.itemMissing.description' },
  not_a_song: { title: 'mobileChart.unavailable.notASong.title', description: 'mobileChart.unavailable.notASong.description' },
  song_mismatch: { title: 'mobileChart.unavailable.songMismatch.title', description: 'mobileChart.unavailable.songMismatch.description' },
  arrangement_missing: {
    title: 'mobileChart.unavailable.arrangementMissing.title',
    description: 'mobileChart.unavailable.arrangementMissing.description',
  },
};

const RENDER_COPY: Record<ChartRenderUnavailableReason, EmptyCopyKeys> = {
  no_chart: { title: 'mobileChart.render.noChart.title', description: 'mobileChart.render.noChart.description' },
  key_unknown: { title: 'mobileChart.render.keyUnknown.title', description: 'mobileChart.render.keyUnknown.description' },
};

const NO_ARRANGEMENTS_COPY: EmptyCopyKeys = {
  title: 'allArrangements.empty',
  description: 'mobileChart.noArrangementsDescription',
};

const single = (value: string | string[] | undefined): string | undefined =>
  typeof value === 'string' ? value : undefined;

/**
 * Accepts only well-formed ids, and a plan context only when both its plan and
 * item are present. Anything else is a broken or forged link, not the library.
 */
const parseChartRoute = (params: SongRouteParams): ChartRoute => {
  const songId = uuid.safeParse(single(params.id));
  if (!songId.success) return { kind: 'invalid' };

  const rawPlanId = single(params.planId);
  const rawItemId = single(params.itemId);
  if (rawPlanId === undefined && rawItemId === undefined) {
    return { kind: 'library', songId: songId.data };
  }
  const planId = uuid.safeParse(rawPlanId);
  const itemId = uuid.safeParse(rawItemId);
  if (!planId.success || !itemId.success) return { kind: 'invalid' };
  return { kind: 'plan', songId: songId.data, planId: planId.data, itemId: itemId.data };
};

export default function SongScreen() {
  const { t } = useTranslation('songs');
  const params: SongRouteParams = useLocalSearchParams();
  const route = parseChartRoute(params);
  const { organizationId, queryScope } = useAuth();
  const styles = useThemedStyles(makeStyles);

  const songId = route.kind === 'invalid' ? null : route.songId;
  const planId = route.kind === 'plan' ? route.planId : null;

  const song = useQuery({
    queryKey: queryKeys.song(queryScope, songId),
    queryFn: () => api.getSong(songId!),
    enabled: Boolean(songId && queryScope),
  });
  // The plan is re-read rather than trusted from the link, so an item id only
  // yields chart context when this person can see the plan it belongs to.
  const plan = useQuery({
    queryKey: queryKeys.plan(queryScope, planId),
    queryFn: () => api.getPlan(planId!),
    enabled: Boolean(planId && queryScope),
  });

  if (route.kind === 'invalid') return <Unavailable reason="invalid_link" />;

  if (song.isLoading || (route.kind === 'plan' && plan.isLoading)) {
    return (
      <Screen>
        <Loading label={t('mobileChart.opening')} />
      </Screen>
    );
  }
  const error = song.error ?? (route.kind === 'plan' ? plan.error : null);
  if (error) {
    return (
      <Screen>
        <View style={styles.errorWrap}>
          <ErrorNotice error={error} />
        </View>
      </Screen>
    );
  }
  if (!song.data || (route.kind === 'plan' && !plan.data)) return null;

  let planItem: PlanItemDetail | null = null;
  if (route.kind === 'plan') {
    planItem = plan.data?.items.find((candidate) => candidate.id === route.itemId) ?? null;
    if (!planItem) return <Unavailable reason="item_missing" />;
  }

  // Keyed by everything that defines the context, so transposition, notation
  // and a picked arrangement never carry over to another song, plan item or
  // organization.
  const contextKey = [organizationId, route.songId, planId ?? 'library', planItem?.id ?? ''].join(':');
  return (
    <ChartView
      key={contextKey}
      song={song.data}
      plan={route.kind === 'plan' ? (plan.data ?? null) : null}
      planItem={planItem}
    />
  );
}

interface UnavailableProps {
  reason: ChartUnavailableReason;
  title?: string;
}

const Unavailable = ({ reason, title }: UnavailableProps) => {
  const { t } = useTranslation('songs');
  const theme = useTheme();
  const copy = UNAVAILABLE_COPY[reason];
  return (
    <Screen>
      <Stack.Screen options={{ title: title ?? t('mobileChart.screenTitle') }} />
      <ScrollView contentContainerStyle={screenPadding(theme)}>
        <Card>
          <EmptyState title={t(copy.title)} description={t(copy.description)} />
        </Card>
      </ScrollView>
    </Screen>
  );
};

interface ChartViewProps {
  song: SongWithArrangements;
  plan: PlanDetail | null;
  planItem: PlanItemDetail | null;
}

/** Transposing on stage is a one-tap operation, so it stays a pair of steppers. */
const ChartView = ({ song, plan, planItem }: ChartViewProps) => {
  const { t } = useTranslation('songs');
  const notations: readonly SegmentOption<ChartNotation>[] = NOTATION_ORDER.map((value) => ({
    value,
    label: t(NOTATION_LABEL_KEYS[value]),
  }));
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [shift, setShift] = useState(0);
  const [notation, setNotation] = useState<ChartNotation>('chords');
  const [viewArrangementId, setViewArrangementId] = useState<string | null>(null);
  const { queryScope, canAnywhere } = useAuth();
  // MOB-028: library managers author the song from its library page (not from a plan's chart).
  const canAuthor = !planItem && canAuthorSong(canAnywhere('songs.manage'), song);

  // An editor that just saved or duplicated an arrangement asks to open on it.
  useFocusEffect(
    useCallback(() => {
      if (planItem) return;
      const target = draftTargets.song(song.id);
      const selected = arrangementSelections.get<string>(queryScope, target);
      if (!selected) return;
      arrangementSelections.clear(queryScope, target);
      setShift(0);
      setViewArrangementId(selected.draft);
    }, [planItem, queryScope, song.id]),
  );

  const context = useMemo(
    () => resolveChartContext({ song, planItem, viewArrangementId }),
    [song, planItem, viewArrangementId],
  );

  // The same renderer the API and the web app use, fed the effective key once,
  // so the chords and the key heading are one result.
  const rendered = useMemo(
    () => (context.status === 'ready' ? renderChartContext(context, { semitones: shift, notation }) : null),
    [context, shift, notation],
  );
  const chart = useMemo(
    () => (rendered?.status === 'ready' ? parseChordPro(rendered.chordpro) : null),
    [rendered],
  );

  if (context.status === 'unavailable') {
    return <Unavailable reason={context.reason} title={song.title} />;
  }

  const { arrangement, planArrangement } = context;
  const fromPlan = context.source === 'plan';
  const transposable = canTransposeChartContext(context);
  // Numbers, numerals and a lyric sheet carry no key, so transposing them is a no-op.
  const keyed = notation === 'chords';
  const canShift = keyed && transposable && rendered?.status === 'ready';

  const keyValue = !keyed
    ? t(NOTATION_LABEL_KEYS[notation])
    : rendered?.status === 'ready'
      ? (rendered.key ?? '—')
      : '—';
  const signedShift = `${shift > 0 ? '+' : ''}${shift}`;
  const keyNote = !keyed
    ? t('mobileChart.keyIndependent')
    : !transposable
      ? rendered?.status === 'ready'
        ? t('mobileChart.keyNotSet')
        : t('mobileChart.keyUnavailable')
      : shift !== 0
        ? t(fromPlan ? 'mobileChart.shiftFromService' : 'mobileChart.shiftFromOriginal', { count: shift, shift: signedShift })
        : context.keyFromPlan
          ? context.displayKey === context.sourceKey
            ? t('mobileChart.serviceKey')
            : t('mobileChart.serviceKeyWrittenIn', { key: context.sourceKey ?? '' })
          : t('mobileChart.originalKey');

  const meta = [
    arrangement?.name,
    arrangement?.bpm ? t('arrangement.bpmValue', { bpm: arrangement.bpm }) : null,
    arrangement?.meter ?? song.meter,
  ]
    .filter(Boolean)
    .join('  ·  ');

  const emptyCopy = arrangement
    ? RENDER_COPY[rendered?.status === 'unavailable' ? rendered.reason : 'no_chart']
    : NO_ARRANGEMENTS_COPY;

  const selectArrangement = (id: string) => {
    // Another version may be written in another key, so a shift made against
    // the previous one would no longer mean the same thing.
    setShift(0);
    setViewArrangementId(fromPlan && id === planArrangement?.id ? null : id);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: song.title }} />
      <ScrollView contentContainerStyle={screenPadding(theme)}>
        <Reveal>
          <View style={styles.hero}>
            {plan ? <Text style={styles.eyebrow}>{plan.title}</Text> : null}
            {song.author ? <Text style={styles.author}>{song.author}</Text> : null}
            <Text style={styles.title}>{song.title}</Text>
            {meta ? <Text style={styles.meta}>{meta}</Text> : null}
          </View>
        </Reveal>

        <SongStatusNotices song={song} arrangement={arrangement} />
        {canAuthor ? (
          <Reveal index={1}>
            <SongManage song={song} arrangement={arrangement} />
          </Reveal>
        ) : null}

        {song.arrangements.length > 1 ? (
          <Reveal index={1}>
            <Card>
              <Label>{fromPlan ? t('mobileChart.viewAnother') : t('mobileArrangements.label')}</Label>
              <ArrangementPicker
                arrangements={song.arrangements}
                selectedId={arrangement?.id ?? null}
                planArrangementId={planArrangement?.id ?? null}
                onSelect={selectArrangement}
              />
              {context.isTemporaryView ? (
                <View style={styles.notice}>
                  <Text style={styles.noticeText}>
                    {t('mobileChart.temporaryView', { viewing: arrangement?.name ?? '', planArrangement: planArrangement?.name ?? '' })}
                  </Text>
                  <Button
                    title={planArrangement?.name ? t('mobileChart.backTo', { name: planArrangement.name }) : t('mobileChart.backToPlanArrangement')}
                    variant="secondary"
                    onPress={() => {
                      setShift(0);
                      setViewArrangementId(null);
                    }}
                  />
                </View>
              ) : null}
            </Card>
          </Reveal>
        ) : null}

        <Reveal index={1}>
          <Card>
            <Label>{fromPlan ? t('mobileChart.serviceKey') : t('arrangement.fields.key')}</Label>
            <View style={styles.transposeRow}>
              <View style={styles.keyReadout}>
                <Text style={styles.keyValue}>{keyValue}</Text>
                <Text style={styles.keyShift}>{keyNote}</Text>
              </View>
              <IconButton
                name="minus"
                accessibilityLabel={t('mobileChart.transposeDown')}
                disabled={!canShift}
                onPress={() => setShift((current) => current - 1)}
              />
              <IconButton
                name="plus"
                accessibilityLabel={t('mobileChart.transposeUp')}
                disabled={!canShift}
                onPress={() => setShift((current) => current + 1)}
              />
              {keyed && shift !== 0 ? (
                <IconButton
                  name="close"
                  accessibilityLabel={fromPlan ? t('mobileChart.backToServiceKey') : t('mobileChart.backToOriginalKey')}
                  onPress={() => setShift(0)}
                />
              ) : null}
            </View>
          </Card>
        </Reveal>

        <Reveal index={2}>
          <Card>
            <Label>{t('mobileChart.notation')}</Label>
            <SegmentedControl options={notations} value={notation} onChange={setNotation} />
          </Card>
        </Reveal>

        {context.sequence.length ? (
          <Reveal index={2}>
            <Card>
              <Label>{t('arrangement.fields.sequence')}</Label>
              <View style={styles.sequence}>
                {context.sequence.map((part, index) => (
                  <KeyCap key={`${part}-${index}`}>{part}</KeyCap>
                ))}
              </View>
            </Card>
          </Reveal>
        ) : null}

        <Reveal index={3}>
          {chart ? (
            <ChordChart chart={chart} />
          ) : (
            <Card>
              <EmptyState title={t(emptyCopy.title)} description={t(emptyCopy.description)} />
            </Card>
          )}
        </Reveal>

        {!planItem ? (
          <Reveal index={4}>
            <SongDetails song={song} />
          </Reveal>
        ) : null}

        {/* MOB-026: the song's and this arrangement's files (F13), key-scoped ones labeled (F15). */}
        <Reveal index={4}>
          <SongFiles
            songId={song.id}
            songTitle={song.title}
            arrangementId={arrangement?.id ?? null}
            arrangementName={arrangement?.name ?? null}
          />
        </Reveal>
      </ScrollView>
    </Screen>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    errorWrap: { padding: theme.space.xl },
    hero: { gap: theme.space.sm },
    eyebrow: { ...theme.type.label, color: theme.color.brandText },
    author: { ...theme.type.label, color: theme.color.inkMuted },
    title: { ...theme.type.display, color: theme.color.ink },
    meta: { ...theme.type.bodySmall, color: theme.color.inkMuted },

    notice: { gap: theme.space.sm, marginTop: theme.space.md },
    noticeText: { ...theme.type.bodySmall, color: theme.color.inkMuted },

    transposeRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
    keyReadout: { flex: 1 },
    keyValue: { ...theme.type.display, fontSize: 32, lineHeight: 36, color: theme.color.ink },
    keyShift: { ...theme.type.bodySmall, color: theme.color.inkMuted },

    sequence: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
  });
