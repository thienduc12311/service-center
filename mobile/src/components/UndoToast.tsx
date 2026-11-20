import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Theme } from '../lib/theme';
import { useThemedStyles } from '../lib/useTheme';
import { PressableScale } from './motion';

export interface UndoToastProps {
  message: string;
  actionTitle: string;
  onUndo: () => void;
}

/** A short-lived bar at the bottom of the screen offering to undo the last action. */
export const UndoToast = ({ message, actionTitle, onUndo }: UndoToastProps) => {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { paddingBottom: insets.bottom }]}>
      <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.toast}>
        <Text style={styles.message}>{message}</Text>
        <PressableScale accessibilityLabel={actionTitle} onPress={onUndo} hitSlop={12}>
          <Text style={styles.action}>{actionTitle}</Text>
        </PressableScale>
      </View>
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    wrap: {
      position: 'absolute',
      left: theme.space.lg,
      right: theme.space.lg,
      bottom: theme.space.xl,
      alignItems: 'center',
    },
    toast: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.lg,
      paddingHorizontal: theme.space.lg,
      paddingVertical: theme.space.md,
      borderRadius: theme.radius.md,
      backgroundColor: theme.color.ink,
    },
    message: { ...theme.type.bodySmall, color: theme.color.canvas },
    action: { ...theme.type.bodySmall, fontWeight: '700', color: theme.color.canvas, textDecorationLine: 'underline' },
  });
