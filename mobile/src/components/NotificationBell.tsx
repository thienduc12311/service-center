import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Icon } from './icons';
import { PressableScale } from './motion';
import { useNotifications } from '../providers/NotificationsProvider';
import type { Theme } from '../lib/theme';
import { fonts } from '../lib/theme';
import { useTheme, useThemedStyles } from '../lib/useTheme';

export interface NotificationBellProps {
  /** Renders the bell on its own right-aligned strip above a screen's content. */
  bar?: boolean;
}

/** Past this the badge stops counting and starts hinting. */
const BADGE_CAP = 99;

/** Notification access uses a 44-point touch target on every tab. */
export const NotificationBell = ({ bar = true }: NotificationBellProps) => {
  const { unread } = useNotifications();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();

  const label = unread > BADGE_CAP ? `${BADGE_CAP}+` : String(unread);

  const bell = (
    <PressableScale
      onPress={() => router.push('/notifications')}
      accessibilityLabel={
        unread ? `Notifications, ${unread} unread` : 'Notifications'
      }
      style={styles.button}
    >
      <Icon name="bell" size={19} color={theme.color.ink} />
      {unread > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeLabel} numberOfLines={1} maxFontSizeMultiplier={1.4}>
            {label}
          </Text>
        </View>
      ) : null}
    </PressableScale>
  );

  if (!bar) return bell;
  return <View style={styles.bar}>{bell}</View>;
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    bar: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      paddingHorizontal: theme.space.xl,
      paddingTop: theme.space.sm,
    },
    button: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badge: {
      position: 'absolute',
      top: 2,
      right: 1,
      minWidth: 16,
      minHeight: 16,
      paddingHorizontal: 4,
      borderRadius: theme.radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.accent.red.fg,
      borderWidth: 2,
      borderColor: theme.color.canvas,
    },
    badgeLabel: {
      fontFamily: fonts.sansMedium,
      fontWeight: '600',
      fontSize: 9,
      lineHeight: 12,
      color: theme.color.onBrand,
    },
  });
