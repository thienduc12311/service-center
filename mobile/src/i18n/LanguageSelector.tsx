import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { localeRegistry, type SupportedLocale } from '@service-center/shared';
import { useTheme } from '../lib/useTheme';
import { useLanguage } from './LanguageProvider';

export interface LanguageSelectorProps {
  /** Church name for the "saved for this church only" hint. */
  organizationName?: string | null;
}

interface ChoiceRow {
  key: string;
  value: SupportedLocale | null;
  label: string;
  lang?: string;
}

/**
 * "Language / Ngôn ngữ" on the Profile tab: one row per registry language
 * plus Automatic. A member's choice is saved for the active church; while
 * signed out it is a device-only choice.
 */
export const LanguageSelector = ({ organizationName }: LanguageSelectorProps) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const { state, selected, member, automaticLocale, save, setAnonymousChoice } = useLanguage();
  const saving = state.pending !== undefined;
  const linkMissing = member && state.personLinked === false;
  const unsupported = typeof selected === 'string' && !localeRegistry.isSupported(selected) ? selected : null;

  const rows: ChoiceRow[] = [
    {
      key: 'automatic',
      value: null,
      label: t('language.automaticWithCurrent', { language: localeRegistry.definition(automaticLocale).nativeName }),
    },
    ...localeRegistry.options().map((option) => ({ key: option.code, value: option.code, label: option.label, lang: option.lang })),
  ];

  const choose = (value: SupportedLocale | null) => {
    if (member) void save(value);
    else void setAnonymousChoice(value);
  };

  const errorText =
    state.error === 'save_failed'
      ? t('language.saveFailed')
      : state.error === 'offline'
        ? t('language.offline')
        : state.error === 'link_required' || linkMissing
          ? t('language.linkRequired')
          : null;

  return (
    <View style={{ gap: theme.space.sm }}>
      <View accessibilityRole="radiogroup" accessibilityLabel={t('language.bilingualLabel')} style={{ gap: theme.space.xs }}>
        {rows.map((row) => {
          const active = selected === row.value;
          const disabled = saving || linkMissing;
          return (
            <Pressable
              key={row.key}
              accessibilityRole="radio"
              accessibilityState={{ selected: active, disabled, busy: saving && state.pending === row.value }}
              accessibilityLanguage={row.lang}
              disabled={disabled}
              onPress={() => choose(row.value)}
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
                opacity: disabled && !active ? 0.6 : 1,
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
              <Text style={[theme.type.body, { color: theme.color.ink, flex: 1 }]}>{row.label}</Text>
              {saving && state.pending === row.value ? <ActivityIndicator size="small" color={theme.color.inkFaint} /> : null}
            </Pressable>
          );
        })}
      </View>
      {unsupported ? (
        <Text style={[theme.type.bodySmall, { color: theme.color.inkMuted }]}>
          {t('language.unsupportedSaved', { code: unsupported })} {t('language.unsupportedSavedHint')}
        </Text>
      ) : null}
      <Text style={[theme.type.bodySmall, { color: theme.color.inkFaint }]}>
        {member
          ? t('language.currentChurchHint', { organization: organizationName ?? t('fallback.yourChurch') })
          : t('language.anonymousHint')}
        {selected === null ? ` ${t('language.automaticHint')}` : ''}
      </Text>
      {saving ? (
        <Text accessibilityLiveRegion="polite" style={[theme.type.bodySmall, { color: theme.color.inkMuted }]}>
          {t('language.saving')}
        </Text>
      ) : null}
      {errorText ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[theme.type.bodySmall, { color: theme.color.danger }]}>
          {errorText}
        </Text>
      ) : null}
    </View>
  );
};
