import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { platformAccessFor, storagePercentUsed, storageQuotaLevel } from '../../lib/church-platform';
import { useOrganizationStorage } from '../../lib/useOrganizationStorage';
import { useAuth } from '../../providers/AuthProvider';
import { useFormatters } from '../../i18n';
import type { Accent, Theme } from '../../lib/theme';
import { useTheme, useThemedStyles } from '../../lib/useTheme';
import { Icon, type IconName } from '../icons';
import { PressableScale } from '../motion';

/**
 * Notices above every tab: a Service Center admin inside a church as a
 * temporary owner, and (owners and admins) a church nearly or completely out
 * of media storage. Takes the status-bar inset itself when shown; the tabs
 * below sit in their own safe-area provider so they don't add it twice.
 */
export const TabBanners = () => {
  const { t } = useTranslation('settings');
  const { dateTime } = useFormatters();
  const { user, organizationId } = useAuth();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const storage = useOrganizationStorage();

  const access = platformAccessFor(user, organizationId);
  const usage = storage.data;
  const level = storageQuotaLevel(usage);

  if (!access && level === 'ok') return null;

  return (
    <View style={[styles.container, { paddingTop: insets.top + theme.space.xs }]}>
      {access ? (
        <Banner
          icon="info"
          accent={theme.accent.blue}
          text={t('platformAccess.banner', { church: access.churchName, time: dateTime(access.expiresAt) })}
        />
      ) : null}
      {usage && level !== 'ok' ? (
        <Banner
          icon="alert"
          accent={level === 'full' ? theme.accent.red : theme.accent.yellow}
          text={level === 'full' ? t('storage.full') : t('storage.warning', { percent: storagePercentUsed(usage) })}
          actionLabel={t('storage.settingsLink')}
          onAction={() => router.navigate('/profile')}
        />
      ) : null}
    </View>
  );
};

interface BannerProps {
  icon: IconName;
  accent: Accent;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
}

const Banner = ({ icon, accent, text, actionLabel, onAction }: BannerProps) => {
  const styles = useThemedStyles(makeStyles);
  return (
    <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: accent.bg }]}>
      <Icon name={icon} size={17} color={accent.fg} />
      <View style={styles.bannerText}>
        <Text style={[styles.text, { color: accent.fg }]}>{text}</Text>
        {actionLabel && onAction ? (
          <PressableScale onPress={onAction} pressedOpacity={0.5} hitSlop={8} accessibilityLabel={actionLabel}>
            <Text style={[styles.action, { color: accent.fg }]}>{actionLabel}</Text>
          </PressableScale>
        ) : null}
      </View>
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      gap: theme.space.xs,
      paddingHorizontal: theme.space.lg,
      paddingBottom: theme.space.xs,
      backgroundColor: theme.color.canvas,
    },
    banner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.space.sm,
      borderRadius: theme.radius.md,
      padding: theme.space.md,
    },
    bannerText: { flex: 1, gap: theme.space.xs },
    text: { ...theme.type.bodySmall },
    action: { ...theme.type.label, fontWeight: '600', textDecorationLine: 'underline' },
  });
