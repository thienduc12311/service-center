import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { I18nextProvider } from 'react-i18next';
import {
  formatLocaleFor,
  resolveLocale,
  selectedPreference,
  type LanguagePreferenceState,
  type SaveOutcome,
  type SupportedLocale,
} from '@service-center/shared';
import { useAuth } from '../providers/AuthProvider';
import { deviceLanguages, i18n, languageController } from './instance';

/** What screens need to show and change the language. */
export interface LanguageContextValue {
  state: LanguagePreferenceState;
  locale: SupportedLocale;
  formatLocale: string;
  /** Selector value: a code, or null for Automatic (pending while saving). */
  selected: string | null;
  member: boolean;
  automaticLocale: SupportedLocale;
  save: (value: SupportedLocale | null) => Promise<SaveOutcome>;
  setAnonymousChoice: (value: SupportedLocale | null) => Promise<void>;
  dismissError: () => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

void languageController.init();

/**
 * Connects the shared controller to the native session lifecycle. The
 * context follows the lifecycle's ready user and organization, so a switch
 * suspends the previous church before the next one loads.
 */
export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const { session, user, organizationId, loading, ready } = useAuth();
  const state = useSyncExternalStore(languageController.subscribe, languageController.getState);
  const profileId = user?.profile.id ?? null;
  const signedIn = Boolean(session);

  useEffect(() => {
    if (loading || (signedIn && !ready)) return;
    if (signedIn && profileId && organizationId) {
      void languageController.setContext({ kind: 'member', profileId, organizationId });
    } else {
      void languageController.setContext({ kind: 'anonymous' });
    }
  }, [signedIn, profileId, organizationId, loading, ready]);

  // Android can change the device language while running; both platforms
  // reconcile the saved preference when the app returns to the foreground.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (status !== 'active') return;
      languageController.refreshDetection();
      void languageController.refresh();
    });
    return () => subscription.remove();
  }, []);

  const locale = state.resolution.locale;
  useEffect(() => {
    if (i18n.language !== locale) void i18n.changeLanguage(locale);
  }, [locale]);

  const value = useMemo<LanguageContextValue>(
    () => ({
      state,
      locale,
      formatLocale: formatLocaleFor(locale),
      selected: selectedPreference(state),
      member: state.context.kind === 'member',
      automaticLocale: resolveLocale({ member: true, saved: null, detected: deviceLanguages() }).locale,
      save: (next) => languageController.save(next),
      setAnonymousChoice: (next) => languageController.setAnonymousChoice(next),
      dismissError: () => languageController.dismissError(),
    }),
    [state, locale],
  );

  return (
    <I18nextProvider i18n={i18n}>
      <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
    </I18nextProvider>
  );
};

/** Token pages: show the verified recipient's language unless the visitor picks one. Never saved. */
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
