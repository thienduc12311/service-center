import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  parseChordPro,
  semitonesBetween,
  transposeChordPro,
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
  screenPadding,
} from '../../src/components/ui';
import { ChordChart } from '../../src/components/ChordChart';
import { Reveal } from '../../src/components/motion';
import type { Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';

const CHROMATIC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

const shiftKeyLabel = (key: string, semitones: number): string => {
  const minor = /m(?!aj)/i.test(key);
  const root = key.replace(/m(in)?$/i, '');
  const distance = semitonesBetween('C', root);
  if (distance === null) return key;
  const next = (((distance + semitones) % 12) + 12) % 12;
  return `${CHROMATIC[next]}${minor ? 'm' : ''}`;
};

/** Transposing on stage is a one-tap operation, so it stays a pair of steppers. */
export default function SongScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { organizationId } = useAuth();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [shift, setShift] = useState(0);

  const song = useQuery({
    queryKey: ['song', organizationId, id],
    queryFn: () => api.getSong(id!),
    enabled: Boolean(id && organizationId),
  });

  const arrangement =
    song.data?.arrangements.find((candidate) => candidate.is_default) ?? song.data?.arrangements[0];

  const chart = useMemo(() => {
    if (!arrangement?.chord_chart) return null;
    return parseChordPro(
      transposeChordPro(arrangement.chord_chart, shift, shift < 0 ? 'flats' : 'sharps'),
    );
  }, [arrangement?.chord_chart, shift]);

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

  const baseKey = arrangement?.song_key ?? song.data.default_key ?? null;
  const displayKey = baseKey && shift !== 0 ? shiftKeyLabel(baseKey, shift) : baseKey;
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
                <Text style={styles.keyValue}>{displayKey ?? '—'}</Text>
                <Text style={styles.keyShift}>
                  {shift === 0 ? 'Original key' : `${shift > 0 ? '+' : ''}${shift} semitones`}
                </Text>
              </View>
              <IconButton
                name="minus"
                accessibilityLabel="Transpose down a semitone"
                onPress={() => setShift((current) => current - 1)}
              />
              <IconButton
                name="plus"
                accessibilityLabel="Transpose up a semitone"
                onPress={() => setShift((current) => current + 1)}
              />
              {shift !== 0 ? (
                <IconButton
                  name="close"
                  accessibilityLabel="Back to the original key"
                  onPress={() => setShift(0)}
                />
              ) : null}
            </View>
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
                description="Photograph a printed chart to import it, or add one from the web app."
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
