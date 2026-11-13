import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { AttendanceConflict } from '@service-center/shared';
import { type Theme } from '../lib/theme';
import { useTheme, useThemedStyles } from '../lib/useTheme';
import { Icon } from './icons';
import { useFormatters } from '../i18n';

export interface ConflictListProps {
  conflicts: readonly AttendanceConflict[];
  nameOf: (personId: string) => string;
}

/**
 * The website's ConflictList: blocking conflicts (a blockout, or a commitment
 * on another plan) apart from same-plan double roles, which never block.
 * Details the viewer may not see arrive redacted from the server.
 */
export const ConflictList = ({ conflicts, nameOf }: ConflictListProps) => {
  const { t } = useTranslation('reports');
  const format = useFormatters();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);

  const windowOf = (conflict: AttendanceConflict): string => {
    const values = {
      date: format.date(conflict.starts_at, 'short'),
      start: format.time(conflict.starts_at),
      end: format.time(conflict.ends_at),
    };
    return conflict.interval_source === 'untimed_fallback'
      ? t('attendance.conflicts.windowApproximate', values)
      : t('attendance.conflicts.window', values);
  };
  const detailOf = (conflict: AttendanceConflict): string =>
    conflict.redacted ? t('attendance.conflicts.anotherCommitment') : conflict.detail;

  const blocking = conflicts.filter((conflict) => conflict.severity === 'blocking');
  const warnings = conflicts.filter((conflict) => conflict.severity === 'warning');

  return (
    <>
      {blocking.length > 0 ? (
        <View accessibilityRole="alert" style={[styles.box, styles.blockingBox]}>
          <View style={styles.titleRow}>
            <Icon name="alert" size={16} color={theme.accent.yellow.fg} />
            <Text style={styles.warnTitle}>{t('attendance.conflicts.blockingTitle')}</Text>
          </View>
          {blocking.map((conflict, index) => (
            <Text key={`${conflict.candidate_key}-${conflict.starts_at}-${index}`} style={styles.line}>
              {conflict.kind === 'overlapping_commitment'
                ? t('attendance.conflicts.overlapping', { name: nameOf(conflict.person_id), detail: detailOf(conflict), window: windowOf(conflict) })
                : t('attendance.conflicts.blockout', { name: nameOf(conflict.person_id), window: windowOf(conflict) })}
            </Text>
          ))}
        </View>
      ) : null}
      {warnings.length > 0 ? (
        <View style={styles.box}>
          <View style={styles.titleRow}>
            <Icon name="info" size={16} color={theme.color.inkMuted} />
            <Text style={styles.title}>{t('attendance.conflicts.warningTitle')}</Text>
          </View>
          {warnings.map((conflict, index) => (
            <Text key={`${conflict.candidate_key}-${conflict.starts_at}-${index}`} style={styles.line}>
              {t('attendance.conflicts.samePlan', { name: nameOf(conflict.person_id), detail: detailOf(conflict), window: windowOf(conflict) })}
            </Text>
          ))}
          <Text style={styles.line}>{t('attendance.conflicts.warningHint')}</Text>
        </View>
      ) : null}
    </>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    box: {
      gap: theme.space.xs,
      padding: theme.space.md,
      borderWidth: 1,
      borderColor: theme.color.border,
      borderRadius: theme.radius.md,
      backgroundColor: theme.color.surfaceInset,
    },
    blockingBox: { backgroundColor: theme.accent.yellow.bg, borderColor: theme.accent.yellow.bg },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
    warnTitle: { ...theme.type.heading, color: theme.accent.yellow.fg, flex: 1 },
    title: { ...theme.type.heading, color: theme.color.ink, flex: 1 },
    line: { ...theme.type.bodySmall, color: theme.color.inkMuted },
  });
