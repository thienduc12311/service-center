import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  parseChordPro,
  renderLineAsText,
  semitonesBetween,
  transposeChordPro,
} from '@service-center/shared';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/providers/AuthProvider';
import { Card, EmptyState, ErrorNotice, Loading, SectionTitle } from '../../src/components/ui';
import { theme } from '../../src/lib/theme';

/** Transposing on stage is a one-tap operation, so keep it to +/- buttons. */
export default function SongScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { organizationId } = useAuth();
  const [shift, setShift] = useState(0);

  const song = useQuery({
    queryKey: ['song', organizationId, id],
    queryFn: () => api.getSong(id!),
    enabled: Boolean(id && organizationId),
  });

  const arrangement =
    song.data?.arrangements.find((a) => a.is_default) ?? song.data?.arrangements[0];

  const parsed = useMemo(() => {
    if (!arrangement?.chord_chart) return null;
    return parseChordPro(
      transposeChordPro(arrangement.chord_chart, shift, shift < 0 ? 'flats' : 'sharps'),
    );
  }, [arrangement?.chord_chart, shift]);

  if (song.isLoading) return <Loading />;
  if (song.error) return <ErrorNotice error={song.error} />;
  if (!song.data) return null;

  const baseKey = arrangement?.song_key ?? song.data.default_key ?? null;
  const displayKey =
    baseKey && shift !== 0
      ? shiftKeyLabel(baseKey, shift)
      : baseKey;

  return (
    <>
      <Stack.Screen options={{ title: song.data.title }} />
      <ScrollView contentContainerStyle={styles.container}>
        <Card style={styles.card}>
          <Text style={styles.title}>{song.data.title}</Text>
          {song.data.author && <Text style={styles.subtitle}>{song.data.author}</Text>}
          <Text style={styles.meta}>
            {[
              displayKey ? `Key ${displayKey}` : null,
              arrangement?.bpm ? `${arrangement.bpm} bpm` : null,
              arrangement?.meter ?? song.data.meter,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>

          <View style={styles.transposeRow}>
            <Pressable style={styles.transposeButton} onPress={() => setShift((s) => s - 1)}>
              <Text style={styles.transposeText}>♭</Text>
            </Pressable>
            <Text style={styles.transposeValue}>
              {shift === 0 ? 'Original' : `${shift > 0 ? '+' : ''}${shift}`}
            </Text>
            <Pressable style={styles.transposeButton} onPress={() => setShift((s) => s + 1)}>
              <Text style={styles.transposeText}>♯</Text>
            </Pressable>
            {shift !== 0 && (
              <Pressable style={styles.reset} onPress={() => setShift(0)}>
                <Text style={styles.resetText}>Reset</Text>
              </Pressable>
            )}
          </View>
        </Card>

        {arrangement?.sequence.length ? (
          <Card style={styles.card}>
            <SectionTitle>Sequence</SectionTitle>
            <Text style={styles.sequence}>{arrangement.sequence.join('  ·  ')}</Text>
          </Card>
        ) : null}

        <Card style={styles.card}>
          {parsed ? (
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <View>
                {parsed.sections.map((section, sectionIndex) => (
                  <View key={sectionIndex} style={styles.section}>
                    {(section.label || section.type !== 'none') && (
                      <Text style={styles.sectionLabel}>{section.label ?? section.type}</Text>
                    )}
                    {section.lines.map((line, lineIndex) => {
                      const { chordRow, lyricRow } = renderLineAsText(line);
                      return (
                        <View key={lineIndex}>
                          {chordRow ? <Text style={styles.chordRow}>{chordRow}</Text> : null}
                          <Text style={styles.lyricRow}>{lyricRow || ' '}</Text>
                        </View>
                      );
                    })}
                  </View>
                ))}
              </View>
            </ScrollView>
          ) : (
            <EmptyState
              title="No chord chart"
              description="Import one from a photo, or add it from the web app."
            />
          )}
        </Card>
      </ScrollView>
    </>
  );
}

const CHROMATIC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const shiftKeyLabel = (key: string, semitones: number): string => {
  const minor = /m(?!aj)/i.test(key);
  const root = key.replace(/m(in)?$/i, '');
  const distance = semitonesBetween('C', root);
  if (distance === null) return key;
  const next = (((distance + semitones) % 12) + 12) % 12;
  return `${CHROMATIC[next]}${minor ? 'm' : ''}`;
};

const styles = StyleSheet.create({
  container: { padding: 16, gap: 16, paddingBottom: 40 },
  card: { gap: 8 },
  title: { fontSize: 20, fontWeight: '700', color: theme.colors.text },
  subtitle: { fontSize: 14, color: theme.colors.textMuted },
  meta: { fontSize: 13, color: theme.colors.textFaint },
  transposeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  transposeButton: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transposeText: { fontSize: 20, color: theme.colors.brand, fontWeight: '700' },
  transposeValue: { fontSize: 15, fontWeight: '600', color: theme.colors.text, minWidth: 66 },
  reset: { marginLeft: 'auto' },
  resetText: { color: theme.colors.brand, fontWeight: '600' },
  sequence: { fontSize: 14, color: theme.colors.text, fontVariant: ['tabular-nums'] },
  section: { marginBottom: 16 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    color: theme.colors.brand,
    marginBottom: 4,
  },
  chordRow: { fontFamily: 'Courier', fontSize: 14, color: theme.colors.brand, fontWeight: '700' },
  lyricRow: { fontFamily: 'Courier', fontSize: 14, color: theme.colors.text },
});
