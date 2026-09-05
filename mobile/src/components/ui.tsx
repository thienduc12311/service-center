import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { theme } from '../lib/theme';

export const Button = ({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) => {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        (pressed || isDisabled) && { opacity: isDisabled ? 0.5 : 0.85 },
        style,
      ]}
    >
      {loading && (
        <ActivityIndicator size="small" color={variant === 'secondary' ? theme.colors.brand : '#fff'} />
      )}
      <Text style={[styles.buttonText, variant === 'secondary' && { color: theme.colors.brand }]}>
        {title}
      </Text>
    </Pressable>
  );
};

export const Card = ({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) => (
  <View style={[styles.card, style]}>{children}</View>
);

export const Badge = ({ label, bg, fg }: { label: string; bg: string; fg: string }) => (
  <View style={[styles.badge, { backgroundColor: bg }]}>
    <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
  </View>
);

export const Avatar = ({ name, size = 36 }: { name: string | null | undefined; size?: number }) => {
  const letters = (name ?? '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();

  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: size * 0.38 }]}>{letters || '?'}</Text>
    </View>
  );
};

export const Loading = ({ label }: { label?: string }) => (
  <View style={styles.centered}>
    <ActivityIndicator color={theme.colors.brand} />
    {label && <Text style={styles.mutedText}>{label}</Text>}
  </View>
);

export const EmptyState = ({ title, description }: { title: string; description?: string }) => (
  <View style={styles.centered}>
    <Text style={styles.emptyTitle}>{title}</Text>
    {description && <Text style={styles.mutedText}>{description}</Text>}
  </View>
);

export const ErrorNotice = ({ error }: { error: unknown }) => {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return (
    <View style={styles.error}>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
};

export const SectionTitle = ({ children }: { children: ReactNode }) => (
  <Text style={styles.sectionTitle}>{children}</Text>
);

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: theme.radius.md,
  },
  buttonPrimary: { backgroundColor: theme.colors.brand },
  buttonSecondary: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  buttonDanger: { backgroundColor: theme.colors.danger },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 16,
  },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: theme.radius.full },
  badgeText: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  avatar: {
    backgroundColor: theme.colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: theme.colors.brand, fontWeight: '700' },
  centered: { alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 48 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: theme.colors.text },
  mutedText: { color: theme.colors.textMuted, fontSize: 14, textAlign: 'center' },
  error: {
    backgroundColor: theme.colors.dangerSoft,
    borderRadius: theme.radius.md,
    padding: 12,
    marginVertical: 8,
  },
  errorText: { color: theme.colors.danger, fontSize: 14 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: theme.colors.textMuted,
    marginBottom: 10,
  },
});
