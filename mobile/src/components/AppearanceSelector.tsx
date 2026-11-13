import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { APPEARANCE_MODES, type AppearanceMode } from '@service-center/shared';
import { useAppearance } from '../providers/AppearanceProvider';
import type { Theme } from '../lib/theme';
import { useTheme, useThemedStyles } from '../lib/useTheme';
import { Icon, type IconName } from './icons';
import { PressableScale } from './motion';

/** The glyph beside each appearance choice. */
const MODE_ICON: Record<AppearanceMode, IconName> = { light: 'sun', dark: 'moon', system: 'settings' };

/**
 * MOB-021: Light / Dark / System with the website's labels, one radio row
 * each (rows, not segments, so "Theo hệ thống" stays readable at large text).
 */
export const AppearanceSelector = () => {
  const { t } = useTranslation('settings');
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { mode, saveFailed, setMode } = useAppearance();

  return (
    <View style={styles.wrap}>
      <View accessibilityRole="radiogroup" accessibilityLabel={t('profile.appearance.title')} style={styles.group}>
        {APPEARANCE_MODES.map((option, index) => {
          const active = mode === option;
          return (
            <PressableScale
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              pressedOpacity={0.6}
              onPress={() => setMode(option)}
              style={[styles.option, index > 0 && styles.optionDivided]}
            >
              <Icon name={MODE_ICON[option]} size={18} color={active ? theme.color.brandText : theme.color.inkMuted} />
              <Text style={[styles.label, active && styles.labelActive]}>{t(`profile.appearance.${option}`)}</Text>
              <View style={[styles.radio, active && styles.radioActive]} />
            </PressableScale>
          );
        })}
      </View>
      <Text style={styles.hint}>
        {mode === 'system' ? `${t('profile.appearance.systemHint')} ` : ''}
        {t('profile.appearance.deviceOnly')}
      </Text>
      {saveFailed ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.error}>
          {t('profile.appearance.saveFailed')}
        </Text>
      ) : null}
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    wrap: { gap: theme.space.sm },
    group: {
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.color.border,
      backgroundColor: theme.color.surface,
      overflow: 'hidden',
    },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.md,
      minHeight: 48,
      paddingHorizontal: theme.space.md,
      paddingVertical: theme.space.sm,
    },
    optionDivided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.color.border },
    label: { ...theme.type.body, color: theme.color.ink, flex: 1 },
    labelActive: { fontWeight: '600' },
    radio: {
      width: 20,
      height: 20,
      borderRadius: theme.radius.pill,
      borderWidth: 1.5,
      borderColor: theme.color.borderStrong,
    },
    radioActive: { borderWidth: 6, borderColor: theme.color.brand },
    hint: { ...theme.type.bodySmall, color: theme.color.inkFaint },
    error: { ...theme.type.bodySmall, color: theme.color.danger },
  });
