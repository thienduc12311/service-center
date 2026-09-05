import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';

const buttonClasses = {
  primary: 'bg-brand-600 active:bg-brand-700',
  secondary: 'border border-slate-200 bg-white active:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:active:bg-slate-800',
  danger: 'bg-rose-600 active:bg-rose-700',
} as const;

export const Button = ({ title, onPress, variant = 'primary', loading = false, disabled = false, style }: {
  title: string;
  onPress: () => void;
  variant?: keyof typeof buttonClasses;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) => {
  const isDisabled = disabled || loading;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={isDisabled}
      className={`flex-row items-center justify-center gap-2 rounded-xl px-4 py-3 ${buttonClasses[variant]} ${isDisabled ? 'opacity-50' : ''}`}
      style={style}>
      {loading && <ActivityIndicator size="small" color={variant === 'secondary' ? '#4f46e5' : '#fff'} />}
      <Text className={`text-[15px] font-semibold ${variant === 'secondary' ? 'text-brand-600 dark:text-brand-200' : 'text-white'}`}>{title}</Text>
    </Pressable>
  );
};

export const Card = ({ children, style, className = '' }: { children: ReactNode; style?: StyleProp<ViewStyle>; className?: string }) => (
  <View className={`rounded-card border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black ${className}`} style={style}>{children}</View>
);

export const Badge = ({ label, bg, fg }: { label: string; bg: string; fg: string }) => (
  <View className="rounded-full px-2 py-1" style={{ backgroundColor: bg }}><Text className="text-[11px] font-semibold capitalize" style={{ color: fg }}>{label}</Text></View>
);

export const Avatar = ({ name, size = 36 }: { name: string | null | undefined; size?: number }) => {
  const letters = (name ?? '?').trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? '').join('').toUpperCase();
  return <View className="items-center justify-center bg-brand-50 dark:bg-brand-500/20" style={{ width: size, height: size, borderRadius: size / 2 }}><Text className="font-bold text-brand-600 dark:text-brand-200" style={{ fontSize: size * 0.38 }}>{letters || '?'}</Text></View>;
};

export const Loading = ({ label }: { label?: string }) => (
  <View className="items-center justify-center gap-2 py-12"><ActivityIndicator color="#6366f1" />{label && <Text className="text-center text-sm text-slate-500 dark:text-slate-400">{label}</Text>}</View>
);

export const EmptyState = ({ title, description }: { title: string; description?: string }) => (
  <View className="items-center justify-center gap-2 px-6 py-12"><Text className="text-base font-semibold text-slate-900 dark:text-white">{title}</Text>{description && <Text className="text-center text-sm text-slate-500 dark:text-slate-400">{description}</Text>}</View>
);

export const ErrorNotice = ({ error }: { error: unknown }) => {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return <View className="my-2 rounded-xl bg-rose-50 p-3 dark:bg-rose-950/40"><Text className="text-sm text-rose-700 dark:text-rose-300">{message}</Text></View>;
};

export const SectionTitle = ({ children }: { children: ReactNode }) => (
  <Text className="mb-2.5 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{children}</Text>
);
