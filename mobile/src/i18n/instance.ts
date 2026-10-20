// Hermes may lack Intl.PluralRules; i18next needs it for plural forms. The
// polyfill installs itself only when the runtime's implementation is missing.
import 'intl-pluralrules';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import { initReactI18next } from 'react-i18next';
import { LanguagePreferenceController, createI18n, type LanguageStorage } from '@service-center/shared';
import { api } from '../lib/api';

/**
 * Native adapter: AsyncStorage for the device choice and per-account cache,
 * expo-localization for the device's ordered languages. Everything else
 * lives in the shared controller.
 */

const nativeStorage: LanguageStorage = {
  get: (key) => AsyncStorage.getItem(key),
  set: (key, value) => AsyncStorage.setItem(key, value),
  remove: (key) => AsyncStorage.removeItem(key),
};

/** Ordered device languages (`vi-VN`, `en-US`, …); re-read on every resolution. */
export const deviceLanguages = (): readonly string[] => getLocales().map((locale) => locale.languageTag);

export const i18n = createI18n({
  configure: (instance) => {
    instance.use(initReactI18next);
  },
  onMissingKey: __DEV__
    ? (locale, namespace, key) => console.warn(`[i18n] missing ${locale}/${namespace}:${key}`)
    : undefined,
});

export const languageController = new LanguagePreferenceController({
  storage: nativeStorage,
  detectLocales: deviceLanguages,
  api: {
    // Explicitly scoped: a response or write can never land on another church.
    load: (context) => api.getLanguagePreference({ organizationId: context.organizationId }),
    save: (context, preferred) =>
      api.updateLanguagePreference({ preferred_language: preferred }, { organizationId: context.organizationId }),
  },
});
