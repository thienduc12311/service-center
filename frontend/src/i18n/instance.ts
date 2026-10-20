import { initReactI18next } from 'react-i18next';
import {
  LanguagePreferenceController,
  createI18n,
  type LanguageStorage,
} from '@service-center/shared';
import { api } from '../lib/api';

/**
 * Browser adapter: localStorage for the device choice and per-account cache,
 * `navigator.languages` for detection, `navigator.onLine` as a connectivity
 * hint. Everything else lives in the shared controller.
 */

const browserStorage: LanguageStorage = {
  get: (key) => {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.warn('[i18n] storage unavailable', error);
      return null;
    }
  },
  set: (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      console.warn('[i18n] could not store language', error);
    }
  },
  remove: (key) => {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.warn('[i18n] could not clear language', error);
    }
  },
};

export const browserLanguages = (): readonly string[] =>
  navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : [];

/** The single i18next instance for the web app. */
export const i18n = createI18n({
  configure: (instance) => {
    instance.use(initReactI18next);
  },
  onMissingKey: import.meta.env.DEV
    ? (locale, namespace, key) => console.warn(`[i18n] missing ${locale}/${namespace}:${key}`)
    : undefined,
});

export const languageController = new LanguagePreferenceController({
  storage: browserStorage,
  detectLocales: browserLanguages,
  isOnline: () => navigator.onLine,
  api: {
    // Explicitly scoped: a response or write can never land on another church.
    load: (context) => api.getLanguagePreference({ organizationId: context.organizationId }),
    save: (context, preferred) =>
      api.updateLanguagePreference({ preferred_language: preferred }, { organizationId: context.organizationId }),
  },
});
