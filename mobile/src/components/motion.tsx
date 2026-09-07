import { useEffect, type ReactNode } from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

/**
 * Motion here is meant to be felt rather than watched: a short rise into
 * place, a slight give under the finger. Everything animates on `transform`
 * and `opacity` only, so nothing triggers layout.
 */
const ENTRY_DURATION = 600;
const ENTRY_DISTANCE = 12;
const STAGGER_STEP = 80;
const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);

export interface RevealProps {
  children: ReactNode;
  /** Position in a list or grid; each step delays entry by 80ms. */
  index?: number;
  style?: StyleProp<ViewStyle>;
}

/** Fades and lifts a block into place once, on mount. */
export const Reveal = ({ children, index = 0, style }: RevealProps) => {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      Math.min(index, 8) * STAGGER_STEP,
      withTiming(1, { duration: ENTRY_DURATION, easing: EASE_OUT }),
    );
  }, [index, progress]);

  const animated = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * ENTRY_DISTANCE }],
  }));

  return (
    <Animated.View style={[style, animated]} pointerEvents="box-none">
      {children}
    </Animated.View>
  );
};

export interface PressableScaleProps {
  children: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** A press target that gives very slightly under the finger. */
export const PressableScale = ({
  children,
  onPress,
  disabled = false,
  accessibilityLabel,
  style,
}: PressableScaleProps) => {
  const pressed = useSharedValue(0);

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * 0.02 }],
  }));

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => {
        pressed.value = withTiming(1, { duration: 120, easing: EASE_OUT });
      }}
      onPressOut={() => {
        pressed.value = withTiming(0, { duration: 200, easing: EASE_OUT });
      }}
      style={[style, animated]}
    >
      {children}
    </AnimatedPressable>
  );
};
