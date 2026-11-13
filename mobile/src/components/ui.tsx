import { useErrorText } from '../i18n/useErrorText';
import { forwardRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { serviceCenterDesignTokens } from '@service-center/shared';
import {
  ActivityIndicator,
  Image,
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

/** Product canvas shared with the website. */
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

/** Native screen insets keep operational lists compact and readable. */
export const screenPadding = (theme: Theme): ViewStyle => ({
  paddingHorizontal: theme.space.lg,
  paddingTop: theme.space.lg,
  paddingBottom: theme.space.hero,
  gap: theme.space.lg,
});

export interface ScreenHeaderProps {
  /** Optional supporting context above the title. */
  eyebrow?: string;
  title: string;
  description?: string;
  /** A button or control pinned to the bottom of the header block. */
  action?: ReactNode;
  /** A compact control (icon button, avatar) beside the title. */
  trailing?: ReactNode;
}

/** Sans-serif page heading matching the website hierarchy. */
export const ScreenHeader = ({ eyebrow, title, description, action, trailing }: ScreenHeaderProps) => {
  const styles = useThemedStyles(makeStyles);
  return (
    <Reveal>
      <View style={styles.header}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <View style={styles.headerTitleRow}>
          <Text accessibilityRole="header" style={[styles.headerTitle, styles.flex]}>{title}</Text>
          {trailing}
        </View>
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

/** Form and section label using the shared sans-serif hierarchy. */
export const Label = ({ children, style }: LabelProps) => {
  const styles = useThemedStyles(makeStyles);
  return <Text style={[styles.label, style]}>{children}</Text>;
};

export interface SectionHeaderProps {
  title: string;
  /** A count shown beside the title. */
  count?: number;
  /** A text action on the right, e.g. "See all". */
  actionLabel?: string;
  onAction?: () => void;
}

/** Small uppercase heading above a group of cards or rows. */
export const SectionHeader = ({ title, count, actionLabel, onAction }: SectionHeaderProps) => {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderTitle}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
        {count !== undefined ? (
          <View style={styles.countPill}>
            <Text style={styles.countPillLabel}>{count}</Text>
          </View>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <PressableScale onPress={onAction} pressedOpacity={0.5} hitSlop={10}>
          <Text style={styles.sectionAction}>{actionLabel}</Text>
        </PressableScale>
      ) : null}
    </View>
  );
};

export interface CardProps {
  children: ReactNode;
  /** Tighter inner padding, for cards that are mostly a list of rows. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Bordered surface with the same radius and subtle elevation as web cards. */
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
  /** When the visible title alone is ambiguous (e.g. a count); defaults to the title. */
  accessibilityLabel?: string;
}

export const Button = ({
  title,
  onPress,
  variant = 'primary',
  icon,
  loading = false,
  disabled = false,
  style,
  accessibilityLabel,
}: ButtonProps) => {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const isDisabled = disabled || loading;

  const surface: Record<ButtonVariant, ViewStyle> = {
    primary: { backgroundColor: theme.color.brand },
    secondary: { backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.borderStrong },
    quiet: { backgroundColor: 'transparent' },
    danger: { backgroundColor: theme.color.danger },
  };
  const label: Record<ButtonVariant, string> = {
    primary: theme.color.onBrand,
    secondary: theme.color.ink,
    quiet: theme.color.inkMuted,
    danger: theme.color.onBrand,
  };

  return (
    <PressableScale
      onPress={onPress}
      disabled={isDisabled}
      accessibilityLabel={accessibilityLabel ?? title}
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
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            {/* Capped so two labels share a row without breaking words mid-way. */}
            <Text
              maxFontSizeMultiplier={1.5}
              style={[styles.segmentLabel, active && styles.segmentLabelActive]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export interface ChipProps {
  label: string;
  active: boolean;
  onPress: () => void;
  /** An independent on/off choice (a checkbox) rather than one of a mutually exclusive row. */
  toggle?: boolean;
}

/** One choice in a row of mutually exclusive filters, or an on/off toggle. */
export const Chip = ({ label, active, onPress, toggle = false }: ChipProps) => {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    // PressableScale, not a function-form Pressable style: NativeWind drops that (MOB-001).
    <PressableScale
      accessibilityRole={toggle ? 'checkbox' : 'radio'}
      accessibilityState={toggle ? { checked: active } : { selected: active }}
      onPress={onPress}
      pressedOpacity={0.6}
      style={[styles.chip, active && styles.chipOn]}
    >
      {active && toggle ? <Icon name="check" size={14} color={theme.color.onBrand} strokeWidth={2.4} /> : null}
      <Text style={[styles.chipLabel, active && styles.chipLabelOn]}>{label}</Text>
    </PressableScale>
  );
};

/* -------------------------------------------------------------------------
 * Data display
 * ---------------------------------------------------------------------- */

export interface TagProps {
  label: string;
  accent: Accent;
}

/** Compact status badge, consistent with website badges. */
export const Tag = ({ label, accent }: TagProps) => {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.tag, { backgroundColor: accent.bg }]}>
      <Text style={[styles.tagLabel, { color: accent.fg }]}>{label}</Text>
    </View>
  );
};

export interface IconWellProps {
  name: IconName;
  accent: Accent;
  size?: number;
}

/** Semantic icon surface. */
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

export interface DateBadgeProps {
  /** ISO instant or date. */
  date: string;
  /** Muted styling, for past dates. */
  muted?: boolean;
}

/** A calendar-page tile (month over day) that anchors a dated card or row. */
export const DateBadge = ({ date, muted = false }: DateBadgeProps) => {
  const styles = useThemedStyles(makeStyles);
  const { i18n } = useTranslation();
  const value = new Date(date);
  const month = new Intl.DateTimeFormat(i18n.language, { month: 'short' }).format(value);
  const day = new Intl.DateTimeFormat(i18n.language, { day: 'numeric' }).format(value);
  const weekday = new Intl.DateTimeFormat(i18n.language, { weekday: 'short' }).format(value);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.dateBadge, muted && styles.dateBadgeMuted]}
    >
      <View style={[styles.dateBadgeMonth, muted && styles.dateBadgeMonthMuted]}>
        <Text maxFontSizeMultiplier={1.2} style={[styles.dateBadgeMonthLabel, muted && styles.dateBadgeMutedLabel]}>
          {month}
        </Text>
      </View>
      <Text maxFontSizeMultiplier={1.2} style={[styles.dateBadgeDay, muted && styles.dateBadgeMutedLabel]}>{day}</Text>
      <Text maxFontSizeMultiplier={1.2} style={styles.dateBadgeWeekday}>{weekday}</Text>
    </View>
  );
};

