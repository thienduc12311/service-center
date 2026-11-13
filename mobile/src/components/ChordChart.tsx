import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { renderLineAsText, type ChordProSong } from '@service-center/shared';
import type { Theme } from '../lib/theme';
import { useThemedStyles } from '../lib/useTheme';

export interface ChordChartProps {
  chart: ChordProSong;
}

/**
 * A chord sheet reads like a typewritten document, so it is set in the
 * monospace face on an inset paper ground, scrolling sideways rather than
 * wrapping — a wrapped chord line is a wrong chord line.
 */
export const ChordChart = ({ chart }: ChordChartProps) => {
  const styles = useThemedStyles(makeStyles);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator style={styles.paper}>
      <View style={styles.sheet}>
        {chart.sections.map((section, sectionIndex) => (
          <View key={sectionIndex} style={styles.section}>
            {section.label || section.type !== 'none' ? (
              <View style={styles.sectionTag}>
                <Text style={styles.sectionLabel}>
                  {(section.label ?? section.type).toUpperCase()}
                </Text>
              </View>
            ) : null}
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
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    paper: {
      backgroundColor: theme.color.surface,
      borderRadius: theme.radius.lg + 2,
      borderWidth: 1,
      borderColor: theme.color.border,
    },
    sheet: { paddingHorizontal: theme.space.lg, paddingTop: theme.space.lg, paddingBottom: theme.space.sm },
    section: { marginBottom: theme.space.xl },
    sectionTag: {
      alignSelf: 'flex-start',
      paddingHorizontal: theme.space.sm,
      paddingVertical: 2,
      borderRadius: theme.radius.xs,
      backgroundColor: theme.accent.blue.bg,
      marginBottom: theme.space.sm,
    },
    sectionLabel: { ...theme.type.eyebrow, fontSize: 11, lineHeight: 15, color: theme.color.brandText },
    chordRow: { ...theme.type.code, fontSize: 14.5, lineHeight: 20, fontWeight: '700', color: theme.color.brandText },
    lyricRow: { ...theme.type.code, fontSize: 14.5, lineHeight: 22, color: theme.color.ink },
  });
