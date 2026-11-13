import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ArrangementRow } from '@service-center/shared';
import type { Theme } from '../lib/theme';
import { useTheme, useThemedStyles } from '../lib/useTheme';
import { Icon } from './icons';
import { PressableScale } from './motion';
import { KeyCap } from './ui';

export interface ArrangementPickerProps {
  arrangements: readonly ArrangementRow[];
  selectedId: string | null;
  /** The arrangement a plan item is set to, marked so it can be found again. */
  planArrangementId?: string | null;
  onSelect: (arrangementId: string) => void;
}

/**
 * A stacked list of selectable cards rather than a segmented control:
 * arrangement names are free text and a song can have many, so each needs a
 * full row to wrap in.
 */
export const ArrangementPicker = ({
  arrangements,
  selectedId,
  planArrangementId = null,
  onSelect,
}: ArrangementPickerProps) => {
  const { t } = useTranslation('songs');
  const theme = useTheme();
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
        const flags = [
          inPlan ? t('mobileArrangements.inPlan') : arrangement.is_default ? t('arrangement.defaultBadge') : null,
          arrangement.archived_at ? t('songsPage.archivedBadge') : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <PressableScale
            key={arrangement.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={[arrangement.name, detail].filter(Boolean).join(', ')}
            onPress={() => onSelect(arrangement.id)}
            pressedOpacity={0.7}
            style={[styles.card, selected && styles.cardSelected]}
          >
            <View style={[styles.radio, selected && styles.radioSelected]}>
              {selected ? <Icon name="check" size={12} color={theme.color.onBrand} strokeWidth={3} /> : null}
            </View>
            <View style={styles.body}>
              <Text style={[styles.name, selected && styles.nameSelected]}>{arrangement.name}</Text>
              {flags ? <Text style={styles.detail}>{flags}</Text> : null}
            </View>
            {arrangement.song_key ? <KeyCap>{arrangement.song_key}</KeyCap> : null}
          </PressableScale>
        );
      })}
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    list: { gap: theme.space.sm },
    card: {
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.md,
      paddingHorizontal: theme.space.md,
      paddingVertical: theme.space.sm,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.color.border,
      backgroundColor: theme.color.surface,
    },
    cardSelected: { borderColor: theme.color.brand, borderWidth: 1.5, backgroundColor: theme.accent.blue.bg },
    radio: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: theme.color.borderStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioSelected: { borderColor: theme.color.brand, backgroundColor: theme.color.brand },
    body: { flex: 1, gap: 2 },
    name: { ...theme.type.body, fontWeight: '500', color: theme.color.ink },
    nameSelected: { fontWeight: '600', color: theme.color.brandText },
    detail: { ...theme.type.label, fontSize: 12, color: theme.color.inkMuted },
  });
