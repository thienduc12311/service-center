import { forwardRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Svg, { Line as SvgLine } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts, type Accent, type Theme } from '../lib/theme';
import { useTheme, useThemedStyles } from '../lib/useTheme';
import { Icon, type IconName } from './icons';
import { PressableScale, Reveal } from './motion';

/* -------------------------------------------------------------------------
 * Structure
 * ---------------------------------------------------------------------- */

export interface ScreenProps {
  children: ReactNode;
  /** Inset the content below the status bar, for screens with no nav header. */
  safeTop?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** The page ground. Every screen sits on the warm canvas, never on white. */
export const Screen = ({ children, safeTop = false, style }: ScreenProps) => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        { flex: 1, backgroundColor: theme.color.canvas },
        safeTop && { paddingTop: insets.top },
        style,
      ]}
    >
      {children}
    </View>
  );
};

/** Standard content insets: generous side margins, macro space at the foot. */
export const screenPadding = (theme: Theme): ViewStyle => ({
  paddingHorizontal: theme.space.xl,
  paddingTop: theme.space.lg,
  paddingBottom: theme.space.hero,
  gap: theme.space.xxl,
});

export interface RuledFieldProps {
  height?: number;
}

/**
 * A faint set of vertical rules behind a screen's opening block. It gives the
 * header depth without a gradient, a photograph, or any colour at all.
 */
export const RuledField = ({ height = 220 }: RuledFieldProps) => {
  const theme = useTheme();
  const columns = [0.14, 0.32, 0.5, 0.68, 0.86];
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { height, overflow: 'hidden' }]}>
      <Svg width="100%" height={height}>
        {columns.map((fraction) => (
          <SvgLine
            key={fraction}
            x1={`${fraction * 100}%`}
            y1={0}
            x2={`${fraction * 100}%`}
            y2={height}
            stroke={theme.color.border}
            strokeWidth={1}
            opacity={0.55}
          />
        ))}
        <SvgLine
          x1="0"
          y1={height - 1}
          x2="100%"
          y2={height - 1}
          stroke={theme.color.border}
          strokeWidth={1}
          opacity={0.4}
        />
      </Svg>
    </View>
  );
};

export interface ScreenHeaderProps {
  /** Small mono label above the title. Never a numbered "section" tag. */
  eyebrow?: string;
  title: string;
  description?: string;
  /** A button or control pinned to the bottom of the header block. */
  action?: ReactNode;
}

/** The editorial opening of a screen: serif headline, macro whitespace. */
export const ScreenHeader = ({ eyebrow, title, description, action }: ScreenHeaderProps) => {
  const styles = useThemedStyles(makeStyles);
  return (
    <Reveal>
      <View style={styles.header}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow.toUpperCase()}</Text> : null}
        <Text style={styles.headerTitle}>{title}</Text>
        {description ? <Text style={styles.headerDescription}>{description}</Text> : null}
        {action ? <View style={styles.headerAction}>{action}</View> : null}
      </View>
    </Reveal>
  );
};

export interface LabelProps {
  children: string;
  style?: StyleProp<TextStyle>;
}

/** Mono, uppercase, wide-tracked. Names a block of content — nothing more. */
export const Label = ({ children, style }: LabelProps) => {
  const styles = useThemedStyles(makeStyles);
  return <Text style={[styles.label, style]}>{children.toUpperCase()}</Text>;
};

export interface CardProps {
  children: ReactNode;
  /** Tighter inner padding, for cards that are mostly a list of rows. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** One hairline, one crisp radius, generous padding. No shadow, ever. */
export const Card = ({ children, compact = false, style }: CardProps) => {
  const styles = useThemedStyles(makeStyles);
  return <View style={[styles.card, compact && styles.cardCompact, style]}>{children}</View>;
};

export interface DividerProps {
  /** Pulls the rule out to the card's edges, ignoring its padding. */
  bleed?: number;
}

export const Divider = ({ bleed = 0 }: DividerProps) => {
  const theme = useTheme();
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.color.border,
        marginHorizontal: -bleed,
      }}
    />
  );
};

/* -------------------------------------------------------------------------
 * Actions
 * ---------------------------------------------------------------------- */

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export const Button = ({
  title,
  onPress,
  variant = 'primary',
  icon,
  loading = false,
  disabled = false,
  style,
}: ButtonProps) => {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const isDisabled = disabled || loading;

  const surface: Record<ButtonVariant, ViewStyle> = {
    primary: { backgroundColor: theme.color.inkSolid },
    secondary: { backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border },
    quiet: { backgroundColor: 'transparent' },
    danger: { backgroundColor: theme.accent.red.bg, borderWidth: 1, borderColor: 'transparent' },
  };
  const label: Record<ButtonVariant, string> = {
    primary: theme.color.onInk,
    secondary: theme.color.ink,
    quiet: theme.color.inkMuted,
    danger: theme.accent.red.fg,
  };

  return (
    <PressableScale
      onPress={onPress}
      disabled={isDisabled}
      accessibilityLabel={title}
      style={[styles.button, surface[variant], isDisabled && styles.buttonDisabled, style]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={label[variant]} />
      ) : icon ? (
        <Icon name={icon} size={17} color={label[variant]} />
      ) : null}
      <Text style={[styles.buttonLabel, { color: label[variant] }]}>{title}</Text>
    </PressableScale>
  );
};