export interface StatTileProps {
  label: string;
  value: string | number;
  icon: IconName;
  accent: Accent;
  onPress?: () => void;
}

/** A headline number with its label, for summaries at the top of a screen. */
export const StatTile = ({ label, value, icon, accent, onPress }: StatTileProps) => {
  const styles = useThemedStyles(makeStyles);
  const body = (
    <View style={styles.statTile}>
      <IconWell name={icon} accent={accent} size={34} />
      <Text maxFontSizeMultiplier={1.4} style={styles.statValue}>{value}</Text>
      <Text numberOfLines={1} maxFontSizeMultiplier={1.4} style={styles.statLabel}>{label}</Text>
    </View>
  );
  if (!onPress) return <View style={styles.flex}>{body}</View>;
  return (
    <PressableScale onPress={onPress} accessibilityLabel={`${label}: ${value}`} pressedOpacity={0.7} style={styles.flex}>
      {body}
    </PressableScale>
  );
};

export interface AvatarProps {
  name: string | null | undefined;
  /** The uploaded picture; initials are shown without one. */
  url?: string | null;
  size?: number;
}

export const Avatar = ({ name, url, size = 36 }: AvatarProps) => {
  const theme = useTheme();
  if (url) {
    return (
      <Image
        source={{ uri: url }}
        accessibilityLabel={name ?? undefined}
        style={{ width: size, height: size, borderRadius: theme.radius.pill, backgroundColor: theme.color.surfaceInset }}
      />
    );
  }
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
          fontFamily: fonts.sansSemiBold,
          fontWeight: '600',
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
  /** An icon well, avatar or badge before the row's text. */
  leading?: ReactNode;
}

