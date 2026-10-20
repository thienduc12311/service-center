import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import {
  directionFor,
  localeRegistry,
  formatLocaleFor,
  resolveLocale,
  selectedPreference,
  type LanguagePreferenceState,
  type SaveOutcome,
  type SupportedLocale,
} from '@service-center/shared';
import { useAuth } from '../providers/AuthProvider';
import { browserLanguages, i18n, languageController } from './instance';

/** What screens need to show and change the language. */
export interface LanguageContextValue {
  state: LanguagePreferenceState;
  /** The language being displayed. */
  locale: SupportedLocale;
  /** `Intl` locale for dates and numbers. */
  formatLocale: string;
  /** Selector value: a code, or null for Automatic (pending while saving). */
  selected: string | null;
  /** True for a signed-in member with an active church; false on signed-out/onboarding screens. */
  member: boolean;
  save: (value: SupportedLocale | null) => Promise<SaveOutcome>;
  setAnonymousChoice: (value: SupportedLocale | null) => Promise<void>;
  dismissError: () => void;
  /** What Automatic resolves to on this browser right now. */
  automaticLocale: SupportedLocale;
  /** Top-bar switch for this tab only; null shows the resolved preference. Never saved. */
  displayOverride: SupportedLocale | null;
  setDisplayOverride: (value: SupportedLocale | null) => void;
}

/** Per-tab, so the switch never touches the saved preference or other tabs. */
const DISPLAY_OVERRIDE_KEY = 'service-center.language.display';

const readDisplayOverride = (): SupportedLocale | null => {
  try {
    const stored = sessionStorage.getItem(DISPLAY_OVERRIDE_KEY);
    return localeRegistry.isSupported(stored) ? stored : null;
  } catch (error) {
    console.warn('[i18n] session storage unavailable', error);
    return null;
  }
};

const writeDisplayOverride = (value: SupportedLocale | null): void => {
  try {
    if (value) sessionStorage.setItem(DISPLAY_OVERRIDE_KEY, value);
    else sessionStorage.removeItem(DISPLAY_OVERRIDE_KEY);
  } catch (error) {
    console.warn('[i18n] could not store display language', error);
  }
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

void languageController.init();

/**
 * Connects the shared preference controller to the signed-in context and to
 * i18next. Must sit inside <AuthProvider>.
 */
export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const { session, user, organizationId, loading } = useAuth();
  const state = useSyncExternalStore(languageController.subscribe, languageController.getState);
  const profileId = user?.profile.id ?? null;
  const signedIn = Boolean(session);
  const [displayOverride, setOverrideState] = useState<SupportedLocale | null>(readDisplayOverride);

  const setDisplayOverride = useCallback((value: SupportedLocale | null) => {
    writeDisplayOverride(value);
    setOverrideState(value);
  }, []);

  useEffect(() => {
    if (loading && signedIn) return;
    if (signedIn && profileId && organizationId) {
      void languageController.setContext({ kind: 'member', profileId, organizationId });
    } else {
      // Signed out (account caches are cleared) or signed in before joining
      // a church: the device choice, then the browser language.
      void languageController.setContext({ kind: 'anonymous' });
    }
  }, [signedIn, profileId, organizationId, loading]);

  // Reconcile with other devices when the tab regains focus, and follow
  // browser language changes for Automatic.
  useEffect(() => {
    const onFocus = () => {
      void languageController.refresh();
    };
    const onLanguageChange = () => languageController.refreshDetection();
    window.addEventListener('focus', onFocus);
    window.addEventListener('languagechange', onLanguageChange);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('languagechange', onLanguageChange);
    };
  }, []);

  const locale = displayOverride ?? state.resolution.locale;
  useEffect(() => {
    if (i18n.language !== locale) void i18n.changeLanguage(locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = directionFor(locale);
  }, [locale]);

  const value = useMemo<LanguageContextValue>(
    () => ({
      state,
      locale,
      formatLocale: formatLocaleFor(locale),
      selected: selectedPreference(state),
      member: state.context.kind === 'member',
      // An explicit choice in Settings replaces the temporary top-bar switch.
      save: (next) => {
        setDisplayOverride(null);
        return languageController.save(next);
      },
      setAnonymousChoice: (next) => {
        setDisplayOverride(null);
        return languageController.setAnonymousChoice(next);
      },
      dismissError: () => languageController.dismissError(),
      automaticLocale: resolveLocale({ member: true, saved: null, detected: browserLanguages() }).locale,
      displayOverride,
      setDisplayOverride,
    }),
    [state, locale, displayOverride, setDisplayOverride],
  );

  return (
    <I18nextProvider i18n={i18n}>
      <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
    </I18nextProvider>
  );
};

/**
 * For token pages (respond link, accept invitation): once the page's token
 * is verified, show the recipient's saved language unless the visitor picks
 * one locally. Never writes to the Person.
 */
export const useRecipientLanguage = (preferred: string | null | undefined): void => {
  useEffect(() => {
    if (preferred === undefined) return;
    languageController.setRecipientHint(preferred);
    return () => languageController.setRecipientHint(null);
  }, [preferred]);
};

export const useLanguage = (): LanguageContextValue => {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used inside <LanguageProvider>');
  return context;
};
