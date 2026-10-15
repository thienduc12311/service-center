import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  CHART_NOTATION_LABELS,
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
} from '@service-center/shared';
import { api } from '../../src/lib/api';
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
import { Reveal } from '../../src/components/motion';
import type { Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';

const NOTATIONS: readonly SegmentOption<ChartNotation>[] = (
  ['chords', 'numbers', 'numerals', 'lyrics'] as const
).map((notation) => ({ value: notation, label: CHART_NOTATION_LABELS[notation] }));

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

const UNAVAILABLE_COPY: Record<ChartUnavailableReason, { title: string; description: string }> = {
  invalid_link: {
    title: 'This chart link isn’t valid',
    description: 'Open the song again from its plan or the song library.',
  },
  item_missing: {
    title: 'This item is no longer in the plan',
    description: 'It may have been removed or replaced. Open the plan again to see its current order.',
  },
  not_a_song: {
    title: 'This plan item isn’t a song',
    description: 'Open the plan again to see its current order.',
  },
  song_mismatch: {
    title: 'This plan item is a different song',
    description: 'The plan has changed since this link was opened. Open the plan again.',
  },
  arrangement_missing: {
    title: 'The plan’s arrangement isn’t available',
    description:
      'The arrangement chosen for this plan has been removed. A planner can choose another on the web.',
  },
};

const RENDER_COPY: Record<ChartRenderUnavailableReason, { title: string; description: string }> = {
  no_chart: { title: 'No chart yet', description: 'Add one from the web app to read it here.' },
  key_unknown: {
    title: 'Can’t change the key of this chart',
    description:
      'The chart’s written key or the service key can’t be read, so these chords would be wrong. Lyrics are still available; a planner can set the key on the web.',
  },
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
  const params: SongRouteParams = useLocalSearchParams();
  const route = parseChartRoute(params);
  const { organizationId } = useAuth();
  const styles = useThemedStyles(makeStyles);

  const songId = route.kind === 'invalid' ? null : route.songId;
  const planId = route.kind === 'plan' ? route.planId : null;

  const song = useQuery({
    queryKey: ['song', organizationId, songId],
    queryFn: () => api.getSong(songId!),
    enabled: Boolean(songId && organizationId),
  });
  // The plan is re-read rather than trusted from the link, so an item id only
  // yields chart context when this person can see the plan it belongs to.
  const plan = useQuery({
    queryKey: ['plan', organizationId, planId],
    queryFn: () => api.getPlan(planId!),
    enabled: Boolean(planId && organizationId),
  });

  if (route.kind === 'invalid') return <Unavailable reason="invalid_link" />;

  if (song.isLoading || (route.kind === 'plan' && plan.isLoading)) {
    return (
      <Screen>
        <Loading label="Opening the chart" />
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
  const theme = useTheme();
  const copy = UNAVAILABLE_COPY[reason];
  return (
    <Screen>
      <Stack.Screen options={{ title: title ?? 'Chart' }} />
      <ScrollView contentContainerStyle={screenPadding(theme)}>
        <Card>
          <EmptyState title={copy.title} description={copy.description} />
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
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [shift, setShift] = useState(0);
  const [notation, setNotation] = useState<ChartNotation>('chords');
  const [viewArrangementId, setViewArrangementId] = useState<string | null>(null);

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
    ? CHART_NOTATION_LABELS[notation]
    : rendered?.status === 'ready'
      ? (rendered.key ?? '—')
      : '—';
  const keyNote = !keyed
    ? 'Key-independent'
    : !transposable
      ? rendered?.status === 'ready'
        ? 'Key not set · shown as written'
        : 'Key unavailable'
      : shift !== 0
        ? `${shift > 0 ? '+' : ''}${shift} semitones from ${fromPlan ? 'the service key' : 'the original key'}`
        : context.keyFromPlan
          ? context.displayKey === context.sourceKey
            ? 'Service key'
            : `Service key · written in ${context.sourceKey}`
          : 'Original key';

  const meta = [
    arrangement?.name,
    arrangement?.bpm ? `${arrangement.bpm} bpm` : null,
    arrangement?.meter ?? song.meter,
  ]
    .filter(Boolean)
    .join('  ·  ');

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

        {song.arrangements.length > 1 ? (
          <Reveal index={1}>
            <Card>
              <Label>{fromPlan ? 'View another arrangement' : 'Arrangement'}</Label>
              <ArrangementPicker
                arrangements={song.arrangements}
                selectedId={arrangement?.id ?? null}
                planArrangementId={planArrangement?.id ?? null}
                onSelect={selectArrangement}
              />
              {context.isTemporaryView ? (
                <View style={styles.notice}>
                  <Text style={styles.noticeText}>
                    Viewing {arrangement?.name} for now. This plan uses {planArrangement?.name}; nothing
                    is saved. Planners change a plan’s arrangement on the web.
                  </Text>
                  <Button
                    title={`Back to ${planArrangement?.name ?? 'the plan’s arrangement'}`}
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
            <Label>{fromPlan ? 'Service key' : 'Key'}</Label>
            <View style={styles.transposeRow}>
              <View style={styles.keyReadout}>
                <Text style={styles.keyValue}>{keyValue}</Text>
                <Text style={styles.keyShift}>{keyNote}</Text>
              </View>
              <IconButton
                name="minus"
                accessibilityLabel="Transpose down a semitone"
                disabled={!canShift}
                onPress={() => setShift((current) => current - 1)}
              />
              <IconButton
                name="plus"
                accessibilityLabel="Transpose up a semitone"
                disabled={!canShift}
                onPress={() => setShift((current) => current + 1)}
              />
              {keyed && shift !== 0 ? (
                <IconButton
                  name="close"
                  accessibilityLabel={fromPlan ? 'Back to the service key' : 'Back to the original key'}
                  onPress={() => setShift(0)}
                />
              ) : null}
            </View>
          </Card>
        </Reveal>

        <Reveal index={2}>
          <Card>
            <Label>Notation</Label>
            <SegmentedControl options={NOTATIONS} value={notation} onChange={setNotation} />
          </Card>
        </Reveal>

        {context.sequence.length ? (
          <Reveal index={2}>
            <Card>
              <Label>Sequence</Label>
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
              <EmptyState
                {...(arrangement
                  ? RENDER_COPY[rendered?.status === 'unavailable' ? rendered.reason : 'no_chart']
                  : {
                      title: 'No arrangements yet',
                      description: 'Add an arrangement from the web app to read its chart here.',
                    })}
              />
            </Card>
          )}
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