/** Accessible row for a card or list. */
export const ListRow = ({ children, onPress, divided = false, showChevron = false, leading }: ListRowProps) => {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const content = (
    <View style={[styles.listRow, divided && styles.listRowDivided]}>
      {leading}
      <View style={styles.flex}>{children}</View>
      {showChevron ? <Icon name="chevronRight" size={16} color={theme.color.inkFaint} /> : null}
    </View>
  );

  if (!onPress) return content;
  return (
    <PressableScale onPress={onPress} pressedOpacity={0.6}>
      {content}
    </PressableScale>
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
  ({ label, style, containerStyle, onFocus, onBlur, ...props }, ref) => {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.field, containerStyle]}>
      {label ? <Label>{label}</Label> : null}
      <TextInput
        ref={ref}
        placeholderTextColor={theme.color.inkFaint}
        style={[styles.input, !props.multiline && styles.singleLine, focused && styles.inputFocused, style]}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
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
  /** The glyph in the illustration well above the title. */
  icon?: IconName;
}

export const EmptyState = ({ title, description, action, icon = 'sparkle' }: EmptyStateProps) => {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Reveal>
      <View style={styles.centered}>
        <View style={styles.emptyIcon}>
          <IconWell name={icon} accent={theme.accent.blue} size={56} />
        </View>
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

/** Any thrown value as localized, user-safe text (never raw database/provider errors). */
export const ErrorNotice = ({ error }: ErrorNoticeProps) => {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const errorText = useErrorText();
  if (!error) return null;
  const message = errorText(error);
  return (
    <View accessibilityRole="alert" style={styles.notice}>
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

    header: { paddingTop: theme.space.md, paddingBottom: theme.space.xs, gap: 6 },
    headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
    eyebrow: { ...theme.type.label, fontWeight: '600', color: theme.color.brandText },
    headerTitle: { ...theme.type.display, color: theme.color.ink },
    headerDescription: { ...theme.type.body, color: theme.color.inkMuted, maxWidth: 420 },
    headerAction: { marginTop: theme.space.md, alignSelf: 'flex-start' },

    label: { ...theme.type.label, color: theme.color.inkMuted },

    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.space.md,
      paddingHorizontal: theme.space.xs,
      marginTop: theme.space.sm,
    },
    sectionHeaderTitle: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, flexShrink: 1 },
    sectionTitle: { ...theme.type.eyebrow, color: theme.color.inkFaint },
    sectionAction: { ...theme.type.label, fontWeight: '600', color: theme.color.brandText },
    countPill: {
      minWidth: 20,
      alignItems: 'center',
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.color.surfaceInset,
    },
    countPillLabel: { ...theme.type.numeric, fontSize: 11.5, lineHeight: 16, fontWeight: '600', color: theme.color.inkMuted },

    card: {
      backgroundColor: theme.color.surface,
      borderWidth: 1,
      borderColor: theme.color.border,
      borderRadius: theme.radius.lg + 2,
      padding: theme.space.lg,
      gap: theme.space.lg,
      shadowColor: '#0f172a',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: theme.scheme === 'dark' ? 0 : 0.05,
      shadowRadius: 8,
      elevation: theme.scheme === 'dark' ? 0 : 1,
    },
    cardCompact: { padding: theme.space.md, gap: 0 },

    button: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.space.sm,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.space.lg + 2,
      minHeight: 48,
    },
    buttonDisabled: { opacity: 0.5 },
    buttonLabel: { fontFamily: fonts.sansSemiBold, fontWeight: '600', fontSize: 15, letterSpacing: -0.1 },

    iconButton: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radius.pill,
      borderWidth: 1,
      borderColor: theme.color.border,
      backgroundColor: theme.color.surface,
    },

    chip: {
      minHeight: 40,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingHorizontal: theme.space.lg - 2,
      borderRadius: theme.radius.pill,
      borderWidth: 1,
      borderColor: theme.color.border,
      backgroundColor: theme.color.surface,
    },
    chipOn: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
    chipLabel: { ...theme.type.bodySmall, fontWeight: '500', color: theme.color.inkMuted },
    chipLabelOn: { color: theme.color.onBrand, fontWeight: '600' },
    segmented: {
      flexDirection: 'row',
      backgroundColor: theme.color.surfaceInset,
      borderRadius: theme.radius.md,
      padding: 3,
      gap: 3,
    },
    segment: {
      flex: 1,
      minHeight: 40,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 6,
      paddingHorizontal: theme.space.xs,
      borderRadius: theme.radius.sm + 1,
    },
    segmentActive: {
      backgroundColor: theme.scheme === 'dark' ? theme.color.borderStrong : theme.color.surface,
      shadowColor: '#0f172a',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: theme.scheme === 'dark' ? 0 : 0.1,
      shadowRadius: 3,
      elevation: theme.scheme === 'dark' ? 0 : 2,
    },
    segmentLabel: { fontFamily: fonts.sans, fontWeight: '500', fontSize: 13.5, color: theme.color.inkMuted, textAlign: 'center' },
    segmentLabelActive: { fontFamily: fonts.sansSemiBold, fontWeight: '600', color: theme.color.ink },

    tag: {
      alignSelf: 'flex-start',
      borderRadius: theme.radius.pill,
      paddingHorizontal: 9,
      paddingVertical: 4,
    },
    tagLabel: { ...theme.type.label, fontSize: 12, lineHeight: 16 },

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

    dateBadge: {
      width: 52,
      alignItems: 'center',
      overflow: 'hidden',
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.scheme === 'dark' ? theme.color.borderStrong : serviceCenterDesignTokens.brand[200],
      backgroundColor: theme.accent.blue.bg,
    },
    dateBadgeMuted: { borderColor: theme.color.border, backgroundColor: theme.color.surfaceInset },
    dateBadgeMonth: { alignSelf: 'stretch', alignItems: 'center', paddingVertical: 2, backgroundColor: theme.color.brand },
    dateBadgeMonthMuted: { backgroundColor: theme.color.borderStrong },
    dateBadgeMonthLabel: {
      ...theme.type.eyebrow,
      fontSize: 10,
      lineHeight: 14,
      color: theme.color.onBrand,
    },
    dateBadgeDay: {
      ...theme.type.title,
      fontSize: 21,
      lineHeight: 25,
      fontVariant: ['tabular-nums'],
      color: theme.color.ink,
      marginTop: 2,
    },
    dateBadgeMutedLabel: { color: theme.color.inkMuted },
    dateBadgeWeekday: { ...theme.type.eyebrow, fontSize: 9.5, lineHeight: 13, letterSpacing: 0.4, color: theme.color.inkFaint, paddingBottom: 5 },

    statTile: {
      backgroundColor: theme.color.surface,
      borderWidth: 1,
      borderColor: theme.color.border,
      borderRadius: theme.radius.lg,
      padding: theme.space.md,
      gap: 6,
    },
    statValue: { ...theme.type.title, fontSize: 24, lineHeight: 28, fontVariant: ['tabular-nums'], color: theme.color.ink, marginTop: 4 },
    statLabel: { ...theme.type.label, fontSize: 12, color: theme.color.inkMuted },

    listRow: {
      minHeight: 48,
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
      borderColor: theme.color.borderStrong,
      borderRadius: theme.radius.md,
      backgroundColor: theme.color.field,
      minHeight: 48,
      paddingHorizontal: theme.space.md + 2,
      paddingVertical: theme.space.md,
    },
    inputFocused: { borderColor: theme.color.brand, borderWidth: 1.5 },
    // iOS draws a single-line input's text and placeholder off-centre when a
    // lineHeight is set, so let the font's own metrics size the line instead.
    singleLine: { lineHeight: undefined, textAlignVertical: 'center' },

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
    emptyIcon: { marginBottom: theme.space.sm },

    notice: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.space.sm,
      backgroundColor: theme.accent.red.bg,
      borderRadius: theme.radius.md,
      padding: theme.space.md,
    },
    noticeText: { ...theme.type.bodySmall, color: theme.accent.red.fg, flex: 1 },
  });
