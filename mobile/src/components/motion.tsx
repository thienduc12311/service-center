import { useState, type ReactNode } from 'react';
import {
  Pressable,
  View,
  type AccessibilityRole,
  type AccessibilityState,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

export interface RevealProps {
  children: ReactNode;
  /** Kept for existing screen call sites; content is immediately available. */
  index?: number;
  style?: StyleProp<ViewStyle>;
}

/** Lists render immediately, matching the website's operational screens. */
export const Reveal = ({ children, style }: RevealProps) => (
  <View style={style} pointerEvents="box-none">{children}</View>
);

export interface PressableScaleProps {
  children: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  /** Extra state such as `checked`; `disabled` is always derived from the prop. */
  accessibilityState?: Omit<AccessibilityState, 'disabled'>;
  /** Opacity while held down. */
  pressedOpacity?: number;
  /** Extra touch area around a small target. */
  hitSlop?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Immediate press feedback without delayed or mandatory motion.
 *
 * Pressed state is tracked here rather than through Pressable's function-form
 * `style`: NativeWind's Pressable interop drops a function style, which left
 * buttons and rows without their fill and layout on device.
 */
export const PressableScale = ({
  children,
  onPress,
  disabled = false,
  accessibilityLabel,
  accessibilityRole = 'button',
  accessibilityState,
  pressedOpacity = 0.8,
  hitSlop,
  style,
}: PressableScaleProps) => {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ ...accessibilityState, disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={hitSlop}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[style, pressed && !disabled && { opacity: pressedOpacity }]}
    >
      {children}
    </Pressable>
  );
};
