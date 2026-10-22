import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { APPEARANCE_MODES } from '@service-center/shared';
import { useAppearance } from '../providers/AppearanceProvider';
import { useTheme } from '../lib/useTheme';

/**
 * MOB-021: Light / Dark / System with the website's labels, one radio row
 * each (rows, not segments, so "Theo hệ thống" stays readable at large text).
 */
export const AppearanceSelector = () => {
  const { t } = useTranslation('settings');
  const theme = useTheme();
  const { mode, saveFailed, setMode } = useAppearance();

  return (
    <View style={{ gap: theme.space.sm }}>
      <View accessibilityRole="radiogroup" accessibilityLabel={t('profile.appearance.title')} style={{ gap: theme.space.xs }}>
        {APPEARANCE_MODES.map((option) => {
          const active = mode === option;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              onPress={() => setMode(option)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.space.sm,
                minHeight: 44,
                paddingHorizontal: theme.space.md,
                paddingVertical: theme.space.sm,
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderColor: active ? theme.color.brand : theme.color.border,
                backgroundColor: theme.color.surface,
              }}
            >
              <View
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  borderWidth: active ? 6 : 1.5,
                  borderColor: active ? theme.color.brand : theme.color.borderStrong,
                }}
              />
              <Text style={[theme.type.body, { color: theme.color.ink, flex: 1 }]}>{t(`profile.appearance.${option}`)}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[theme.type.bodySmall, { color: theme.color.inkFaint }]}>
        {mode === 'system' ? `${t('profile.appearance.systemHint')} ` : ''}
        {t('profile.appearance.deviceOnly')}
      </Text>
      {saveFailed ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[theme.type.bodySmall, { color: theme.color.danger }]}>
          {t('profile.appearance.saveFailed')}
        </Text>
      ) : null}
    </View>
  );
};
