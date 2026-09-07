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
              <Text style={styles.sectionLabel}>
                {(section.label ?? section.type).toUpperCase()}
              </Text>
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
      backgroundColor: theme.color.surfaceInset,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.color.border,
    },
    sheet: { padding: theme.space.lg },
    section: { marginBottom: theme.space.lg },
    sectionLabel: { ...theme.type.label, color: theme.color.inkFaint, marginBottom: theme.space.sm },
    chordRow: { ...theme.type.code, color: theme.color.inkMuted },
    lyricRow: { ...theme.type.code, color: theme.color.ink },
  });
