import { useMemo, useRef, type ReactNode } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { clampSwipe, isSwipeGesture, settleSwipe, SWIPE_ACTION_WIDTH } from '../lib/swipe-to-delete';
import type { Theme } from '../lib/theme';
import { useTheme, useThemedStyles } from '../lib/useTheme';
import { Icon } from './icons';
import { PressableScale } from './motion';

export interface SwipeToDeleteProps {
  children: ReactNode;
  /** Visible text on the revealed action. */
  actionTitle: string;
  /** Screen-reader name for the action, e.g. "Delete notification: …". */
  actionAccessibilityLabel: string;
  onDelete: () => void;
  /** Outer shape (borders, radius); the row clips to it. */
  style?: StyleProp<ViewStyle>;
}

/**
 * Swipe a row left to reveal a Delete action. Built on React Native's own
 * PanResponder so it needs no extra native module. The action stays in the
 * accessibility tree, so screen-reader users reach it without swiping.
 */
export const SwipeToDelete = ({ children, actionTitle, actionAccessibilityLabel, onDelete, style }: SwipeToDeleteProps) => {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const translateX = useRef(new Animated.Value(0)).current;
  const offset = useRef(0);

  const settle = (to: number): void => {
    offset.current = to;
    Animated.spring(translateX, { toValue: to, useNativeDriver: true, bounciness: 0, speed: 20 }).start();
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) => isSwipeGesture(gesture.dx, gesture.dy, offset.current !== 0),
        onPanResponderMove: (_event, gesture) => translateX.setValue(clampSwipe(offset.current, gesture.dx)),
        onPanResponderRelease: (_event, gesture) =>
          settle(settleSwipe(offset.current, gesture.dx, gesture.vx) === 'open' ? -SWIPE_ACTION_WIDTH : 0),
        onPanResponderTerminate: () => settle(offset.current),
        onPanResponderTerminationRequest: () => false,
      }),
    // `settle` only touches the animated value and a ref, so the responder is built once.
    [translateX],
  );

  return (
    <View style={[styles.container, style]}>
      <View style={styles.actionTrack}>
        <PressableScale
          accessibilityLabel={actionAccessibilityLabel}
          onPress={() => {
            settle(0);
            onDelete();
          }}
          style={styles.action}
        >
          <Icon name="trash" size={18} color={theme.color.onBrand} />
          <Text style={styles.actionText}>{actionTitle}</Text>
        </PressableScale>
      </View>
      <Animated.View style={[styles.foreground, { transform: [{ translateX }] }]} {...responder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    container: { overflow: 'hidden' },
    actionTrack: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, flexDirection: 'row', justifyContent: 'flex-end' },
    action: {
      width: SWIPE_ACTION_WIDTH,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
      backgroundColor: theme.color.danger,
    },
    actionText: { ...theme.type.label, fontSize: 12, color: theme.color.onBrand },
    foreground: { backgroundColor: theme.color.surface },
  });
