import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { formatFileSize } from '@service-center/shared';
import { storageBarFraction, storagePercentUsed, storageQuotaLevel } from '../../lib/church-platform';
import { useOrganizationStorage } from '../../lib/useOrganizationStorage';
import type { Theme } from '../../lib/theme';
import { useTheme, useThemedStyles } from '../../lib/useTheme';
import { Card, ErrorNotice, Label, Loading } from '../ui';

/** The active church's media usage with its 80% warning and full state (owners and admins). */
export const StorageUsage = () => {
  const { t } = useTranslation('settings');
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const storage = useOrganizationStorage();
  const usage = storage.data;
  const level = storageQuotaLevel(usage);
  const fill = level === 'full' ? theme.color.danger : level === 'warning' ? theme.accent.yellow.fg : theme.color.brand;

  return (
    <Card>
      <Label>{t('storage.title')}</Label>
      {storage.isLoading ? <Loading /> : null}
      <ErrorNotice error={storage.error} />
      {usage ? (
        <View style={styles.usage}>
          <View
            style={styles.track}
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: Math.min(100, storagePercentUsed(usage)) }}
          >
            <View style={[styles.fill, { width: `${storageBarFraction(usage) * 100}%`, backgroundColor: fill }]} />
          </View>
          <Text style={styles.body}>
            {t('storage.usage', { used: formatFileSize(usage.used_bytes), quota: formatFileSize(usage.quota_bytes) })}
          </Text>
          {level === 'warning' ? (
            <Text style={styles.warning}>{t('storage.warning', { percent: storagePercentUsed(usage) })}</Text>
          ) : null}
          {level === 'full' ? <Text style={styles.full}>{t('storage.full')}</Text> : null}
        </View>
      ) : null}
    </Card>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    usage: { gap: theme.space.sm },
    track: {
      height: 8,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.color.surfaceInset,
      overflow: 'hidden',
    },
    fill: { height: '100%', borderRadius: theme.radius.pill },
    body: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    warning: {
      ...theme.type.bodySmall,
      color: theme.accent.yellow.fg,
      backgroundColor: theme.accent.yellow.bg,
      padding: theme.space.sm,
      borderRadius: theme.radius.sm,
    },
    full: {
      ...theme.type.bodySmall,
      color: theme.accent.red.fg,
      backgroundColor: theme.accent.red.bg,
      padding: theme.space.sm,
      borderRadius: theme.radius.sm,
    },
  });
