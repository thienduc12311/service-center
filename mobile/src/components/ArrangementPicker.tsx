import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ArrangementRow } from '@service-center/shared';
import type { Theme } from '../lib/theme';
import { useThemedStyles } from '../lib/useTheme';

export interface ArrangementPickerProps {
  arrangements: readonly ArrangementRow[];
  selectedId: string | null;
  /** The arrangement a plan item is set to, marked so it can be found again. */
  planArrangementId?: string | null;
  onSelect: (arrangementId: string) => void;
}

/**
 * Wrapping chips rather than a segmented control: arrangement names are
 * free text and a song can have many, so they need room to wrap.
 */
export const ArrangementPicker = ({
  arrangements,
  selectedId,
  planArrangementId = null,
  onSelect,
}: ArrangementPickerProps) => {
  const { t } = useTranslation('songs');
  const styles = useThemedStyles(makeStyles);

  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t('mobileArrangements.label')} style={styles.list}>
      {arrangements.map((arrangement) => {
        const selected = arrangement.id === selectedId;
        const inPlan = arrangement.id === planArrangementId;
        const detail = [
          arrangement.song_key,
          inPlan ? t('mobileArrangements.inPlan') : arrangement.is_default ? t('arrangement.defaultBadge') : null,
          arrangement.archived_at ? t('songsPage.archivedBadge') : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <Pressable
            key={arrangement.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={[arrangement.name, detail].filter(Boolean).join(', ')}
            onPress={() => onSelect(arrangement.id)}
            style={[styles.chip, selected && styles.chipSelected]}
          >
            <Text style={[styles.name, selected && styles.nameSelected]}>{arrangement.name}</Text>
            {detail ? <Text style={styles.detail}>{detail}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    list: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    chip: {
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: theme.space.md,
      paddingVertical: theme.space.xs,
      borderRadius: theme.radius.sm,
      borderWidth: 1,
      borderColor: theme.color.border,
      backgroundColor: theme.color.surfaceInset,
    },
    chipSelected: { borderColor: theme.color.brand, backgroundColor: theme.accent.blue.bg },
    name: { ...theme.type.bodySmall, color: theme.color.ink },
    nameSelected: { fontWeight: '600', color: theme.color.brandText },
    detail: { ...theme.type.bodySmall, fontSize: 12, color: theme.color.inkMuted },
  });