export interface IconButtonProps {
  name: IconName;
  onPress: () => void;
  accessibilityLabel: string;
  disabled?: boolean;
}

/** A square, hairline-bordered target for a single glyph. */
export const IconButton = ({ name, onPress, accessibilityLabel, disabled = false }: IconButtonProps) => {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      style={[styles.iconButton, disabled && styles.buttonDisabled]}
    >
      <Icon name={name} size={19} color={theme.color.ink} />
    </PressableScale>
  );
};

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.segmented}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            onPress={() => onChange(option.value)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* -------------------------------------------------------------------------
 * Data display
 * ---------------------------------------------------------------------- */

export interface TagProps {
  label: string;
  accent: Accent;
}

/** The one place a pill shape is allowed. */
export const Tag = ({ label, accent }: TagProps) => {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.tag, { backgroundColor: accent.bg }]}>
      <Text style={[styles.tagLabel, { color: accent.fg }]}>{label.toUpperCase()}</Text>
    </View>
  );
};

export interface IconWellProps {
  name: IconName;
  accent: Accent;
  size?: number;
}

/** A muted pastel square holding one icon — the only filled colour blocks. */
export const IconWell = ({ name, accent, size = 40 }: IconWellProps) => {
  const theme = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: theme.radius.md,
        backgroundColor: accent.bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={name} size={size * 0.5} color={accent.fg} />
    </View>
  );
};

export interface AvatarProps {
  name: string | null | undefined;
  size?: number;
}

export const Avatar = ({ name, size = 36 }: AvatarProps) => {
  const theme = useTheme();
  const letters = (name ?? '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: theme.radius.pill,
        backgroundColor: theme.color.surfaceInset,
        borderWidth: 1,
        borderColor: theme.color.border,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          fontFamily: fonts.monoMedium,
          fontSize: size * 0.34,
          letterSpacing: 0.3,
          color: theme.color.inkMuted,
        }}
      >
        {letters || '—'}
      </Text>
    </View>
  );
};

export interface KeyCapProps {
  children: string;
}

/** A musical key or shortcut rendered as a physical cap. */
export const KeyCap = ({ children }: KeyCapProps) => {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.keyCap}>
      <Text style={styles.keyCapLabel}>{children}</Text>
    </View>
  );
};

export interface MetaProps {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
}

/** Secondary supporting copy: dates, counts, captions. */
export const Meta = ({ children, style }: MetaProps) => {
  const styles = useThemedStyles(makeStyles);
  return <Text style={[styles.meta, style]}>{children}</Text>;
};

export interface ListRowProps {
  children: ReactNode;
  onPress?: () => void;
  /** Draws a hairline above the row, for rows after the first. */
  divided?: boolean;
  showChevron?: boolean;
}

/** A tappable row separated only by a hairline — no nested boxes. */
export const ListRow = ({ children, onPress, divided = false, showChevron = false }: ListRowProps) => {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const content = (
    <View style={[styles.listRow, divided && styles.listRowDivided]}>
      <View style={styles.flex}>{children}</View>
      {showChevron ? <Icon name="chevronRight" size={16} color={theme.color.inkFaint} /> : null}
    </View>
  );

  if (!onPress) return content;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
    >
      {content}
    </Pressable>
  );
};

/* -------------------------------------------------------------------------
 * Input
 * ---------------------------------------------------------------------- */

export interface FieldProps extends TextInputProps {
  label?: string;
  /** Layout for the label-and-input pair, e.g. `flex: 1` inside a row. */
  containerStyle?: StyleProp<ViewStyle>;
}

export const Field = forwardRef<TextInput, FieldProps>(
  ({ label, style, containerStyle, ...props }, ref) => {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.field, containerStyle]}>
      {label ? <Label>{label}</Label> : null}
      <TextInput
        ref={ref}
        placeholderTextColor={theme.color.inkFaint}
        style={[styles.input, style]}
        {...props}
      />
    </View>
  );
  },
);
Field.displayName = 'Field';

/* -------------------------------------------------------------------------
 * States
 * ---------------------------------------------------------------------- */

export interface LoadingProps {
  label?: string;
}

