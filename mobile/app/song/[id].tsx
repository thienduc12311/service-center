import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  CHART_NOTATION_LABELS,
  parseChordPro,
  renderChordProChart,
  transposeKey,
  type ChartNotation,
} from '@service-center/shared';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/providers/AuthProvider';
import {
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
import { ChordChart } from '../../src/components/ChordChart';
import { Reveal } from '../../src/components/motion';
import type { Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';

const NOTATIONS: readonly SegmentOption<ChartNotation>[] = (
  ['chords', 'numbers', 'numerals', 'lyrics'] as const
).map((notation) => ({ value: notation, label: CHART_NOTATION_LABELS[notation] }));

/** Transposing on stage is a one-tap operation, so it stays a pair of steppers. */
export default function SongScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { organizationId } = useAuth();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [shift, setShift] = useState(0);
  const [notation, setNotation] = useState<ChartNotation>('chords');

  const song = useQuery({
    queryKey: ['song', organizationId, id],
    queryFn: () => api.getSong(id!),
    enabled: Boolean(id && organizationId),
  });

  const arrangement =
    song.data?.arrangements.find((candidate) => candidate.is_default) ?? song.data?.arrangements[0];

  const baseKey = arrangement?.song_key ?? song.data?.default_key ?? null;

  // The same renderer the API and the web app use, so a chart read here matches
  // the one printed for the band.
  const chart = useMemo(() => {
    if (!arrangement?.chord_chart) return null;
    const rendered = renderChordProChart(arrangement.chord_chart, {
      sourceKey: baseKey,
      semitones: shift,
      notation,
    });
    return parseChordPro(rendered.chordpro);
  }, [arrangement?.chord_chart, baseKey, shift, notation]);

  if (song.isLoading) {
    return (
      <Screen>
        <Loading label="Opening the chart" />
      </Screen>
    );
  }
  if (song.error) {
    return (
      <Screen>
        <View style={styles.errorWrap}>
          <ErrorNotice error={song.error} />
        </View>
      </Screen>
    );
  }
  if (!song.data) return null;

  const displayKey =
    baseKey && shift !== 0 ? transposeKey(baseKey, shift, shift < 0 ? 'flats' : 'sharps') : baseKey;
  // Numbers, numerals and a lyric sheet carry no key, so transposing them is a no-op.
  const keyed = notation === 'chords';
  const meta = [arrangement?.bpm ? `${arrangement.bpm} bpm` : null, arrangement?.meter ?? song.data.meter]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <Screen>
      <Stack.Screen options={{ title: song.data.title }} />
      <ScrollView contentContainerStyle={screenPadding(theme)}>
        <Reveal>
          <View style={styles.hero}>
            {song.data.author ? (
              <Text style={styles.author}>{song.data.author.toUpperCase()}</Text>
            ) : null}
            <Text style={styles.title}>{song.data.title}</Text>
            {meta ? <Text style={styles.meta}>{meta}</Text> : null}
          </View>
        </Reveal>

        <Reveal index={1}>
          <Card>
            <Label>Key</Label>
            <View style={styles.transposeRow}>
              <View style={styles.keyReadout}>
                <Text style={styles.keyValue}>
                  {keyed ? (displayKey ?? '—') : CHART_NOTATION_LABELS[notation]}
                </Text>
                <Text style={styles.keyShift}>
                  {!keyed
                    ? 'Key-independent'
                    : shift === 0
                      ? 'Original key'
                      : `${shift > 0 ? '+' : ''}${shift} semitones`}
                </Text>
              </View>
              <IconButton
                name="minus"
                accessibilityLabel="Transpose down a semitone"
                disabled={!keyed}
                onPress={() => setShift((current) => current - 1)}
              />
              <IconButton
                name="plus"
                accessibilityLabel="Transpose up a semitone"
                disabled={!keyed}
                onPress={() => setShift((current) => current + 1)}
              />
              {keyed && shift !== 0 ? (
                <IconButton
                  name="close"
                  accessibilityLabel="Back to the original key"
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

        {arrangement?.sequence.length ? (
          <Reveal index={2}>
            <Card>
              <Label>Sequence</Label>
              <View style={styles.sequence}>
                {arrangement.sequence.map((part, index) => (
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
                title="No chart yet"
                description="Add one from the web app to read it here."
              />
            </Card>
          )}
        </Reveal>
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    errorWrap: { padding: theme.space.xl },
    hero: { gap: theme.space.sm },
    author: { ...theme.type.label, color: theme.color.inkMuted },
    title: { ...theme.type.display, color: theme.color.ink },
    meta: { ...theme.type.bodySmall, color: theme.color.inkMuted },

    transposeRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
    keyReadout: { flex: 1 },
    keyValue: { ...theme.type.display, fontSize: 32, lineHeight: 36, color: theme.color.ink },
    keyShift: { ...theme.type.bodySmall, color: theme.color.inkMuted },

    sequence: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
  });
