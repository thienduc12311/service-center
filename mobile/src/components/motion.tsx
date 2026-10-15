import { type ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

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
  style?: StyleProp<ViewStyle>;
}

/** Immediate press feedback without delayed or mandatory motion. */
export const PressableScale = ({
  children, onPress, disabled = false, accessibilityLabel, style,
}: PressableScaleProps) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel}
    accessibilityState={{ disabled }}
    disabled={disabled}
    onPress={onPress}
    style={({ pressed }) => [style, pressed && !disabled && { opacity: 0.8 }]}
  >
    {children}
  </Pressable>
);