export const Loading = ({ label }: LoadingProps) => {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={theme.color.inkFaint} />
      {label ? <Text style={styles.centeredBody}>{label}</Text> : null}
    </View>
  );
};

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export const EmptyState = ({ title, description, action }: EmptyStateProps) => {
  const styles = useThemedStyles(makeStyles);
  return (
    <Reveal>
      <View style={styles.centered}>
        <Text style={styles.emptyTitle}>{title}</Text>
        {description ? <Text style={styles.centeredBody}>{description}</Text> : null}
        {action ? <View style={styles.emptyAction}>{action}</View> : null}
      </View>
    </Reveal>
  );
};

export interface ErrorNoticeProps {
  error: unknown;
}

export const ErrorNotice = ({ error }: ErrorNoticeProps) => {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return (
    <View style={styles.notice}>
      <Icon name="alert" size={17} color={theme.accent.red.fg} />
      <Text style={styles.noticeText}>{message}</Text>
    </View>
  );
};

/* -------------------------------------------------------------------------
 * Styles
 * ---------------------------------------------------------------------- */

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },

    header: { paddingTop: theme.space.lg, paddingBottom: theme.space.xs, gap: theme.space.sm },
    eyebrow: { ...theme.type.label, color: theme.color.inkFaint },
    headerTitle: { ...theme.type.display, color: theme.color.ink },
    headerDescription: { ...theme.type.body, color: theme.color.inkMuted, maxWidth: 420 },
    headerAction: { marginTop: theme.space.md, alignSelf: 'flex-start' },

    label: { ...theme.type.label, color: theme.color.inkFaint },

    card: {
      backgroundColor: theme.color.surface,
      borderWidth: 1,
      borderColor: theme.color.border,
      borderRadius: theme.radius.lg,
      padding: theme.space.xl,
      gap: theme.space.lg,
    },
    cardCompact: { padding: theme.space.md, gap: 0 },

    button: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.space.sm,
      borderRadius: theme.radius.sm,
      paddingHorizontal: theme.space.lg,
      minHeight: 46,
    },
    buttonDisabled: { opacity: 0.4 },
    buttonLabel: { fontFamily: fonts.sansMedium, fontSize: 14.5, letterSpacing: -0.1 },

    iconButton: {
      width: 42,
      height: 42,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radius.sm,
      borderWidth: 1,
      borderColor: theme.color.border,
      backgroundColor: theme.color.surface,
    },

    segmented: {
      flexDirection: 'row',
      backgroundColor: theme.color.surfaceInset,
      borderRadius: theme.radius.md,
      padding: 3,
      gap: 3,
    },
    segment: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: theme.space.sm,
      borderRadius: theme.radius.sm,
    },
    segmentActive: { backgroundColor: theme.color.surface },
    segmentLabel: { fontFamily: fonts.sans, fontSize: 13.5, color: theme.color.inkMuted },
    segmentLabelActive: { fontFamily: fonts.sansMedium, color: theme.color.ink },

    tag: {
      alignSelf: 'flex-start',
      borderRadius: theme.radius.pill,
      paddingHorizontal: 9,
      paddingVertical: 4,
    },
    tagLabel: { ...theme.type.label, fontSize: 9.5 },

    keyCap: {
      minWidth: 30,
      alignItems: 'center',
      borderRadius: theme.radius.xs,
      borderWidth: 1,
      borderColor: theme.color.border,
      backgroundColor: theme.color.surfaceInset,
      paddingHorizontal: 6,
      paddingVertical: 3,
    },
    keyCapLabel: { ...theme.type.numeric, fontSize: 12, color: theme.color.ink },

    meta: { ...theme.type.bodySmall, color: theme.color.inkMuted },

    listRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.md,
      paddingVertical: theme.space.md,
    },
    listRowDivided: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.color.border,
    },

    field: { gap: theme.space.sm },
    input: {
      ...theme.type.body,
      color: theme.color.ink,
      borderWidth: 1,
      borderColor: theme.color.border,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.color.surface,
      paddingHorizontal: theme.space.md,
      paddingVertical: theme.space.md,
    },

    centered: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.space.sm,
      paddingVertical: theme.space.section,
      paddingHorizontal: theme.space.xl,
    },
    centeredBody: { ...theme.type.bodySmall, color: theme.color.inkMuted, textAlign: 'center' },
    emptyTitle: { ...theme.type.title, fontSize: 21, lineHeight: 26, color: theme.color.ink },
    emptyAction: { marginTop: theme.space.md },

    notice: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.space.sm,
      backgroundColor: theme.accent.red.bg,
      borderRadius: theme.radius.sm,
      padding: theme.space.md,
    },
    noticeText: { ...theme.type.bodySmall, color: theme.accent.red.fg, flex: 1 },
  });
